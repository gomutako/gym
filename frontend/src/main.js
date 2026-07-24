// =====================================================
// Entry point dell'app Vue.
// Inizializza Pinia, ripristina la sessione Supabase, poi monta.
// =====================================================
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
import { useAuthStore } from './stores/auth';
import { useThemeStore } from './stores/theme';
import './style.css';

const app = createApp(App);
app.use(createPinia());

// Tema: applica la classe .dark (reagisce ai cambi di sistema in 'auto')
useThemeStore().init();

// Ripristina la sessione PRIMA di montare, così le guardie del router
// conoscono già lo stato di login al primo caricamento.
const auth = useAuthStore();
auth.init().finally(() => {
  app.use(router);
  app.mount('#app');
});
