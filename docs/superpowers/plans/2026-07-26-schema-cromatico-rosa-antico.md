# Schema cromatico rosa antico — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sostituire l'indigo con la scala di rosa antico derivata da `#D3919E`, rimettere a
sistema i colori delle chip, e tingere di rosa la selezione della tab bar nativa iOS.

**Architecture:** Una sola sorgente per la palette (`frontend/src/lib/palette.js`) importata
sia da `tailwind.config.js` sia dal codice che passa la tinta al plugin iOS. Le viste non
cambiano struttura: cambiano i token (`brand` resta il nome della classe) e le mappe locali
delle chip. Il tema scuro continua a vivere nelle rimappature `html.dark` di `style.css`.

**Tech Stack:** TailwindCSS 3, Vue 3, Swift/UIKit (Capacitor 6).

**Spec:** `docs/superpowers/specs/2026-07-26-schema-cromatico-rosa-antico-design.md`

## Global Constraints

- La scala, verbatim:
  `50 #FFF2F4`, `100 #FFE3E8`, `200 #F7C9D1`, `300 #D3919E`, `400 #C87D8C`, `500 #B7687A`,
  `600 #A45668`, `700 #8E4858`, `800 #743947`, `900 #5C2D38`.
- `brand.DEFAULT = #A45668` (passo 600) e `brand.dark = #8E4858` (700): i 144 usi esistenti
  della classe `brand` non si toccano.
- Forma canonica: **chip = `-100` / `-700`**, **banner = `-50` / `-700`**.
- Nessun `rose-*` e nessun `indigo` devono sopravvivere in `frontend/src`.
- `npm run build` e `npx cap sync ios` **non terminano** da soli: verificare l'artefatto e
  chiudere per PID, senza `| tail`.
- UDID del device di sviluppo: `xcrun devicectl list devices` — attenzione, la prima riga
  `available (paired)` è l'**Apple Watch**; l'iPhone 15 Pro Max è
  `0669878A-8208-5DFE-97B3-F5FADADDA6EC`.
- Il progetto non ha test unitari: la verifica è build + grep + contrasti calcolati + prova
  sul device.

---

### Task 1: Palette come sorgente unica

**Files:**
- Create: `frontend/src/lib/palette.js`
- Modify: `frontend/tailwind.config.js`

**Interfaces:**
- Produces: `brand` (oggetto `{50..900: hex}`), `tabBarTint` (`{ light, dark }`).

- [ ] **Step 1: Scrivi il modulo della palette**

Crea `frontend/src/lib/palette.js`:

```js
// =====================================================
// Palette del brand: unica sorgente per Tailwind e per il codice.
//
// La scala è derivata dal rosa antico #D3919E (passo 300) conservandone la
// tonalità in OKLCh e variando la profondità: l'app resta *quel* rosa, ma i
// passi profondi possono portare testo, cosa che il 300 non può fare (2,53:1
// sul bianco, sotto la soglia di 4,5:1).
//
// La importa anche tailwind.config.js: duplicare gli hex significherebbe che
// alla prima ritinteggiatura una delle due copie resta indietro — e la copia
// dimenticata sarebbe quella nativa, che non si vede finché non apri l'app.
// =====================================================
export const brand = {
  50: '#FFF2F4',
  100: '#FFE3E8', // fondo delle chip
  200: '#F7C9D1',
  300: '#D3919E', // la tinta scelta: superfici, gradienti, testo del tema scuro
  400: '#C87D8C',
  500: '#B7687A',
  600: '#A45668', // primario: testo, bordi, bottoni pieni, tab attiva (5,11:1)
  700: '#8E4858', // testo su chip rosa (5,41:1), stato premuto
  800: '#743947',
  900: '#5C2D38',
};

/**
 * Tinta della tab bar nativa iOS. Due valori perché la barra vive su due fondi:
 * chiaro (dove serve il passo profondo) e scuro (dove il 300 dà il meglio).
 */
export const tabBarTint = {
  light: brand[600],
  dark: brand[300],
};
```

