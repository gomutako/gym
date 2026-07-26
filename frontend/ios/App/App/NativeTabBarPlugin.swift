import Foundation
import Capacitor
import UIKit

/// `UITabBar` che avvisa quando la propria altezza cambia.
///
/// L'altezza non è una costante: 49pt più l'home indicator in verticale, meno in
/// orizzontale (dove l'indicator non c'è), diversa ancora su iPad. Il CSS deve
/// riservare esattamente quello spazio, quindi il valore va comunicato, non
/// indovinato.
private final class HeightReportingTabBar: UITabBar {
    var onHeightChange: ((CGFloat) -> Void)?
    private var lastHeight: CGFloat = 0

    override func layoutSubviews() {
        super.layoutSubviews()
        guard abs(bounds.height - lastHeight) > 0.5 else { return }
        lastHeight = bounds.height
        onHeightChange?(bounds.height)
    }
}

/// Tab bar di sistema per la sola app iOS.
///
/// È una `UITabBar` messa **sopra** la WebView, non un `UITabBarController`: il
/// contenuto è un'unica `WKWebView` che non cambia mai, quindi i view controller per
/// tab sarebbero fittizi e andrebbe impedito loro di ricreare la WebView a ogni
/// cambio tab. Una `UITabBar` come subview dà lo stesso blur, la stessa altezza e la
/// stessa gestione della safe area, con una frazione del codice.
///
/// La WebView resta a schermo pieno e il contenuto scorre **dietro** la barra
/// traslucida, come nelle app di sistema: ritagliarla sopra la barra spegnerebbe
/// l'effetto. A non far finire il contenuto sotto la barra pensa il CSS, con
/// l'altezza che questo plugin restituisce (e rimanda a ogni cambio via
/// `heightChanged`).
///
/// Le voci arrivano dal JS — è lì che si conosce il ruolo — e il tocco torna indietro
/// come evento `tabSelected`. Il nativo non decide nulla.
@objc(NativeTabBarPlugin)
public class NativeTabBarPlugin: CAPPlugin, UITabBarDelegate {
    private var tabBar: HeightReportingTabBar?

    /// Nomi delle rotte Vue, nello stesso ordine degli item: il `tag` dell'item è
    /// l'indice in questo array.
    private var names: [String] = []

    /// Crea (la prima volta) la barra, ne aggiorna le voci e la mostra.
    ///
    /// Mostrarla fa parte di `configure` di proposito: dopo un logout la barra resta
    /// nascosta e l'istanza del plugin sopravvive, quindi un login successivo
    /// riconfigurerebbe una barra invisibile.
    @objc func configure(_ call: CAPPluginCall) {
        let tabs = call.getArray("tabs", JSObject.self) ?? []
        let selected = call.getString("selected")
        let tint = call.getString("tint")
        let dark = call.getBool("dark") ?? false

        DispatchQueue.main.async {
            guard let host = self.host else {
                call.reject("view non disponibile")
                return
            }

            let bar = self.tabBar ?? HeightReportingTabBar()
            if self.tabBar == nil {
                bar.delegate = self
                bar.translatesAutoresizingMaskIntoConstraints = false
                bar.onHeightChange = { [weak self] height in
                    guard self?.tabBar?.isHidden == false else { return }
                    self?.notifyListeners("heightChanged", data: ["height": height])
                }
                host.addSubview(bar)
                // Il bordo inferiore va sul fondo del contenitore, non sulla safe
                // area: è `UITabBar` stessa a crescere per coprire l'home indicator.
                NSLayoutConstraint.activate([
                    bar.leadingAnchor.constraint(equalTo: host.leadingAnchor),
                    bar.trailingAnchor.constraint(equalTo: host.trailingAnchor),
                    bar.bottomAnchor.constraint(equalTo: host.bottomAnchor),
                ])
                self.tabBar = bar
            }

            var items: [UITabBarItem] = []
            var newNames: [String] = []
            for tab in tabs {
                guard let name = tab["name"] as? String,
                      let title = tab["title"] as? String else { continue }
                let symbol = (tab["symbol"] as? String) ?? "circle"
                let item = UITabBarItem(
                    title: title,
                    image: UIImage(systemName: symbol),
                    tag: items.count
                )
                items.append(item)
                newNames.append(name)
            }
            bar.setItems(items, animated: false)
            self.names = newNames

            // Il tema dell'app è una scelta dell'utente (chiaro | scuro | automatico),
            // non necessariamente quella di sistema: senza override, chi forza il
            // chiaro con iOS in scuro vedrebbe una barra scura sotto un'app chiara.
            bar.overrideUserInterfaceStyle = dark ? .dark : .light
            if let tint, let color = UIColor(hex: tint) {
                bar.tintColor = color
            }

            bar.isHidden = false
            self.select(selected)
            call.resolve(["height": self.currentHeight()])
        }
    }

    /// Evidenzia la tab della rotta corrente. Un nome che non è una tab (es. la
    /// sessione di allenamento) lascia la selezione com'è, così la barra continua a
    /// indicare la sezione da cui si è entrati.
    @objc func setSelected(_ call: CAPPluginCall) {
        let name = call.getString("name")
        DispatchQueue.main.async {
            self.select(name)
            call.resolve()
        }
    }

    @objc func show(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.tabBar?.isHidden = false
            call.resolve(["height": self.currentHeight()])
        }
    }

    /// Nasconde la barra. L'altezza restituita è 0: il contenuto può riprendersi
    /// lo spazio che le era riservato.
    @objc func hide(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.tabBar?.isHidden = true
            call.resolve(["height": 0])
        }
    }

    public func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
        guard item.tag >= 0, item.tag < names.count else { return }
        notifyListeners("tabSelected", data: ["name": names[item.tag]])
    }

    // MARK: - Interni

    /// Il contenitore creato da `ViewController`: la barra gli va aggiunta come
    /// sorella della WebView, sopra di essa.
    private var host: UIView? {
        (bridge?.viewController as? ViewController)?.view
    }

    /// Altezza in punti (= px CSS nella WebView), 0 se la barra non c'è o è
    /// nascosta. Il layout va forzato: appena creata la barra non ha ancora un
    /// frame, e risponderebbe 0.
    private func currentHeight() -> CGFloat {
        guard let bar = tabBar, !bar.isHidden else { return 0 }
        bar.superview?.layoutIfNeeded()
        return bar.bounds.height
    }

    private func select(_ name: String?) {
        guard let name,
              let bar = tabBar,
              let idx = names.firstIndex(of: name),
              let items = bar.items,
              idx < items.count else { return }
        bar.selectedItem = items[idx]
    }
}

/// Parsing di `#RRGGBB`: la palette vive nel JS (`lib/palette.js`), che è anche la
/// sorgente di Tailwind — riscrivere gli hex qui significherebbe averne due copie,
/// e quella dimenticata sarebbe questa, che non si vede finché non apri l'app.
private extension UIColor {
    convenience init?(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
        self.init(
            red: CGFloat((v >> 16) & 0xFF) / 255,
            green: CGFloat((v >> 8) & 0xFF) / 255,
            blue: CGFloat(v & 0xFF) / 255,
            alpha: 1
        )
    }
}
