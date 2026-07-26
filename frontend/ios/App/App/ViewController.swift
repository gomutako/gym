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
    }
}
