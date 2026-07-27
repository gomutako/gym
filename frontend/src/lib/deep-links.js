// =====================================================
// Universal link → rotta del router.
//
// Nell'app iOS il link `https://pallade.it/reset-password?token_hash=…` che
// arriva per email apre l'app (lo consente l'entitlement associated-domains),
// ma iOS lo consegna al guscio NATIVO: la WebView resta dov'era, all'origine
// `capacitor://localhost`, e nessuno legge quell'URL. Risultato: l'app si apre
// sulla schermata di prima e il token va perso senza alcun errore.
//
// Qui l'URL viene raccolto e tradotto in una navigazione del router. Sul web
// non serve nulla: là il link è già la pagina, e il browser fa da sé.
// =====================================================
import { Capacitor } from '@capacitor/core';

// Solo i link del nostro dominio vengono instradati: un URL estraneo
// consegnato all'app non deve poter pilotare la navigazione.
const HOSTS = ['pallade.it', 'www.pallade.it'];

/**
 * Traduce l'URL assoluto dell'universal link nel percorso interno da aprire.
 * Ritorna null se l'URL non ci riguarda o non è interpretabile.
 */
export function routeFromUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!HOSTS.includes(parsed.hostname)) return null;
  // search e hash inclusi: il token del recupero password viaggia nella query
  // (`token_hash`), mentre il flusso legacy di Supabase lo mette nel fragment.
  return parsed.pathname + parsed.search + parsed.hash;
}

/**
 * Aggancia il router agli universal link. Va chiamata DOPO `app.use(router)`.
 *
 * Due sorgenti, entrambe necessarie: `getLaunchUrl()` copre l'avvio a freddo —
 * app chiusa, il link la lancia e l'evento è già passato prima che potessimo
 * ascoltarlo — mentre `appUrlOpen` copre l'app già in esecuzione o in background.
 */
export async function initDeepLinks(router) {
  if (!Capacitor.isNativePlatform()) return;

  // Importato dinamicamente: sul web il plugin non serve e non finisce nel
  // chunk iniziale.
  const { App } = await import('@capacitor/app');

  const go = (url) => {
    const path = routeFromUrl(url);
    if (path) router.replace(path);
  };

  App.addListener('appUrlOpen', (event) => go(event.url));

  const launch = await App.getLaunchUrl();
  if (launch?.url) go(launch.url);
}
