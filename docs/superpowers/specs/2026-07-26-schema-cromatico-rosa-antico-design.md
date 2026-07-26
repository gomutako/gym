# Schema cromatico rosa antico — design

**Data:** 2026-07-26
**Stato:** approvato (opzione A per i bottoni, schema chip completo)

## Obiettivo

Sostituire l'indigo `#4f46e5` come colore primario dell'app con il **rosa antico `#D3919E`**
scelto dall'utente, e nello stesso passaggio rimettere in ordine i colori delle **chip**, che
oggi sono cresciute per accumulo. Il nuovo primario deve essere anche il **colore di
selezione della tab bar nativa iOS**.

Il vincolo che guida tutto: `#D3919E` ha **2,53:1** di contrasto sul bianco. Nell'app il
primario non è decorativo — è il colore di 48 scritte (`text-brand`), 53 bordi
(`border-brand`) e 27 bottoni pieni con testo bianco sopra. Sotto 4,5:1 quel testo non è
leggibile per tutti, quindi la tinta scelta non può fare da sola tutto il lavoro.

## La scala

Dal colore scelto ho derivato dieci passi **conservando esattamente la tonalità** (stessa
tinta e stessa direzione di croma in OKLCh, varia la luminosità): l'app resta *quel* rosa, e
i passi profondi fanno ciò che una tinta chiara non può fare.

| Passo | Hex | Contrasto su bianco | Dove va |
|---|---|---|---|
| 50 | `#FFF2F4` | 1,09 | sfondi tenui, righe evidenziate |
| 100 | `#FFE3E8` | 1,21 | fondo delle chip, superfici selezionate |
| 200 | `#F7C9D1` | 1,48 | bordi tenui |
| 300 | `#D3919E` | 2,53 | **la tinta scelta**: superfici, gradienti, e il rosa del tema scuro |
| 400 | `#C87D8C` | 3,10 | accompagnamento nei gradienti, bordi nel tema scuro |
| 500 | `#B7687A` | 3,98 | grafica e icone su bianco |
| 600 | `#A45668` | 5,11 | **primario**: testo, bordi, bottoni pieni, tab attiva |
| 700 | `#8E4858` | 6,53 | testo su chip rosa (5,41 su `100`), stato premuto |
| 800 | `#743947` | 8,68 | testo su superfici rosa più cariche |
| 900 | `#5C2D38` | 11,13 | usi rari |

**Opzione A, approvata:** i bottoni pieni restano `brand-600` con testo bianco (5,11:1). Il
colore scelto vive su superfici, chip, gradienti e — soprattutto — nel tema scuro, dove è
`#D3919E` a portare il testo (6,68:1 su `#1a1d23`).

## Sorgente unica della palette

La scala vive in un modulo JS che **sia Tailwind sia il codice applicativo importano**:

- `frontend/src/lib/palette.js` — esporta la scala `brand` e i colori della tab bar nativa.
- `frontend/tailwind.config.js` — importa quel modulo (il progetto è `"type": "module"`,
  quindi la config può fare `import`), espone `brand` come scala con
  `DEFAULT = brand[600]` così i 144 usi esistenti di `brand` continuano a funzionare senza
  toccare le viste.
- `frontend/src/layouts/AppLayout.vue` — passa la tinta al plugin iOS.

Motivo: il nativo non può leggere la config di Tailwind, e duplicare due hex in Swift
significa che alla prima ritinteggiatura la barra resta del colore vecchio.

## Semantica dei colori

Una frase: **il rosa è l'interazione, caldo e freddo sono gli stati, il grigio è l'assenza, e
i ruoli stanno su un asse tutto loro.**

| Ruolo semantico | Tinta | Chip (fondo / testo) | Contrasto |
|---|---|---|---|
| Interazione, selezione, azione | rosa antico | `brand-100` / `brand-700` | 5,41 |
| Ruolo admin | rosa antico | `brand-100` / `brand-700` | 5,41 |
| Ruolo trainer | celeste | `sky-100` / `sky-700` | 5,17 |
| Ruolo member | grigio | `gray-100` / `gray-600` | 6,87 |
| Esito positivo, abbonamento attivo | smeraldo | `emerald-100` / `emerald-700` | 4,84 |
| In attesa, programmato | ambra | `amber-100` / `amber-700` | 4,51 |
| Errore, scaduto, distruttivo | rosso | `red-100` / `red-700` | 5,30 |
| Assenza, metadati | grigio | `gray-100` / `gray-500` o `600` | 6,87 |

Tre incoerenze che questo schema chiude:

1. **`rose` e `red` dicevano la stessa cosa** (38 classi `rose-*` contro 43 `red-*`). Resta
   solo `red`: è più freddo e saturo del rosa antico, quindi "errore" continua a leggersi
   come un segnale e non come il colore dell'app. Con un primario rosa, tenere `rose`
   significherebbe far somigliare "Scaduto" a "selezionato".
