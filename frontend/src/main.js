// =====================================================
// Entry point dell'app Vue.
// Risolve la configurazione d'ambiente, crea il client Supabase,
// ripristina la sessione, poi monta.
// =====================================================
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
import { useAuthStore } from './stores/auth';
import { useThemeStore } from './stores/theme';
import { initRuntimeConfig } from './lib/runtime-config';
import { initSupabase } from './lib/supabase';
import { initDeepLinks } from './lib/deep-links';
import './style.css';

const app = createApp(App);
app.use(createPinia());

// Tema: applica la classe .dark (reagisce ai cambi di sistema in 'auto') e, nell'app
// iOS, allinea il lato nativo — vedi stores/theme.js
useThemeStore().init();

// Nel simulatore iOS la config punta a Supabase/backend locali, su device e web
// a quelli di produzione: va risolta prima di creare il client.
// Poi si ripristina la sessione PRIMA di montare, così le guardie del router
// conoscono già lo stato di login al primo caricamento.
async function bootstrap() {
  await initRuntimeConfig();
  initSupabase();
  // Una sessione non ripristinabile (es. rete assente) non deve impedire il
  // mount: l'utente vede la schermata di login.
  await useAuthStore()
    .init()
    .catch((err) => console.error('[avvio] ripristino sessione fallito:', err));
}

// Il secondo argomento di then() intercetta solo i fallimenti del bootstrap:
// un errore nel mount resta un errore di mount, non di configurazione.
bootstrap().then(
  () => {
    app.use(router);
    app.mount('#app');
    // Dopo il mount: gli universal link (recupero password) devono poter
    // navigare, e il router deve essere già installato. Un fallimento qui non
    // deve buttare giù l'app — al massimo si perde il link.
    initDeepLinks(router).catch((err) =>
      console.error('[avvio] universal link non agganciati:', err)
    );
  },
  (err) => {
    // Configurazione assente o incompleta: l'app non può funzionare. Su device
    // non c'è una console a portata di mano, quindi il messaggio va a schermo.
    console.error('[avvio] configurazione non valida:', err);
    const root = document.querySelector('#app');
    if (root) root.textContent = `Configurazione non valida: ${err.message}`;
  }
);
