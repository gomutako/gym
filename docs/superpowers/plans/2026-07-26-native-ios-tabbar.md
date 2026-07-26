# Tab bar nativa iOS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sostituire, **solo nell'app iOS**, la bottom nav HTML con una `UITabBar` nativa di sistema, mantenendo il web invariato.

**Architecture:** Una `UITabBar` UIKit aggiunta come subview sopra la `WKWebView`, non un `UITabBarController`. Il contenuto resta un'unica WebView: le tab non cambiano schermata, mandano un messaggio al router Vue. La sincronizzazione è bidirezionale attraverso un plugin Capacitor scritto a mano, come `HealthKitLive`.

**Tech Stack:** Swift/UIKit, Capacitor 6, Vue 3 + Vue Router.

## Global Constraints

- Node ≥ 22; `vite build` e `npx cap sync ios` **non terminano** da soli: verificare
  l'artefatto e chiudere per PID, senza `| tail`.
- Non usare `pkill -f` con pattern che matchino la shell stessa.
- Il **web non deve cambiare**: ogni pezzo nativo è dietro un controllo di piattaforma, e
  `BottomNav.vue` resta l'implementazione per browser e PWA.
- Un plugin locale non viene scoperto da solo: va registrato in
  `ViewController.capacitorDidLoad()` con `registerPluginInstance(_:)`, come già fatto per
  `HealthKitLivePlugin`.
- Testo in italiano; le etichette devono restare **identiche** a quelle di `BottomNav.vue`.
- Provisioning free: il profilo scade dopo 7 giorni, l'app va reinstallata.
- UDID del device di sviluppo: ricavarlo con `xcrun devicectl list devices`.

## Perché UITabBar e non UITabBarController

`UITabBarController` esiste per ospitare **un view controller per tab**. Qui il contenuto è
una sola WebView che non cambia mai: adottarlo significherebbe creare view controller
fittizi e impedire loro di ricreare la WebView a ogni cambio tab — complessità pura senza
alcun beneficio. Una `UITabBar` come subview dà lo stesso aspetto, lo stesso blur di
sistema e lo stesso comportamento in accessibilità, con una frazione del codice.

## Mappa delle tab

Le voci vengono **dal JS**, che è l'unico posto dove si sa il ruolo. Il nativo non decide
nulla: riceve una lista e la disegna. La chiave `name` è il nome della rotta Vue.

| `name` | Etichetta | SF Symbol | Ruoli |
|---|---|---|---|
| `dashboard` | Home | `house.fill` | tutti |
| `users` | Utenti | `person.2.fill` | admin |
| `schedule` | Corsi | `calendar` | admin |
| `clients` | Clienti | `person.2.fill` | trainer |
| `exercises` | Esercizi | `figure.strengthtraining.traditional` | trainer |
| `templates` | Modelli | `rectangle.stack.fill` | admin, trainer |
| `bookings` | Corsi | `calendar` | member |
| `training` | Allena | `play.circle.fill` | member |
| `profile` | Profilo | `person.crop.circle.fill` | tutti |

---

### Task 1: Plugin Swift `NativeTabBar`

**Files:**
- Create: `frontend/ios/App/App/NativeTabBarPlugin.swift`
- Create: `frontend/ios/App/App/NativeTabBarPlugin.m`

**Interfaces:**
- Produces (chiamabili da JS): `configure({ tabs: [{name, title, symbol}], selected: String })`, `setSelected({ name })`, `show()`, `hide()`
- Produces (evento verso JS): `tabSelected` con payload `{ name }`

- [ ] **Step 1: Scrivi il plugin**

Crea `frontend/ios/App/App/NativeTabBarPlugin.swift`:

