// =====================================================
// Accesso alla tab bar nativa iOS. Sul web ogni funzione è un no-op, così le
// viste non devono sapere su cosa stanno girando: è lo stesso schema di
// lib/healthkit.js.
//
// La barra è traslucida e sta SOPRA la WebView, che resta a schermo pieno: il
// contenuto le scorre dietro, come nelle app di sistema. Lo spazio per non
// finire coperti lo riserva il CSS, e l'altezza della barra la conosce solo il
// nativo (varia con l'orientamento e col device): la pubblichiamo come custom
// property `--native-tabbar-height`, che sul web resta semplicemente 0px.
// =====================================================
import { Capacitor, registerPlugin } from '@capacitor/core';

// registerPlugin è sicuro anche su web: ritorna un proxy che non useremo lì.
const NativeTabBar = registerPlugin('NativeTabBar');

const HEIGHT_VAR = '--native-tabbar-height';

/** Vero solo nell'app iOS: nel browser e nella PWA resta la BottomNav HTML. */
export function isSupported() {
  return Capacitor.getPlatform() === 'ios' && Capacitor.isNativePlatform();
}

function publishHeight(result) {
  const height = Number(result?.height) || 0;
  document.documentElement.style.setProperty(HEIGHT_VAR, `${height}px`);
}

// La barra cambia altezza da sola (rotazione, split view): senza questo
// ascoltatore la custom property resterebbe al valore del primo calcolo.
let heightListener = null;
function watchHeight() {
  if (!isSupported() || heightListener) return;
  heightListener = NativeTabBar.addListener('heightChanged', publishHeight);
}

/**
 * Crea o aggiorna le voci della barra e la mostra.
 * @param {{name: string, title: string, symbol: string}[]} tabs
 * @param {string} [selected] nome della rotta da evidenziare
 */
export async function configure(tabs, selected) {
  if (!isSupported()) return;
  watchHeight();
  publishHeight(await NativeTabBar.configure({ tabs, selected }));
}

export async function setSelected(name) {
  if (!isSupported()) return;
  await NativeTabBar.setSelected({ name });
}

export async function show() {
  if (!isSupported()) return;
  publishHeight(await NativeTabBar.show());
}

export async function hide() {
  if (!isSupported()) return;
  publishHeight(await NativeTabBar.hide());
}

/** Restituisce la funzione per disiscriversi (null sul web). */
export function onTabSelected(cb) {
  if (!isSupported()) return null;
  // addListener ritorna una Promise<PluginListenerHandle> in Capacitor 6.
  const handle = NativeTabBar.addListener('tabSelected', (e) => cb(e.name));
  return () => {
    handle.then((h) => h.remove()).catch(() => {});
  };
}
