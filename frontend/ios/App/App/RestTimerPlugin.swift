// =====================================================
// Notifica locale di fine recupero fra le serie.
//
// Non si usa @capacitor/local-notifications: la versione compatibile con
// Capacitor 6 non espone `interruptionLevel`, quindi la notifica non sarebbe
// Time Sensitive e una Full Immersion la silenzierebbe.
//
// Ne esiste UNA sola alla volta (id costante): programmare di nuovo sostituisce
// quella pendente, che è esattamente il comportamento voluto quando si segna
// "fatto" su una seconda serie.
// =====================================================
import Foundation
import Capacitor
import UserNotifications

@objc(RestTimerPlugin)
public class RestTimerPlugin: CAPPlugin, UNUserNotificationCenterDelegate {
    /// Unica notifica gestita dal plugin.
    private static let identifier = "rest-timer"

    override public func load() {
        UNUserNotificationCenter.current().delegate = self
    }

    @objc func requestPermission(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current()
            .requestAuthorization(options: [.alert, .sound]) { granted, _ in
                call.resolve(["granted": granted])
            }
    }

    @objc func schedule(_ call: CAPPluginCall) {
        let seconds = call.getDouble("seconds") ?? 0
        guard seconds > 0 else {
            call.reject("Durata del recupero non valida")
            return
        }

        let content = UNMutableNotificationContent()
        content.title = call.getString("title") ?? "Recupero terminato"
        content.body = call.getString("body") ?? ""
        content.sound = .default
        // La categoria che permette di superare la Full Immersion. `interruptionLevel`
        // esiste solo da iOS 15: il deployment target del progetto è 13.0, quindi va
        // dietro un controllo di disponibilità (sui device più vecchi la notifica resta
        // comunque valida, solo senza la priorità Time Sensitive).
        if #available(iOS 15.0, *) {
            content.interruptionLevel = .timeSensitive
        }
        content.userInfo = [
            "sessionId": call.getString("sessionId") ?? "",
            "exerciseIndex": call.getInt("exerciseIndex") ?? 0,
        ]

        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: seconds, repeats: false)
        let request = UNNotificationRequest(
            identifier: Self.identifier, content: content, trigger: trigger)

        let center = UNUserNotificationCenter.current()
        // Rimuove esplicitamente la pendente: `add` con lo stesso id la
        // sostituisce, ma toglie di mezzo anche una eventuale già consegnata.
        center.removePendingNotificationRequests(withIdentifiers: [Self.identifier])
        center.removeDeliveredNotifications(withIdentifiers: [Self.identifier])
        center.add(request) { error in
            if let error = error { call.reject(error.localizedDescription) }
            else { call.resolve() }
        }
    }

    @objc func cancel(_ call: CAPPluginCall) {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: [Self.identifier])
        center.removeDeliveredNotifications(withIdentifiers: [Self.identifier])
        call.resolve()
    }

    /// Tocco sulla notifica: il lato JS naviga all'esercizio.
    public func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let info = response.notification.request.content.userInfo
        notifyListeners("restTimerTapped", data: [
            "sessionId": info["sessionId"] as? String ?? "",
            "exerciseIndex": info["exerciseIndex"] as? Int ?? 0,
        ])
        completionHandler()
    }

    /// Con l'app in primo piano iOS non mostrerebbe nulla: il telefono può
    /// essere in tasca con l'app aperta, quindi l'avviso serve lo stesso.
    public func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        // `.banner` esiste solo da iOS 14: sotto quella versione si usa `.alert`
        // (deprecato ma disponibile fin dalla 10), stesso identico effetto visivo.
        if #available(iOS 14.0, *) {
            completionHandler([.banner, .sound])
        } else {
            completionHandler([.alert, .sound])
        }
    }
}
