import Foundation
import Capacitor
import UIKit

/// Tab bar di sistema per la sola app iOS.
///
/// È una `UITabBar` messa **accanto** alla WebView, non un `UITabBarController`: il
/// contenuto è un'unica `WKWebView` che non cambia mai, quindi i view controller per
/// tab sarebbero fittizi e andrebbe impedito loro di ricreare la WebView a ogni
/// cambio tab. Una `UITabBar` come subview dà lo stesso blur, la stessa altezza e la
/// stessa gestione della safe area, con una frazione del codice.
///
/// Le voci arrivano dal JS — è lì che si conosce il ruolo — e il tocco torna indietro
/// come evento `tabSelected`. Il nativo non decide nulla.
///
/// La geometria della WebView non la tocca questo plugin ma `ViewController`
/// (`pinWebViewBottom(to:)`): la WebView è la root view del controller e va prima
/// spostata in un contenitore, cosa che il controller fa già al primo caricamento.
@objc(NativeTabBarPlugin)
public class NativeTabBarPlugin: CAPPlugin, UITabBarDelegate {
    private var tabBar: UITabBar?

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

        DispatchQueue.main.async {
            guard let host = self.host else {
                call.reject("view non disponibile")
                return
            }

            let bar = self.tabBar ?? UITabBar()
            if self.tabBar == nil {
                bar.delegate = self
                bar.translatesAutoresizingMaskIntoConstraints = false
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

            self.setVisible(true)
            self.select(selected)
            call.resolve()
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
            self.setVisible(true)
            call.resolve()
        }
    }

    @objc func hide(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.setVisible(false)
            call.resolve()
        }
    }

    public func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
        guard item.tag >= 0, item.tag < names.count else { return }
        notifyListeners("tabSelected", data: ["name": names[item.tag]])
    }

    // MARK: - Interni

    /// Il contenitore creato da `ViewController`: la barra gli va aggiunta come
    /// sorella della WebView.
    private var host: UIView? {
        (bridge?.viewController as? ViewController)?.view
    }

    private func select(_ name: String?) {
        guard let name,
              let bar = tabBar,
              let idx = names.firstIndex(of: name),
              let items = bar.items,
              idx < items.count else { return }
        bar.selectedItem = items[idx]
    }

    /// Mostra o nasconde la barra restituendo alla WebView l'altezza che le spetta:
    /// senza spostare il vincolo, da nascosta resterebbe una fascia vuota dove
    /// stava la barra.
    private func setVisible(_ visible: Bool) {
        guard let bar = tabBar,
              let vc = bridge?.viewController as? ViewController else { return }
        bar.isHidden = !visible
        vc.pinWebViewBottom(to: visible ? bar.topAnchor : nil)
    }
}
