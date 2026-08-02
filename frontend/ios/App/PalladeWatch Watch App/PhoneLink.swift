// =====================================================
// Unico punto di contatto del Watch con l'iPhone. Non sa nulla di HealthKit
// né di schede: riceve dizionari e li consegna a chi si è registrato.
//
// Due trasporti, scelti per una sola domanda: questo dato, se arriva in
// ritardo, vale ancora qualcosa?
//  - `transferUserInfo` (queued: true) — accodato, ordinato, sopravvive alla
//    app chiusa. Per le serie completate, che non possono andare perse.
//  - `sendMessage` (queued: false) — best effort, scartato se l'iPhone non è
//    raggiungibile. Per i biometrici: accodare un HR vecchio riempirebbe la
//    coda di valori inutili ritardando quelli veri.
// =====================================================
import Combine
import Foundation
import WatchConnectivity

final class PhoneLink: NSObject, WCSessionDelegate, ObservableObject {
    static let shared = PhoneLink()

    @Published private(set) var isReachable = false
    @Published private(set) var isActivated = false

    /// Chiamato per ogni dizionario in arrivo dall'iPhone, sul main thread.
    var onMessage: (([String: Any]) -> Void)?

    private override init() { super.init() }

    func activate() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    func send(_ payload: [String: Any], queued: Bool) {
        let session = WCSession.default
        guard session.activationState == .activated else { return }
        if queued {
            session.transferUserInfo(payload)
        } else if session.isReachable {
            session.sendMessage(payload, replyHandler: nil) { _ in
                // Best effort per definizione: un fallimento qui è un dato
                // che non valeva la pena consegnare in ritardo.
            }
        }
    }

    // MARK: - WCSessionDelegate

    func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState,
                 error: Error?) {
        DispatchQueue.main.async {
            self.isActivated = (state == .activated)
            self.isReachable = session.isReachable
        }
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        DispatchQueue.main.async { self.isReachable = session.isReachable }
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        DispatchQueue.main.async { self.onMessage?(message) }
    }

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
        DispatchQueue.main.async { self.onMessage?(userInfo) }
    }

    func session(_ session: WCSession, didReceiveApplicationContext context: [String: Any]) {
        DispatchQueue.main.async { self.onMessage?(context) }
    }
}