- [ ] **Step 2: Fai importare la scala a Tailwind**

`frontend/tailwind.config.js` diventa:

```js
/** @type {import('tailwindcss').Config} */
import { brand } from './src/lib/palette.js';

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Rosa antico: la scala sta in src/lib/palette.js perché la usa anche il
        // codice che tinge la tab bar nativa. DEFAULT è il passo 600, così le
        // classi `brand` già scritte nelle viste continuano a valere.
        brand: {
          ...brand,
          DEFAULT: brand[600],
          dark: brand[700],
        },
      },
      // Spazio per la bottom navigation + safe-area dei device con notch
      spacing: {
        'safe-bottom': 'env(safe-area-inset-bottom)',
      },
    },
  },
  plugins: [],
};
```

- [ ] **Step 3: Verifica che il nuovo primario finisca nel CSS**

```bash
rm -f frontend/dist/index.html
(npm run build > /tmp/tw-build.log 2>&1 &)
until grep -qE "built in|error" /tmp/tw-build.log; do sleep 1; done
grep -E "built in|error" /tmp/tw-build.log
grep -c "164,86,104\|#a45668\|rgb(164 86 104)" frontend/dist/assets/*.css
ps -Ao pid,command | awk '/vite build/ && !/awk/ && !/zsh -c/ {print $1}' | while read p; do kill $p; done
```