```swift
import Foundation
import Capacitor
import UIKit

/// Tab bar di sistema per la sola app iOS.
///
/// È una UITabBar aggiunta sopra la WebView, non un UITabBarController: il
/// contenuto è un'unica WKWebView che non cambia mai, quindi i view controller
/// per tab sarebbero fittizi. Le voci arrivano dal JS — è lì che si conosce il
/// ruolo — e il tocco torna indietro come evento `tabSelected`.
@objc(NativeTabBarPlugin)
public class NativeTabBarPlugin: CAPPlugin, UITabBarDelegate {
    private var tabBar: UITabBar?
    private var names: [String] = []
    private var bottomConstraint: NSLayoutConstraint?

    /// Vincolo che tiene la WebView sopra la barra: senza, il contenuto ci
    /// scorrerebbe sotto e l'ultima riga resterebbe coperta.
    private var webViewBottom: NSLayoutConstraint?

    @objc func configure(_ call: CAPPluginCall) {
        let tabs = call.getArray("tabs", JSObject.self) ?? []
        let selected = call.getString("selected")

        DispatchQueue.main.async {
            guard let host = self.bridge?.viewController?.view,
                  let webView = self.webView else {
                call.reject("view non disponibile")
                return
            }

            let bar = self.tabBar ?? UITabBar()
            bar.delegate = self
            bar.translatesAutoresizingMaskIntoConstraints = false

            var items: [UITabBarItem] = []
            var newNames: [String] = []
            for (i, t) in tabs.enumerated() {
                guard let name = t["name"] as? String,
                      let title = t["title"] as? String else { continue }
                let symbol = (t["symbol"] as? String) ?? "circle"
                let item = UITabBarItem(
                    title: title,
                    image: UIImage(systemName: symbol),
                    tag: i
                )
                items.append(item)
                newNames.append(name)
            }
            bar.items = items
            self.names = newNames

            if self.tabBar == nil {
                host.addSubview(bar)
                webView.translatesAutoresizingMaskIntoConstraints = false
                let wvBottom = webView.bottomAnchor.constraint(equalTo: bar.topAnchor)
                self.webViewBottom = wvBottom
                NSLayoutConstraint.activate([
                    bar.leadingAnchor.constraint(equalTo: host.leadingAnchor),
                    bar.trailingAnchor.constraint(equalTo: host.trailingAnchor),
                    bar.bottomAnchor.constraint(equalTo: host.bottomAnchor),
                    webView.topAnchor.constraint(equalTo: host.topAnchor),
                    webView.leadingAnchor.constraint(equalTo: host.leadingAnchor),
                    webView.trailingAnchor.constraint(equalTo: host.trailingAnchor),
                    wvBottom,
                ])
                self.tabBar = bar
            }

            if let sel = selected, let idx = self.names.firstIndex(of: sel) {
                bar.selectedItem = bar.items?[idx]
            }
            call.resolve()
        }
    }

    @objc func setSelected(_ call: CAPPluginCall) {
        let name = call.getString("name") ?? ""
        DispatchQueue.main.async {
            guard let bar = self.tabBar, let idx = self.names.firstIndex(of: name) else {
                call.resolve(); return
            }
            bar.selectedItem = bar.items?[idx]
            call.resolve()
        }
    }

    @objc func show(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.tabBar?.isHidden = false
            // La WebView torna a fermarsi sopra la barra.
            self.webViewBottom?.isActive = false
            if let bar = self.tabBar, let wv = self.webView {
                self.webViewBottom = wv.bottomAnchor.constraint(equalTo: bar.topAnchor)
                self.webViewBottom?.isActive = true
            }
            call.resolve()
        }
    }

    /// Nasconde la barra e restituisce alla WebView tutta l'altezza: senza
    /// riattivare il vincolo resterebbe una fascia vuota dove stava la barra.
    @objc func hide(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.tabBar?.isHidden = true
            self.webViewBottom?.isActive = false
            if let host = self.bridge?.viewController?.view, let wv = self.webView {
                self.webViewBottom = wv.bottomAnchor.constraint(equalTo: host.bottomAnchor)
                self.webViewBottom?.isActive = true
            }
            call.resolve()
        }
    }

    public func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
        guard item.tag < names.count else { return }
        notifyListeners("tabSelected", data: ["name": names[item.tag]])
    }
}
```

- [ ] **Step 2: Dichiara i metodi al bridge**

Crea `frontend/ios/App/App/NativeTabBarPlugin.m` (senza questo file i metodi non sono
visibili a Objective-C e il bridge non li espone):

```objc
#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(NativeTabBarPlugin, "NativeTabBar",
  CAP_PLUGIN_METHOD(configure, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(setSelected, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(show, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(hide, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(addListener, CAPPluginReturnCallback);
  CAP_PLUGIN_METHOD(removeAllListeners, CAPPluginReturnPromise);
)
```

- [ ] **Step 3: Registra il plugin**

