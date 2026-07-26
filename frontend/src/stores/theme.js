// =====================================================
// Store del tema: 'light' | 'dark' | 'auto'.
// - persiste la scelta in localStorage ('theme')
// - applica la classe .dark su <html> (Tailwind darkMode: 'class')
// - in 'auto' segue prefers-color-scheme e reagisce ai cambi di sistema
// Un piccolo script inline in index.html applica la classe PRIMA del mount
// per evitare il flash chiaro all'avvio; qui la logica reattiva.
// =====================================================
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { surface } from '@/lib/palette';
import { setAppearance } from '@/lib/native-tabbar';

const STORAGE_KEY = 'theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');

function systemPrefersDark() {
  return media.matches;
}

export const useThemeStore = defineStore('theme', () => {
  const mode = ref(localStorage.getItem(STORAGE_KEY) || 'auto'); // 'light'|'dark'|'auto'

  const isDark = computed(() =>
    mode.value === 'dark' || (mode.value === 'auto' && systemPrefersDark())
  );

  function apply() {
    const root = document.documentElement;
    root.classList.toggle('dark', isDark.value);
    // Fa adattare anche i controlli nativi (select, checkbox, scrollbar…)
    root.style.colorScheme = isDark.value ? 'dark' : 'light';
    // Nell'app iOS il tema riguarda anche ciò che sta FUORI dalla WebView: il
    // fondo predefinito è quello di sistema, quindi con iOS in scuro la zona di
    // rimbalzo dello scroll resterebbe nera anche in tema chiaro. Sta qui perché
    // apply() è l'unico punto da cui passano avvio, scelta manuale e cambio di
    // sistema. Sul web è un no-op.
    setAppearance({
      dark: isDark.value,
      background: isDark.value ? surface.dark : surface.light,
    }).catch((err) => console.error('[tema] aspetto nativo non applicato:', err));
  }

  function setMode(next) {
    mode.value = next;
    localStorage.setItem(STORAGE_KEY, next);
    apply();
  }

  // Cambi del tema di sistema: rilevanti solo in 'auto'
  function onSystemChange() {
    if (mode.value === 'auto') apply();
  }

  function init() {
    apply();
    media.addEventListener('change', onSystemChange);
  }

  return { mode, isDark, init, setMode };
});
