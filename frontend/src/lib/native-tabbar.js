// =====================================================
// Accesso alla tab bar nativa iOS. Sul web ogni funzione è un no-op, così le
// viste non devono sapere su cosa stanno girando: è lo stesso schema di
// lib/healthkit.js.
// =====================================================
import { Capacitor, registerPlugin } from '@capacitor/core';

// registerPlugin è sicuro anche su web: ritorna un proxy che non useremo lì.
const NativeTabBar = registerPlugin('NativeTabBar');

/** Vero solo nell'app iOS: nel browser e nella PWA resta la BottomNav HTML. */
export function isSupported() {
  return Capacitor.getPlatform() === 'ios' && Capacitor.isNativePlatform();
}

/**
 * Crea o aggiorna le voci della barra e la mostra.
 * @param {{name: string, title: string, symbol: string}[]} tabs
 * @param {string} [selected] nome della rotta da evidenziare
 */
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
  // addListener ritorna una Promise<PluginListenerHandle> in Capacitor 6.
  const handle = NativeTabBar.addListener('tabSelected', (e) => cb(e.name));
  return () => {
    handle.then((h) => h.remove()).catch(() => {});
  };
}