In `frontend/ios/App/App/ViewController.swift`, dentro `capacitorDidLoad()`, accanto alla
registrazione esistente:

```swift
        bridge?.registerPluginInstance(NativeTabBarPlugin())
```

- [ ] **Step 4: Verifica che compili**

```bash
UDID=$(xcrun devicectl list devices | awk '/available \(paired\)/ {print $3; exit}')
xcodebuild -workspace frontend/ios/App/App.xcworkspace -scheme App \
  -configuration Debug -destination "id=$UDID" -derivedDataPath /tmp/gym-dd \
  -allowProvisioningUpdates build 2>&1 | grep -E "BUILD SUCCEEDED|BUILD FAILED|error:"
```

Atteso: `** BUILD SUCCEEDED **`. Se i file Swift non risultano nel target, vanno aggiunti
al progetto Xcode (è già successo con `HealthKitLivePlugin`: serviva la gemma `xcodeproj`
o l'aggiunta manuale da Xcode).

- [ ] **Step 5: Commit**

```bash
git add frontend/ios/App/App/NativeTabBarPlugin.swift frontend/ios/App/App/NativeTabBarPlugin.m frontend/ios/App/App/ViewController.swift
git commit -m "feat(ios): plugin NativeTabBar (UITabBar di sistema)

UITabBar come subview sopra la WebView, non UITabBarController: il contenuto
è un'unica WKWebView che non cambia mai, quindi i view controller per tab
sarebbero fittizi. Le voci arrivano dal JS, che è l'unico posto dove si
conosce il ruolo."
```

---

### Task 2: Wrapper JS platform-agnostic

**Files:**
- Create: `frontend/src/lib/native-tabbar.js`

**Interfaces:**
- Consumes: `NativeTabBar` dal bridge Capacitor.
- Produces: `isSupported()`, `configure(tabs, selected)`, `setSelected(name)`, `show()`, `hide()`, `onTabSelected(cb): unsubscribe`

- [ ] **Step 1: Scrivi il wrapper**

Crea `frontend/src/lib/native-tabbar.js`:

```js
// =====================================================
// Accesso alla tab bar nativa iOS. Sul web ogni funzione è un no-op, così le
// viste non devono sapere su cosa stanno girando: è lo stesso schema di
// lib/healthkit.js.
// =====================================================
import { Capacitor, registerPlugin } from '@capacitor/core';

const NativeTabBar = registerPlugin('NativeTabBar');

/** Vero solo nell'app iOS: nel browser e nella PWA resta la BottomNav HTML. */
export function isSupported() {
  return Capacitor.getPlatform() === 'ios' && Capacitor.isNativePlatform();
}

export async function configure(tabs, selected) {
  if (!isSupported()) return;
  await NativeTabBar.configure({ tabs, selected });
}

export async function setSelected(name) {
  if (!isSupported()) return;
  await NativeTabBar.setSelected({ name });
}

export async function show() {
  if (!isSupported()) return;
  await NativeTabBar.show();
}

export async function hide() {
  if (!isSupported()) return;
  await NativeTabBar.hide();
}

/** Restituisce la funzione per disiscriversi (null sul web). */
export function onTabSelected(cb) {
  if (!isSupported()) return null;
  const handle = NativeTabBar.addListener('tabSelected', (e) => cb(e.name));
  return () => { handle.then((h) => h.remove()).catch(() => {}); };
}
```

- [ ] **Step 2: Verifica che la build web resti intatta**

```bash
rm -f frontend/dist/index.html
npm run build > /tmp/build-tabbar.log 2>&1 &
# attendi dist/index.html, chiudi per PID
grep -E "built in|error" /tmp/build-tabbar.log
```

Atteso: build riuscita. Il wrapper non deve rompere il web.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/native-tabbar.js
git commit -m "feat(frontend): wrapper platform-agnostic per la tab bar nativa"
```

---

### Task 3: Sorgente unica delle tab

**Files:**
- Create: `frontend/src/lib/nav-tabs.js`
- Modify: `frontend/src/components/BottomNav.vue` (usa la nuova sorgente)

**Interfaces:**
- Produces: `tabsForRole(role): [{ name, label, icon, symbol }]`

- [ ] **Step 1: Estrai le tab in un modulo**

Crea `frontend/src/lib/nav-tabs.js`:

```js
// =====================================================
// Voci di navigazione, in un unico posto: le consumano sia BottomNav.vue (web)
// sia la tab bar nativa iOS. Tenerle in due elenchi separati significherebbe
// che ogni voce nuova va aggiunta due volte, e prima o poi divergono.
//
// `icon` è il nome dell'SVG inline usato dal web, `symbol` l'SF Symbol
// equivalente usato da UIKit.
// =====================================================
const HOME = { name: 'dashboard', label: 'Home', icon: 'home', symbol: 'house.fill' };
const PROFILE = { name: 'profile', label: 'Profilo', icon: 'user', symbol: 'person.crop.circle.fill' };
const TEMPLATES = { name: 'templates', label: 'Modelli', icon: 'stack', symbol: 'rectangle.stack.fill' };

export function tabsForRole(role) {
  if (role === 'admin') {
    return [
      HOME,
      { name: 'users', label: 'Utenti', icon: 'group', symbol: 'person.2.fill' },
      { name: 'schedule', label: 'Corsi', icon: 'calendar', symbol: 'calendar' },
      TEMPLATES,
      PROFILE,
    ];
  }
  if (role === 'trainer') {
    return [
      HOME,
      { name: 'clients', label: 'Clienti', icon: 'group', symbol: 'person.2.fill' },
      { name: 'exercises', label: 'Esercizi', icon: 'dumbbell', symbol: 'figure.strengthtraining.traditional' },
      TEMPLATES,
      PROFILE,
    ];
  }
  return [
    HOME,
    { name: 'bookings', label: 'Corsi', icon: 'calendar', symbol: 'calendar' },
    { name: 'training', label: 'Allena', icon: 'play', symbol: 'play.circle.fill' },
    PROFILE,
  ];
}
```

- [ ] **Step 2: Fai usare il modulo a BottomNav**

In `frontend/src/components/BottomNav.vue`, sostituisci il `computed` locale `tabs` con:

```js
import { tabsForRole } from '@/lib/nav-tabs';

const tabs = computed(() => tabsForRole(auth.role));
```

Lascia invariato tutto il resto del componente: le etichette e i nomi degli SVG sono gli
stessi, quindi il web non cambia di una virgola.

- [ ] **Step 3: Verifica il web**

```bash
npm run dev:fe
```

Accedi con i tre ruoli e controlla che la bottom nav mostri esattamente le voci di prima.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/nav-tabs.js frontend/src/components/BottomNav.vue
git commit -m "refactor(nav): voci di navigazione in un unico modulo

Le consumeranno sia la BottomNav del web sia la tab bar nativa iOS: due
elenchi separati divergerebbero alla prima voce aggiunta."
```

---

### Task 4: Integrazione nel layout

**Files:**
- Modify: `frontend/src/layouts/AppLayout.vue`

- [ ] **Step 1: Sostituisci il contenuto del layout**

`frontend/src/layouts/AppLayout.vue` diventa:

```vue
<script setup>
// Shell mobile: contenuto scrollabile + navigazione.
//
// Su iOS nativo la navigazione è una UITabBar di sistema, disegnata FUORI dalla
// WebView: lì la BottomNav HTML non va montata (sarebbero due barre) e non
// serve il padding inferiore, perché è la WebView stessa a fermarsi sopra la
// barra. Sul web resta tutto com'era.
import { computed, watch, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { tabsForRole } from '@/lib/nav-tabs';
import * as tabbar from '@/lib/native-tabbar';
import BottomNav from '@/components/BottomNav.vue';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const native = tabbar.isSupported();
let unsubscribe = null;

// Il nome della tab corrispondente alla rotta: le viste di dettaglio (es. la
// sessione di allenamento) non sono tab, e in quel caso non si tocca la
// selezione, così la barra continua a indicare la sezione da cui si è entrati.
const currentTab = computed(() => route.name);

async function pushTabs() {
  if (!native) return;
  const tabs = tabsForRole(auth.role).map((t) => ({
    name: t.name, title: t.label, symbol: t.symbol,
  }));
  await tabbar.configure(tabs, currentTab.value);
}

onMounted(async () => {
  if (!native) return;
  await pushTabs();
  unsubscribe = tabbar.onTabSelected((name) => {
    if (route.name !== name) router.push({ name });
  });
});

onUnmounted(() => {
  if (unsubscribe) unsubscribe();
  // Uscendo dall'area protetta (logout) la barra non deve restare appesa
  // sopra la schermata di login.
  if (native) tabbar.hide();
});

// Il ruolo si conosce solo dopo il caricamento del profilo: le tab vanno
// rimandate quando cambia, altrimenti restano quelle del ruolo sbagliato.
watch(() => auth.role, pushTabs);

// Navigazione dall'interno della pagina (link, redirect delle guardie): la
// selezione della barra va riallineata, altrimenti indica una sezione diversa
// da quella mostrata.
watch(currentTab, (name) => {
  if (native && name) tabbar.setSelected(name);
});
</script>

<template>
  <div class="mx-auto flex min-h-screen max-w-md flex-col bg-gray-50">
    <main
      class="flex-1 px-4 pt-[calc(env(safe-area-inset-top)+1rem)]"
      :class="native ? 'pb-4' : 'pb-[calc(env(safe-area-inset-bottom)+6rem)]'"
    >
      <RouterView />
    </main>

    <BottomNav v-if="!native" />
  </div>
</template>
```

- [ ] **Step 2: Verifica che il web non cambi**

```bash
npm run dev:fe
```

Nel browser `native` è `false`: bottom nav presente e padding inferiore invariato.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/layouts/AppLayout.vue
git commit -m "feat(ios): usa la tab bar nativa al posto della BottomNav

Su iOS nativo la BottomNav HTML non viene montata e il padding inferiore
sparisce: è la WebView a fermarsi sopra la barra di sistema. Sul web nulla
cambia."
```

---

### Task 5: Verifica sul device

- [ ] **Step 1: Compila e installa**

```bash
UDID=$(xcrun devicectl list devices | awk '/available \(paired\)/ {print $3; exit}')
npm run build                     # attendi dist/index.html, chiudi per PID
npx cap sync ios                  # attendi ios/App/App/public/index.html, chiudi per PID
xcodebuild -workspace frontend/ios/App/App.xcworkspace -scheme App \
  -configuration Debug -destination "id=$UDID" -derivedDataPath /tmp/gym-dd \
  -allowProvisioningUpdates build
xcrun devicectl device install app --device $UDID /tmp/gym-dd/Build/Products/Debug-iphoneos/App.app
xcrun devicectl device process launch --device $UDID --console local.gym.app
```

Se il lancio dà `FBSOpenApplicationErrorDomain error 7`, il telefono è bloccato:
sbloccare e rilanciare.

- [ ] **Step 2: Controlli sul device**

1. la barra è quella di sistema: blur, altezza e tipografia iOS, safe area gestita da UIKit;
2. **una sola** barra — se ne vedi due, `native` non è vero e `BottomNav` è ancora montata;
3. toccando una tab la schermata cambia e la selezione resta coerente;
4. navigando **da dentro** la pagina (es. dal profilo a una scheda) la tab evidenziata
   resta quella della sezione giusta;
5. **logout**: la barra sparisce e non resta sopra il login;
6. rientrando con un **ruolo diverso** le voci cambiano di conseguenza;
7. nessuna fascia vuota in fondo: il contenuto arriva fino alla barra.

- [ ] **Step 3: Commit di eventuali correzioni e aggiornamento del CHANGELOG**

Sotto `## [Non rilasciato]`, in `### Aggiunto`:

```markdown
- **Tab bar nativa su iOS**: nell'app la navigazione è ora una `UITabBar` di sistema —
  blur, tipografia e safe area gestite da UIKit — mentre il web continua a usare la barra
  HTML. Le voci restano definite in un unico modulo condiviso.
```

---

## Punti aperti

Da decidere alla prima prova sul device, perché sono scelte che si valutano meglio
vedendole:

1. **Sessione di allenamento**: oggi mostra la barra. Nasconderla (`tabbar.hide()` al mount
   di `SessionView`) darebbe più spazio ai dati e ridurrebbe i tocchi accidentali durante
   l'esercizio — ma toglie la via d'uscita rapida.
2. **Scroll-to-top al secondo tocco** sulla tab attiva: è comportamento standard iOS e da
   nativo si implementa in poche righe, ma richiede di dire alla WebView di scrollare in
   cima.
3. **Badge numerici** sulle tab (es. prenotazioni in attesa): `UITabBarItem.badgeValue` è
   gratis a questo punto, ma serve prima decidere quale dato mostrare.