2. **Le tonalità erano incostanti**: la stessa idea era `bg-rose-100 text-rose-700` in
   `ClientCard` e `bg-rose-50 text-rose-600` in `ProfileView`. Forma canonica: **chip =
   `-100` / `-700`**, **banner = `-50` / `-700`** (il banner occupa più superficie, quindi il
   fondo va più tenue; il testo a `700` porta il banner d'errore da 4,41 a 5,91). La regola
   vale per tutte le famiglie, quindi anche i banner `emerald` passano da `-600` a `-700`
   (5,21:1).
3. **Il ruolo trainer era `indigo`**, cioè il vecchio brand rimasto orfano dopo il cambio.

## Tema scuro

Le rimappature stanno già tutte in `frontend/src/style.css` sotto `html.dark` (l'app non usa
varianti `dark:` sparse). Cambiano:

- `text-brand` → `brand-300` `#D3919E` — la tinta scelta, 6,68:1 sul fondo card.
- `border-brand` / `ring-brand` → `brand-400` `#C87D8C` (5,44:1).
- `bg-brand/10` → `rgba(211, 145, 158, 0.18)`.
- Le righe `rose-*` spariscono insieme alle classi che rimappavano; restano quelle `red-*`.

## Tab bar nativa iOS

Il plugin riceve la tinta dal JS, non la decide:

- `configure({ tabs, selected, tint, dark })` — `tint` è l'hex della tab attiva, `dark` dice
  se l'app è in tema scuro.
- Swift: `bar.tintColor = UIColor(hex:)` e `bar.overrideUserInterfaceStyle = dark ? .dark : .light`.

`overrideUserInterfaceStyle` serve perché il tema dell'app è una **scelta dell'utente**
(`stores/theme.js`: `light` | `dark` | `auto`), non necessariamente quella di sistema: senza
override, chi forza il tema chiaro con iOS in scuro si ritrova una barra scura sotto
un'interfaccia chiara. La tinta va rimandata quando il tema cambia, con un watcher su
`theme.isDark` accanto a quello che già rimanda le tab al cambio di ruolo.

Contrasto della tab attiva: 4,89:1 su barra chiara (`brand-600`), 6,68:1 su barra scura
(`brand-300`).

## Mappa delle modifiche

| File | Modifica |
|---|---|
| `frontend/src/lib/palette.js` | **nuovo**: scala `brand` + tinte della tab bar |
| `frontend/tailwind.config.js` | importa la scala, `DEFAULT = brand-600`, `dark = brand-700` |
| `frontend/src/style.css` | rimappature `html.dark` del brand; via le righe `rose-*` |
| `frontend/src/views/LoginView.vue` | `to-indigo-500` → `to-brand-400` (2 punti), `bg-indigo-400/30` → `bg-brand-300/30` |
| `frontend/src/views/admin/UsersView.vue` | chip ruolo: admin `brand-100/700`, trainer `sky-100/700`, member invariato |
| `frontend/src/components/ClientCard.vue` | `scaduto`: `rose` → `red` |
| `frontend/src/views/ProfileView.vue` | `expired`: `rose-50/600` → `red-100/700` |
| `frontend/src/components/ServiceStatusBadge.vue` | pallino `down`: `rose-500` → `red-500` |
| 15 file con `rose-*` | sostituzione meccanica `rose-N` → `red-N`, stesso numero |
| 21 banner `text-red-600` su `bg-red-50` | → `text-red-700` (4,41 → 5,91) |
| `frontend/src/layouts/AppLayout.vue` | passa `tint` e `dark` a `configure`, watcher su `theme.isDark` |
| `frontend/src/lib/native-tabbar.js` | inoltra `tint` e `dark` |
| `frontend/ios/App/App/NativeTabBarPlugin.swift` | legge `tint`/`dark`, imposta `tintColor` e `overrideUserInterfaceStyle` |

## Criteri di accettazione

1. `grep -r "rose-" frontend/src` non restituisce nulla; `grep -r "indigo" frontend/src` nemmeno.
2. Ogni coppia fondo/testo delle chip elencate sopra è ≥ 4,5:1 (numeri già verificati in
   questo documento; da riverificare se una tinta cambia).
3. La build di produzione passa e l'app iOS compila.
4. Sul device: tab attiva rosa, e coerenza fra tema dell'app e aspetto della barra anche
   forzando `light` con iOS in `dark`.
5. Nel browser, i tre ruoli mostrano le chip nuove e nessun residuo indigo o rose.
6. Tema scuro: testo e bordi brand leggibili, chip di stato ancora distinguibili fra loro.

## Fuori scope

- Ridisegnare le chip come componente condiviso: oggi le classi sono ripetute in mappe
  locali (`roleBadgeClass`, `statusClass`, `badgeClass`). Unificarle in un componente `Chip`
  è un lavoro sensato ma indipendente da questo, e allargherebbe il diff su viste che qui
  non c'entrano.
- Toccare le tinte non-brand fuori dalle chip (grafici, immagini, `ActivityStats`).
- Il tema scuro delle viste che non usano il vocabolario ristretto di utility: non ce ne
  sono di note, ma non è questo il posto per cercarle.
