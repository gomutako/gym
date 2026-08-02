// =====================================================
// Unico punto di contatto dell'iPhone con il Watch, gemello di PhoneLink.
//
// La ragione per cui è nativo e non JS: quando il Watch invia qualcosa la
// WebView Capacitor è quasi sempre SOSPESA (schermo spento, telefono in
// tasca). Il risveglio concesso da WatchConnectivity sveglia il processo,
// non il JavaScript. Senza il buffer di questa classe ogni serie chiusa al
// polso a schermo spento andrebbe persa.
//
// Il buffer è anche su disco, non solo in memoria: iOS può terminare il
// processo fra un messaggio e l'apertura dell'app.
// =====================================================
import Foundation
import Capacitor
import WatchConnectivity

@objc(WatchLinkPlugin)
public class WatchLinkPlugin: CAPPlugin, WCSessionDelegate {
    private var buffer: [[String: Any]] = []
    private let bufferURL: URL = {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory,
                                           in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("watchlink-buffer.json")
    }()
    private let lock = NSLock()

    override public func load() {
        loadBuffer()
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    // MARK: - API verso il JS

    @objc func isSupported(_ call: CAPPluginCall) {
        call.resolve(["supported": WCSession.isSupported()])
    }

    /// Solo lo stato del collegamento. NON tocca il buffer: esiste separata da
    /// `getState` perché chi vuole sapere se il Watch c'è non deve, per farlo,
    /// buttare via messaggi che non ha intenzione di consumare.
    @objc func getLink(_ call: CAPPluginCall) {
        guard WCSession.isSupported() else {
            call.resolve([
                "supported": false, "paired": false,
                "installed": false, "reachable": false,
            ])
            return
        }
        let session = WCSession.default
        call.resolve([
            "supported": true,
            "paired": session.isPaired,
            "installed": session.isWatchAppInstalled,
            "reachable": session.isReachable,
        ])
    }

    /// Stato del collegamento + tutto ciò che è arrivato mentre la WebView
    /// dormiva. **Svuota il buffer**: il chiamante DEVE consumare `pending`.
    @objc func getState(_ call: CAPPluginCall) {
        guard WCSession.isSupported() else {
            call.resolve([
                "supported": false, "paired": false, "installed": false,
                "reachable": false, "pending": [],
            ])
            return
        }
        let session = WCSession.default
        call.resolve([
            "supported": true,
            "paired": session.isPaired,
            "installed": session.isWatchAppInstalled,
            "reachable": session.isReachable,
            "pending": drain(),
        ])
    }

    @objc func send(_ call: CAPPluginCall) {
        guard WCSession.isSupported(),
              WCSession.default.activationState == .activated else {
            call.reject("Watch non collegato")
            return
        }
        guard let payload = call.getObject("payload") else {
            call.reject("payload richiesto")
            return
        }
        let queued = call.getBool("queued") ?? true
        let session = WCSession.default

        if queued {
            session.transferUserInfo(payload)
            call.resolve()
        } else if session.isReachable {
            session.sendMessage(payload, replyHandler: nil) { error in
                CAPLog.print("⚡️ WatchLink: sendMessage fallito: \(error.localizedDescription)")
            }
            call.resolve()
        } else {
            // Non è un errore: il telefono può stare nell'armadietto. Chi
            // chiama deve sapere che il dato non è partito, non fermarsi.
            call.resolve(["skipped": true])
        }
    }

    /// Contesto applicativo: solo l'ultimo stato conta, semantica giusta per
    /// una cache. Non accoda nulla, quindi non c'è coda da smaltire.
    @objc func setContext(_ call: CAPPluginCall) {
        guard WCSession.isSupported(),
              WCSession.default.activationState == .activated,
              let payload = call.getObject("payload") else {
            call.reject("Watch non collegato")
            return
        }
        do {
            try WCSession.default.updateApplicationContext(payload)
            call.resolve()
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    // MARK: - Buffer

    private func store(_ message: [String: Any]) {
        lock.lock()
        buffer.append(message)
        // Un allenamento lungo con l'app iPhone mai aperta non deve far
        // crescere il file senza limite.
        if buffer.count > 500 { buffer.removeFirst(buffer.count - 500) }
        let snapshot = buffer
        lock.unlock()
        if let data = try? JSONSerialization.data(withJSONObject: snapshot) {
            try? data.write(to: bufferURL, options: .atomic)
        }
    }

    private func drain() -> [[String: Any]] {
        lock.lock()
        let out = buffer
        buffer = []
        lock.unlock()
        try? FileManager.default.removeItem(at: bufferURL)
        return out
    }

    private func loadBuffer() {
        guard let data = try? Data(contentsOf: bufferURL),
              let items = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
        else { return }
        lock.lock(); buffer = items; lock.unlock()
    }

    // MARK: - WCSessionDelegate

    public func session(_ session: WCSession,
                        activationDidCompleteWith state: WCSessionActivationState,
                        error: Error?) {
        CAPLog.print("⚡️ WatchLink: attivazione \(state.rawValue) err=\(error?.localizedDescription ?? "nessuno")")
    }

    // Obbligatori su iOS: l'utente può passare a un altro Watch, e senza la
    // riattivazione il canale resta muto fino al riavvio dell'app.
    public func sessionDidBecomeInactive(_ session: WCSession) {}
    public func sessionDidDeactivate(_ session: WCSession) { WCSession.default.activate() }

    public func sessionReachabilityDidChange(_ session: WCSession) {
        notifyListeners("watchReachability", data: ["reachable": session.isReachable])
    }

    public func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        deliver(message)
    }

    public func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
        deliver(userInfo)
    }

    /// Se c'è un listener JS attivo consegna subito; altrimenti bufferizza.
    /// `retainUntilConsumed` non basta qui: gli eventi sono molti e ordinati,
    /// e vanno anche sopravvissuti alla terminazione del processo.
    private func deliver(_ message: [String: Any]) {
        if hasListeners("watchMessage") {
            notifyListeners("watchMessage", data: message)
        } else {
            store(message)
        }
    }
}
