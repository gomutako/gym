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
import UIKit
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

    /// Copia dello stato della sessione iPhone in corso, mantenuta aggiornata
    /// dal JS (vedi `setSessionState`). Risorsa separata dal buffer: qui
    /// conta solo l'ULTIMO stato, come una cache, non una coda da svuotare —
    /// serve unicamente a rispondere a `state_request` quando la WebView
    /// dorme e non può farlo da sola.
    private let stateURL: URL = {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory,
                                           in: .userDomainMask)[0]
        // Non si può contare sull'ordine di inizializzazione rispetto a
        // `bufferURL` (creare la directory lì, per un accesso a questa
        // proprietà per prima su un'installazione pulita la troverebbe
        // ancora assente): entrambe le create dell'URL devono garantirla da
        // sole. `setSessionState` scrive con `try?`, quindi senza questo un
        // primo avvio fallirebbe la scrittura in silenzio.
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("watchlink-state.json")
    }()

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

    /// Copia nativa dello stato della sessione iPhone, per rispondere al
    /// Watch mentre la WebView dorme. Passare nessun payload la cancella
    /// (sessione chiusa/completata): il chiamante JS lo fa da `complete()`.
    @objc func setSessionState(_ call: CAPPluginCall) {
        guard let payload = call.getObject("payload") else {
            try? FileManager.default.removeItem(at: stateURL)
            call.resolve()
            return
        }
        if let data = try? JSONSerialization.data(withJSONObject: payload) {
            try? data.write(to: stateURL, options: .atomic)
        }
        call.resolve()
    }

    /// Legge la copia su disco. Non passa dalla `queue` del buffer: è una
    /// risorsa scalare indipendente (ultimo stato vince), non un accumulo
    /// ordinato da consegnare per intero.
    ///
    /// ⚠️ Il risultato passa da `stripNullish` prima di tornare: il file è
    /// scritto da `setSessionState` con `session.value.exercises_log` COSÌ
    /// COM'È da `SessionView.vue` (mai passato da watch-catalog.js), e quel
    /// log ha `reps`/`load` espliciti a `null` per ogni serie non ancora
    /// fatta senza storico — il caso comune. `JSONSerialization` decodifica
    /// quei `null` in `NSNull`, legale dentro un documento JSON su disco ma
    /// non nella risposta che ne esce: questo dizionario finisce SOLO nel
    /// `replyHandler` di `state_request`, e WatchConnectivity scarta l'INTERA
    /// risposta se contiene NSNull ovunque, annidato compreso. Stessa regola
    /// del lato Watch, applicata qui al confine di lettura perché la fonte
    /// (il file JSON) non è sotto controllo diretto in questo punto.
    private func currentSessionState() -> [String: Any]? {
        guard let data = try? Data(contentsOf: stateURL) else { return nil }
        guard let raw = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return stripNullish(raw) as? [String: Any]
    }

    /// Toglie ricorsivamente le chiavi `NSNull` (e gli elementi `NSNull`
    /// negli array) da una struttura JSON già decodificata. Vedi il commento
    /// su `currentSessionState()` per il perché.
    private func stripNullish(_ value: Any) -> Any? {
        if value is NSNull { return nil }
        if let dict = value as? [String: Any] {
            var out: [String: Any] = [:]
            for (key, v) in dict {
                if let stripped = stripNullish(v) { out[key] = stripped }
            }
            return out
        }
        if let array = value as? [Any] {
            return array.compactMap { stripNullish($0) }
        }
        return value
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

    /// Variante con risposta sincrona, usata SOLO da `state_request`: il
    /// Watch la invia per sapere se sull'iPhone c'è una sessione da
    /// riprendere, tipicamente a schermo spento — risponde il plugin nativo
    /// dalla propria copia su disco, non il JS, perché la WebView sospesa
    /// non farebbe in tempo. Ogni altro tipo di messaggio finisce comunque
    /// nel buffer/listener come nel percorso senza risposta.
    public func session(_ session: WCSession, didReceiveMessage message: [String: Any],
                        replyHandler: @escaping ([String: Any]) -> Void) {
        guard (message["type"] as? String) == "state_request" else {
            deliver(message)
            replyHandler([:])
            return
        }
        // NIENTE NSNull() qui: WatchConnectivity accetta solo tipi
        // property-list (NSString, NSNumber, NSDate, NSData, NSArray,
        // NSDictionary), e NSNull non è uno di questi — una risposta che lo
        // contiene viene scartata per INTERO e in silenzio (stesso motivo
        // già corretto in sessionStartedPayload/publishBiometrics, sul lato
        // Watch). Quando non c'è nessuna sessione da offrire in adozione, si
        // OMETTE la chiave `session` invece di mandarla `null`: dal lato
        // Watch `reply["session"] as? [String: Any]` legge `nil` in
        // entrambi i casi (chiave assente o valore non castabile), quindi
        // `PhoneLink.requestState` si comporta identico.
        if let session = currentSessionState() {
            replyHandler(["session": session])
        } else {
            replyHandler([:])
        }
    }

    public func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
        deliver(userInfo)
    }

    /// Consegna subito SOLO se l'app è attiva in primo piano e c'è un
    /// listener JS pronto; bufferizza in ogni altro caso.
    /// `retainUntilConsumed` non basta qui: gli eventi sono molti e ordinati,
    /// e vanno anche sopravvissuti alla terminazione del processo.
    ///
    /// ⚠️ `hasListeners` da solo NON basta a decidere: `SessionView.vue`
    /// resta iscritta al listener per l'intera durata di una sessione
    /// aperta, quindi durante un allenamento normale — telefono in tasca,
    /// schermo spento, WebView sospesa — `hasListeners` risulta comunque
    /// vero e ogni messaggio finirebbe dentro un `notifyListeners` che il JS
    /// sospeso non elabora mai, bypassando il buffer proprio quando serve
    /// (un `set_done` chiuso al polso durante un'ora di allenamento in
    /// tasca andrebbe perso se iOS termina il processo). Il segnale giusto è
    /// se l'app PUÒ ricevere davvero, cioè `applicationState == .active`.
    /// `UIApplication.shared` va letto sul thread principale: i delegate di
    /// `WCSession` arrivano su una coda propria, mai quella main, da cui il
    /// `sync` verso `DispatchQueue.main`.
    private func deliver(_ message: [String: Any]) {
        // Oggi non succede mai: i delegate di WCSession arrivano su una coda
        // propria, mai quella main (vedi il commento sopra). Ma se un giorno
        // qualcosa chiamasse `deliver` dal thread principale, un
        // `DispatchQueue.main.sync` da lì si bloccherebbe per sempre — il
        // thread aspetterebbe se stesso. Il controllo costa una riga e toglie
        // questa modalità di guasto.
        let isActive: Bool
        if Thread.isMainThread {
            isActive = UIApplication.shared.applicationState == .active
        } else {
            isActive = DispatchQueue.main.sync { UIApplication.shared.applicationState == .active }
        }
        if isActive, hasListeners("watchMessage") {
            notifyListeners("watchMessage", data: message)
        } else {
            store(message)
        }
    }
}
