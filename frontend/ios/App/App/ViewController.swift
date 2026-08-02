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
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(HealthKitLivePlugin())
        bridge?.registerPluginInstance(NativeTabBarPlugin())
        bridge?.registerPluginInstance(RestTimerPlugin())
        bridge?.registerPluginInstance(WatchLinkPlugin())
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

    /// Sposta la WebView dentro un contenitore, per poterle mettere **sopra** del
    /// chrome nativo (la tab bar di `NativeTabBarPlugin`).
    ///
    /// Serve perché `CAPBridgeViewController.loadView()` — che è `final` — fa
    /// `view = webView`: la WebView **è** la root view del controller. Senza
    /// contenitore, aggiungere la barra come "sorella" significherebbe in realtà
    /// aggiungerla *dentro* la WKWebView, tra le sue subview private.
    ///
    /// La WebView resta a schermo pieno, barra compresa: la barra è traslucida e il
    /// contenuto deve scorrerle **dietro**, come in ogni app di sistema. Lo spazio
    /// per non finire coperti lo riserva il CSS, usando l'altezza della barra che il
    /// plugin pubblica in `--native-tabbar-height`.
    private func wrapWebViewInContainer() {
        // `view === webView` è vero una sola volta: è la guardia contro un secondo
        // avvolgimento.
        guard let webView, webView === view else { return }

        let container = UIView(frame: view.frame)
        container.backgroundColor = webView.backgroundColor ?? .systemBackground
        view = container
        container.addSubview(webView)

        webView.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: container.topAnchor),
            webView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: container.bottomAnchor),
        ])
    }

    /// Allinea il lato nativo al tema scelto **nell'app**, che non è
    /// necessariamente quello di sistema (`stores/theme.js`: chiaro | scuro |
    /// automatico).
    ///
    /// Serve perché Capacitor imposta il fondo della WebView e della sua scroll
    /// view a `UIColor.systemBackground`, che è dinamico: con iOS in scuro resta
    /// nero anche quando l'app è chiara, e si vede — è quel nero che compare nella
    /// zona di rimbalzo, quando lo scroll cinetico va oltre il contenuto. Qui ci va
    /// il fondo pagina vero (gemello di `body` in style.css), e
    /// `overrideUserInterfaceStyle` fa seguire l'app a tutto il resto: la tab bar,
    /// essendo una subview, lo eredita senza doverglielo dire.
    func applyAppearance(dark: Bool, background: UIColor?) {
        overrideUserInterfaceStyle = dark ? .dark : .light
        guard let background else { return }
        view.backgroundColor = background
        webView?.backgroundColor = background
        webView?.scrollView.backgroundColor = background
    }
}
