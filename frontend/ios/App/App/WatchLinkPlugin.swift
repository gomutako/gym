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
//
// Array in memoria e file sono UNA sola risorsa, non due tenute in sync a
// mano: append+scrittura e svuotamento+cancellazione girano sulla stessa
// coda seriale, come unità indivisibili nell'ordine di arrivo. Senza
// questo, un arrivo concorrente a un drain potrebbe far resuscitare sul
// disco un buffer già consegnato, o lasciarlo troncato a metà scrittura —
// esattamente nella finestra (processo ucciso) per cui il buffer esiste.
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
    /// Unica proprietaria di `buffer` e di `bufferURL`: ogni lettura o
    /// scrittura di entrambi passa da qui, come blocco indivisibile
    /// nell'ordine di sottomissione. Una `NSLock` non basterebbe: proteggeva
    /// solo l'array, lasciando l'I/O su disco fuori dalla sezione critica e
    /// quindi riordinabile rispetto a un drain concorrente.
    private let queue = DispatchQueue(label: "it.pallade.watchlink.buffer")

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

    /// Append e scrittura sono un'unica chiusura sottomessa alla coda: o
    /// succedono entrambe prima del prossimo `drain()` in coda, o dopo —
    /// mai a metà, mai nell'ordine sbagliato.
    private func store(_ message: [String: Any]) {
        queue.async {
            self.buffer.append(message)
            // Un allenamento lungo con l'app iPhone mai aperta non deve far
            // crescere il file senza limite.
            if self.buffer.count > 500 { self.buffer.removeFirst(self.buffer.count - 500) }
            self.persist()
        }
    }

    /// Deve girare solo da dentro `queue`. Un payload non serializzabile in
    /// JSON (es. `NSDate`/`NSData`, valori legali in un dizionario
    /// `WCSession` ma non per `JSONSerialization`) non deve far fallire
    /// l'intera scrittura: gli altri messaggi restano persistibili, e lo
    /// scarto va segnalato ad alta voce — un fallimento silenzioso qui è
    /// peggio di un messaggio perso, perché nessuno saprebbe di doverlo
    /// cercare.
    private func persist() {
        let persistable = buffer.filter { message in
            let isValid = JSONSerialization.isValidJSONObject(message)
            if !isValid {
                let type = message["type"] as? String ?? "sconosciuto"
                CAPLog.print("⚡️ WatchLink: payload non serializzabile in JSON scartato dal buffer su disco (type=\(type))")
            }
            return isValid
        }
        guard let data = try? JSONSerialization.data(withJSONObject: persistable) else { return }
        try? data.write(to: bufferURL, options: .atomic)
    }

    /// Sincrona apposta: il bridge Capacitor resta in attesa del valore di
    /// ritorno, quindi svuotamento in memoria e cancellazione su disco
    /// devono completarsi prima che `getState` possa rispondere.
    private func drain() -> [[String: Any]] {
        queue.sync {
            let out = buffer
            buffer = []
            try? FileManager.default.removeItem(at: bufferURL)
            return out
        }
    }

    private func loadBuffer() {
        queue.sync {
            guard let data = try? Data(contentsOf: bufferURL),
                  let items = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
            else { return }
            buffer = items
        }
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