Atteso: build riuscita e almeno un'occorrenza del nuovo primario (Tailwind emette
`--tw-*` e `rgb(...)`, quindi cerca entrambe le forme). Nessuna occorrenza di `79,70,229`
(l'indigo `#4f46e5`) generata da `brand`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/palette.js frontend/tailwind.config.js
git commit -m "feat(theme): scala rosa antico come sorgente unica della palette

Derivata da #D3919E conservandone la tonalità: la tinta scelta è il passo 300,
il primario operativo è il 600 perché il 300 ha 2,53:1 sul bianco e nell'app il
brand porta 48 scritte, 53 bordi e 27 bottoni con testo bianco sopra. La scala
sta in un modulo JS perché la importano sia Tailwind sia il codice che tinge la
tab bar nativa."
```

---

### Task 2: Le chip come sistema

**Files:**
- Modify: `frontend/src/views/admin/UsersView.vue:28-32`
- Modify: `frontend/src/components/ClientCard.vue:22-26`
- Modify: `frontend/src/views/ProfileView.vue:107-111`
- Modify: `frontend/src/components/ServiceStatusBadge.vue:28-30`
- Modify: i 14 file di `frontend/src` che contengono `rose-` (sostituzione meccanica)

- [ ] **Step 1: Chip dei ruoli**

In `frontend/src/views/admin/UsersView.vue`, sostituisci la mappa e il suo commento:

```js
// Chip del ruolo. Tinte fuori dalla scala verde/ambra/rossa degli stati: nella
// stessa riga convivono due chip, e riusare quei colori farebbe leggere il ruolo
// come uno stato. Il celeste del trainer sostituisce l'indigo, che era il colore
// del vecchio brand ed era rimasto orfano.
const roleBadgeClass = {
  admin: 'bg-brand-100 text-brand-700',
  trainer: 'bg-sky-100 text-sky-700',
  member: 'bg-gray-100 text-gray-600',
};
```

Nota: `bg-brand/10 text-brand` diventa `bg-brand-100 text-brand-700` perché sul fondo rosa
il primario dà 4,24:1 mentre il passo 700 dà 5,41:1.

- [ ] **Step 2: Chip dell'abbonamento**

In `frontend/src/components/ClientCard.vue`:

```js
const statusClass = {
  attivo: 'bg-emerald-100 text-emerald-700',
  scaduto: 'bg-red-100 text-red-700',
  nessuno: 'bg-gray-100 text-gray-500',
};
```

In `frontend/src/views/ProfileView.vue` (le tonalità erano 50/600, fuori forma):

```js
const badgeClass = {
  active: 'bg-emerald-100 text-emerald-700',
  expired: 'bg-red-100 text-red-700',
  scheduled: 'bg-amber-100 text-amber-700',
};
```

- [ ] **Step 3: Pallino dello stato servizi**

In `frontend/src/components/ServiceStatusBadge.vue`:

```js
  down: 'bg-red-500',
```

- [ ] **Step 4: Sostituzione meccanica di `rose` con `red`**

```bash
cd /Users/gomutako/Developer/gym/frontend/src
grep -rl "rose-" . | grep -v "^./style.css" | while read f; do
  sed -i '' -E 's/(bg|text|border|ring)-rose-([0-9]+)/\1-red-\2/g' "$f"
done
grep -rn "rose-" . | grep -v "^./style.css"   # atteso: nessun output
```

`style.css` è escluso di proposito: le sue righe `rose-*` non vanno tradotte ma **eliminate**,
e lo fa il Task 3.

- [ ] **Step 5: Banner al passo 700**

I banner (`bg-red-50` con testo sopra) stanno a 4,41:1, appena sotto soglia:

```bash
cd /Users/gomutako/Developer/gym/frontend/src
grep -rl "text-red-600\|text-emerald-600" . | while read f; do
  sed -i '' -e 's/text-red-600/text-red-700/g' -e 's/text-emerald-600/text-emerald-700/g' "$f"
done
git diff --stat
```

- [ ] **Step 6: Testo brand sui fondi rosa tenui**

`bg-brand/10` con `text-brand` sopra dà 4,24:1 — sotto soglia, come per la chip dei ruoli.
Trova i punti e porta il testo al passo 700 (il fondo resta `bg-brand/10`):

```bash
cd /Users/gomutako/Developer/gym/frontend/src
grep -rn "bg-brand/10" . | grep "text-brand[^-]"
```

Per ciascuno, `text-brand` → `text-brand-700` **solo dentro quell'attributo `class`**: le
occorrenze di `text-brand` su fondo bianco restano al primario (5,11:1), non vanno toccate.

- [ ] **Step 7: Verifica il diff e i contrasti**

```bash
cd /Users/gomutako/Developer/gym
git diff frontend/src | grep -E "^\+.*(red|emerald|sky|brand)-" | head -40
grep -rn "rose-\|indigo" frontend/src | grep -v "^frontend/src/style.css"
```

Atteso: nel diff nessun `text-red-700` finito su un fondo scuro (le rimappature del tema
scuro sono in `style.css` e le sistema il Task 3); nessun `rose-` o `indigo` residuo fuori da
`style.css` e da `LoginView.vue` (che tocca il Task 3).

Contrasti già verificati, da non ricalcolare se le tinte non cambiano: admin 5,41 · trainer
5,17 · member 6,87 · attivo 4,84 · programmato 4,51 · scaduto 5,30 · banner rosso 5,91 ·
banner verde 5,21.

- [ ] **Step 8: Commit**

```bash
git add frontend/src
git commit -m "refactor(theme): chip di stato e di ruolo riportate a sistema

rose e red dicevano la stessa cosa (38 classi contro 43): resta solo red, che
essendo più freddo e saturo del rosa antico continua a leggersi come segnale.
Le tonalità vanno in forma canonica — chip 100/700, banner 50/700 — cosa che
porta anche il banner d'errore da 4,41 a 5,91. Il ruolo trainer lascia l'indigo
del vecchio brand per il celeste."
```

---

### Task 3: Residui dell'indigo e tema scuro

**Files:**
- Modify: `frontend/src/views/LoginView.vue:80,85,186`
- Modify: `frontend/src/style.css:68-90`

- [ ] **Step 1: Gradienti e alone del login**

In `frontend/src/views/LoginView.vue` tre sostituzioni (`indigo` era il vecchio brand):

- riga 80: `bg-indigo-400/30` → `bg-brand-300/30`
- riga 85: `from-brand to-indigo-500` → `from-brand to-brand-400`
- riga 186: `from-brand to-indigo-500` → `from-brand to-brand-400`

- [ ] **Step 2: Rimappature del tema scuro**

In `frontend/src/style.css`, sostituisci il blocco che va da `/* Brand: ... */` fino alla
riga `html.dark .text-amber-700 { color: #fcd34d; }` con:

```css
/* Brand: il fondo pieno resta (testo bianco leggibile); tinta e bordo passano ai
   passi chiari della scala, che sul fondo scuro sono quelli leggibili — il 300 è
   esattamente il rosa scelto, e lì dà il meglio (6,68:1 sulla card) */
html.dark .text-brand { color: #D3919E; }
html.dark .text-brand-700 { color: #D3919E; }
html.dark .border-brand { border-color: #C87D8C; }
html.dark .ring-brand { --tw-ring-color: #C87D8C; }
html.dark .bg-brand\/10,
html.dark .bg-brand-100 { background-color: rgba(211, 145, 158, 0.18); }

/* Ruoli: il celeste del trainer, unica tinta fredda dello schema */
html.dark .bg-sky-100 { background-color: rgba(56, 189, 248, 0.16); }
html.dark .text-sky-700 { color: #7dd3fc; }

/* Stati — su fondo scuro: riempimenti traslucidi + testo schiarito */
html.dark .bg-red-50 { background-color: rgba(239, 68, 68, 0.14); }
html.dark .bg-red-100 { background-color: rgba(239, 68, 68, 0.2); }
html.dark .border-red-200 { border-color: rgba(239, 68, 68, 0.3); }
html.dark .text-red-500,
html.dark .text-red-600,
html.dark .text-red-700 { color: #f87171; }
html.dark .bg-emerald-50 { background-color: rgba(16, 185, 129, 0.14); }
html.dark .bg-emerald-100 { background-color: rgba(16, 185, 129, 0.2); }
html.dark .text-emerald-600,
html.dark .text-emerald-700 { color: #6ee7b7; }
html.dark .bg-amber-50 { background-color: rgba(245, 158, 11, 0.14); }
html.dark .bg-amber-100 { background-color: rgba(245, 158, 11, 0.2); }
html.dark .text-amber-700 { color: #fcd34d; }
```

Aggiorna anche il commento in testa alla sezione TEMA SCURO, che elenca il vocabolario:
`stati emerald/amber/rose/red` diventa `stati emerald/amber/red`.

- [ ] **Step 3: Verifica**

```bash
cd /Users/gomutako/Developer/gym
grep -rn "rose-\|indigo" frontend/src    # atteso: nessun output
rm -f frontend/dist/index.html
(npm run build > /tmp/tw-build2.log 2>&1 &)
until grep -qE "built in|error" /tmp/tw-build2.log; do sleep 1; done
grep -E "built in|error" /tmp/tw-build2.log
ps -Ao pid,command | awk '/vite build/ && !/awk/ && !/zsh -c/ {print $1}' | while read p; do kill $p; done
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/views/LoginView.vue frontend/src/style.css
git commit -m "feat(theme): tema scuro e login sulla scala rosa antico

Via gli ultimi indigo (gradiente e alone del login, rimasti dal vecchio brand).
Nel tema scuro il testo brand passa al 300, cioè al rosa scelto: sul fondo delle
card dà 6,68:1, mentre il primario 600 lì sarebbe illeggibile."
```

---

### Task 4: Tinta della tab bar nativa

**Files:**
- Modify: `frontend/ios/App/App/NativeTabBarPlugin.swift`
- Modify: `frontend/src/lib/native-tabbar.js`
- Modify: `frontend/src/layouts/AppLayout.vue`

**Interfaces:**
- Consumes: `tabBarTint` da `@/lib/palette` (Task 1).
- Produces: `configure(tabs, selected, { tint, dark })` nel wrapper JS; il plugin accetta
  `tint` (hex `#RRGGBB`) e `dark` (bool).

- [ ] **Step 1: Il plugin legge tinta e tema**

In `frontend/ios/App/App/NativeTabBarPlugin.swift`, dentro `configure`, dopo
`let selected = call.getString("selected")`:

```swift
        let tint = call.getString("tint")
        let dark = call.getBool("dark") ?? false
```

e dentro il blocco `DispatchQueue.main.async`, subito prima di `bar.isHidden = false`:

```swift
            // Il tema dell'app è una scelta dell'utente (light | dark | auto), non
            // necessariamente quella di sistema: senza override, chi forza il chiaro
            // con iOS in scuro vedrebbe una barra scura sotto un'app chiara.
            bar.overrideUserInterfaceStyle = dark ? .dark : .light
            if let tint, let color = UIColor(hex: tint) {
                bar.tintColor = color
            }
```

In fondo al file, dopo la classe, aggiungi:

```swift
/// Parsing di `#RRGGBB`: la palette vive nel JS (`lib/palette.js`), che è anche
/// la sorgente di Tailwind — riscrivere gli hex qui significherebbe averne due
/// copie, e quella dimenticata sarebbe questa.
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
```

- [ ] **Step 2: Il wrapper inoltra i due valori**

In `frontend/src/lib/native-tabbar.js`, cambia la firma di `configure`:

```js
/**
 * Crea o aggiorna le voci della barra e la mostra.
 * @param {{name: string, title: string, symbol: string}[]} tabs
 * @param {string} [selected] nome della rotta da evidenziare
 * @param {{tint?: string, dark?: boolean}} [theme] tinta della tab attiva e tema
 */
export async function configure(tabs, selected, theme = {}) {
  if (!isSupported()) return;
  watchHeight();
  publishHeight(await NativeTabBar.configure({
    tabs,
    selected,
    tint: theme.tint,
    dark: !!theme.dark,
  }));
}
```

- [ ] **Step 3: Il layout passa la tinta del tema corrente**

In `frontend/src/layouts/AppLayout.vue`, aggiungi gli import:

```js
import { useThemeStore } from '@/stores/theme';
import { tabBarTint } from '@/lib/palette';
```

lo store accanto agli altri:

```js
const theme = useThemeStore();
```

e cambia `pushTabs` e i watcher:

```js
async function pushTabs() {
  if (!native) return;
  const tabs = tabsForRole(auth.role).map((t) => ({
    name: t.name,
    title: t.label,
    symbol: t.symbol,
  }));
  await tabbar.configure(tabs, currentTab.value, {
    tint: theme.isDark ? tabBarTint.dark : tabBarTint.light,
    dark: theme.isDark,
  });
}

// Il ruolo si conosce solo dopo il caricamento del profilo, e il tema può cambiare
// in qualsiasi momento: in entrambi i casi le tab vanno rimandate, altrimenti
// restano quelle del ruolo sbagliato o tinte per il tema sbagliato.
watch(() => [auth.role, theme.isDark], pushTabs);
```

(la vecchia riga `watch(() => auth.role, pushTabs);` va rimossa: la sostituisce questa.)

Prima di scrivere, verifica il nome esatto dell'export dello store e della proprietà:

```bash
grep -n "export const\|isDark" frontend/src/stores/theme.js
```

- [ ] **Step 4: Compila per il device**

```bash
cd /Users/gomutako/Developer/gym
rm -f frontend/dist/index.html
(npm run build > /tmp/tw-build3.log 2>&1 &)
until grep -qE "built in|error" /tmp/tw-build3.log; do sleep 1; done
grep -E "built in|error" /tmp/tw-build3.log
ps -Ao pid,command | awk '/vite build/ && !/awk/ && !/zsh -c/ {print $1}' | while read p; do kill $p; done

rm -f frontend/ios/App/App/public/index.html
(cd frontend && npx cap sync ios > /tmp/cap3.log 2>&1 &)
until [ -f frontend/ios/App/App/public/index.html ]; do sleep 1; done

xcodebuild -workspace frontend/ios/App/App.xcworkspace -scheme App \
  -configuration Debug -destination "id=0669878A-8208-5DFE-97B3-F5FADADDA6EC" \
  -derivedDataPath /tmp/gym-dd build > /tmp/xcb3.log 2>&1
grep -E "BUILD SUCCEEDED|BUILD FAILED|error:" /tmp/xcb3.log | sort -u
```

Atteso: `** BUILD SUCCEEDED **`.

- [ ] **Step 5: Commit**

```bash
git add frontend/ios/App/App/NativeTabBarPlugin.swift frontend/src/lib/native-tabbar.js frontend/src/layouts/AppLayout.vue
git commit -m "feat(ios): tab bar nativa tinta col rosa antico

La tinta arriva dal JS insieme al tema, perché la palette vive lì: due hex
copiati in Swift si scordano alla prima ritinteggiatura, e la copia dimenticata
non si vede finché non apri l'app. Passa anche overrideUserInterfaceStyle: il
tema dell'app è una scelta dell'utente, non quella di sistema."
```

---

### Task 5: Verifica e CHANGELOG

- [ ] **Step 1: Installa e lancia**

```bash
UDID=0669878A-8208-5DFE-97B3-F5FADADDA6EC
xcrun devicectl device install app --device $UDID /tmp/gym-dd/Build/Products/Debug-iphoneos/App.app
(xcrun devicectl device process launch --device $UDID --console local.gym.app > /tmp/launch.log 2>&1 &)
sleep 18
grep -iE "ERROR|Launched|NativeTabBar" /tmp/launch.log | head
```

Se il lancio dà `FBSOpenApplicationErrorDomain error 7` il telefono è bloccato: sbloccare e
rilanciare.

- [ ] **Step 2: Controlli sul device**

1. la tab attiva è rosa antico, le altre grigie;
2. bottoni pieni rosa con testo bianco leggibile;
3. le chip: ruolo admin rosa, trainer celeste, abbonamento verde/ambra/rosso — e "Scaduto"
   non si confonde con il rosa del brand;
4. dal profilo, cambia il tema in **scuro**: testo e bordi brand diventano il rosa chiaro, e
   la barra nativa si scurisce con l'app;
5. forza il tema **chiaro** con iOS in scuro: la barra resta chiara (è
   `overrideUserInterfaceStyle` a farlo);
6. nessun residuo indigo da nessuna parte, login compreso.

- [ ] **Step 3: CHANGELOG**

Sotto `## [Non rilasciato]`, in `### Modificato` (creando la sezione se non c'è):

```markdown
- **Nuovo schema cromatico rosa antico**: il primario passa dall'indigo a una scala derivata
  da `#D3919E` che ne conserva la tonalità su dieci passi — la tinta scelta vive su superfici,
  chip e tema scuro, i passi profondi portano testo e bottoni. La stessa tinta è il colore di
  selezione della tab bar nativa iOS. Le chip sono state riportate a sistema: `rose` e `red`
  dicevano la stessa cosa e resta solo `red`, le tonalità seguono una forma canonica (chip
  100/700, banner 50/700) e il ruolo *trainer* lascia l'indigo del vecchio brand per il
  celeste. Effetto collaterale: i banner d'errore, che erano appena sotto la soglia di
  leggibilità, ora la superano.
```

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog dello schema cromatico rosa antico"
```

---

## Punti aperti

1. **Componente `Chip` condiviso**: oggi le classi stanno in tre mappe locali
   (`roleBadgeClass`, `statusClass`, `badgeClass`). Unificarle renderebbe impossibile la
   prossima divergenza, ma è un lavoro indipendente da questo — fuori scope dichiarato nella
   spec.
2. **`brand.dark`**: il token esiste da prima e nessuno lo usa. Lo teniamo allineato al passo
   700 per non rompere nulla, ma il candidato naturale sarebbe rimuoverlo.
