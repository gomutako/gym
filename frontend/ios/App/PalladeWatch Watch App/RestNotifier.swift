// =====================================================
// Avviso di fine recupero al polso.
//
// Si usa una notifica locale e non un Timer con háptica diretta: durante un
// workout l'app resta viva, ma `WKInterfaceDevice.play` in background non è
// garantito, mentre una notifica programmata suona e vibra qualunque sia lo
// stato dell'app. È lo stesso meccanismo già collaudato sull'iPhone in
// RestTimerPlugin, quindi la semantica fra i due dispositivi coincide.
//
// Ne esiste UNA sola alla volta (id costante): riprogrammare sostituisce la
// pendente, che è il comportamento voluto quando si chiude una seconda serie.
// =====================================================
import Foundation
import UserNotifications

enum RestNotifier {
    private static let identifier = "rest-timer-watch"

    static func requestPermission() async -> Bool {
        (try? await UNUserNotificationCenter.current()
            .requestAuthorization(options: [.alert, .sound])) ?? false
    }

    static func schedule(seconds: TimeInterval, body: String) {
        guard seconds > 0 else { return }
        let content = UNMutableNotificationContent()
        content.title = "Recupero terminato"
        content.body = body
        content.sound = .default
        content.interruptionLevel = .timeSensitive

        let request = UNNotificationRequest(
            identifier: identifier, content: content,
            trigger: UNTimeIntervalNotificationTrigger(timeInterval: seconds, repeats: false))

        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: [identifier])
        center.removeDeliveredNotifications(withIdentifiers: [identifier])
        center.add(request)
    }

    static func cancel() {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: [identifier])
        center.removeDeliveredNotifications(withIdentifiers: [identifier])
    }
}
