import UIKit
import Capacitor

/// Sottoclasse del bridge che registra i plugin **locali** dell'app.
///
/// Capacitor non scopre i plugin enumerando le classi compilate: `registerPlugins()`
/// legge `capacitor.config.json` dal bundle e registra soltanto le classi elencate in
/// `packageClassList`. Quella lista la genera la CLI a partire dai pacchetti npm, quindi
/// un plugin scritto a mano dentro il progetto Xcode — come `HealthKitLivePlugin` — non
/// vi compare e per il bridge non esiste: ogni chiamata JS finisce in
/// "HealthKitLive plugin is not implemented on ios", anche se la classe è regolarmente
/// compilata nel binario.
///
/// `capacitorDidLoad()` è l'hook previsto per rimediare. Va usato
/// `registerPluginInstance(_:)` e non `registerPluginType(_:)`: quest'ultimo esce subito
/// quando `autoRegisterPlugins` è attivo, che è il default.
///
/// Perché funzioni, `Main.storyboard` deve puntare a questa classe e non direttamente a
/// `CAPBridgeViewController`.
class ViewController: CAPBridgeViewController {
    /// Vincolo che decide dove finisce la WebView: sul fondo del contenitore, oppure
    /// sopra la tab bar nativa. Lo sposta `pinWebViewBottom(to:)`.
    private var webViewBottom: NSLayoutConstraint?

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(HealthKitLivePlugin())
        bridge?.registerPluginInstance(NativeTabBarPlugin())
    }

    /// Ripristina il rimbalzo elastico di fine lista.
    ///
    /// `CAPBridgeViewController.prepareWebView` forza `scrollView.bounces = false` e non
    /// espone alcuna opzione per cambiarlo (`ios.scrollEnabled` accende o spegne lo
    /// scroll, non l'elasticità). Essendo una proprietà della scroll view nativa, dal
    /// lato web non è raggiungibile: nessuna regola CSS — `overscroll-behavior` inclusa
    /// — può riaccenderla. Va quindi sovrascritta qui, dopo che il bridge ha preparato
    /// la web view.
    override func viewDidLoad() {
        super.viewDidLoad()
        webView?.scrollView.bounces = true
        webView?.scrollView.alwaysBounceVertical = true
        wrapWebViewInContainer()
    }

    /// Sposta la WebView dentro un contenitore, per poterle mettere accanto del
    /// chrome nativo (la tab bar di `NativeTabBarPlugin`).
    ///
    /// Serve perché `CAPBridgeViewController.loadView()` — che è `final` — fa
    /// `view = webView`: la WebView **è** la root view del controller. Senza
    /// contenitore, aggiungere la barra come "sorella" significherebbe in realtà
    /// aggiungerla *dentro* la WebView, e ridimensionare la WebView con Auto Layout
    /// sarebbe impossibile (la root view la posiziona la window, e disattivarle
    /// `translatesAutoresizingMaskIntoConstraints` la lascerebbe senza frame →
    /// schermo bianco).
    ///
    /// Effetto collaterale utile: quando la barra è visibile la WebView non arriva
    /// più al bordo inferiore dello schermo, quindi UIKit smette di propagarle la
    /// safe area di sotto e lato CSS `env(safe-area-inset-bottom)` vale 0 — è la
    /// barra a coprire l'home indicator.
    private func wrapWebViewInContainer() {
        // `view === webView` è vero una sola volta: è la guardia contro un secondo
        // avvolgimento.
        guard let webView, webView === view else { return }

        let container = UIView(frame: view.frame)
        container.backgroundColor = webView.backgroundColor ?? .systemBackground
        view = container
        container.addSubview(webView)

        webView.translatesAutoresizingMaskIntoConstraints = false
        let bottom = webView.bottomAnchor.constraint(equalTo: container.bottomAnchor)
        webViewBottom = bottom
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: container.topAnchor),
            webView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            bottom,
        ])
    }

    /// Ferma la WebView sopra `anchor` (il bordo alto della tab bar) oppure, con
    /// `nil`, le ridà tutto il contenitore. Senza questo spostamento, nascondere la
    /// barra lascerebbe una fascia vuota al suo posto.
    func pinWebViewBottom(to anchor: NSLayoutYAxisAnchor?) {
        guard let webView, let container = webView.superview, container !== webView else { return }
        webViewBottom?.isActive = false
        let bottom = webView.bottomAnchor.constraint(equalTo: anchor ?? container.bottomAnchor)
        bottom.isActive = true
        webViewBottom = bottom
    }
}
