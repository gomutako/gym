<script setup>
// Shell mobile: contenuto scrollabile + navigazione.
// Niente header: la sezione corrente è indicata dalla navigazione e non ci
// sono azioni globali da ospitare in alto.
//
// Su iOS nativo la navigazione è una UITabBar di sistema, disegnata FUORI dalla
// WebView: lì la BottomNav HTML non va montata (sarebbero due barre). Il padding
// inferiore serve comunque, ma vale l'altezza della barra nativa
// (`--native-tabbar-height`, pubblicata da lib/native-tabbar.js) invece
// dell'altezza della barra HTML: la WebView resta a schermo pieno e il contenuto
// scorre dietro il blur della barra. Sul web resta tutto com'era.
import { computed, watch, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useThemeStore } from '@/stores/theme';
import { tabsForRole } from '@/lib/nav-tabs';
import { tabBarTint } from '@/lib/palette';
import * as tabbar from '@/lib/native-tabbar';
import BottomNav from '@/components/BottomNav.vue';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const theme = useThemeStore();

const native = tabbar.isSupported();
let unsubscribe = null;

// Il nome della tab corrispondente alla rotta: le viste di dettaglio (es. la
// sessione di allenamento) non sono tab, e in quel caso il nativo non tocca la
// selezione, così la barra continua a indicare la sezione da cui si è entrati.
const currentTab = computed(() => route.name);

// configure() crea la barra, ne aggiorna le voci e la rende visibile: è anche
// la via di ritorno dopo un logout, che l'aveva nascosta.
async function pushTabs() {
  if (!native) return;
  const tabs = tabsForRole(auth.role).map((t) => ({
    name: t.name,
    title: t.label,
    symbol: t.symbol,
  }));
  await tabbar.configure(tabs, currentTab.value, {
    tint: theme.isDark ? tabBarTint.dark : tabBarTint.light,
  });
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

// Il ruolo si conosce solo dopo il caricamento del profilo, e il tema può cambiare
// in qualsiasi momento: in entrambi i casi le tab vanno rimandate, altrimenti
// restano quelle del ruolo sbagliato o tinte per il tema sbagliato. (Chiaro/scuro
// della barra lo gestisce stores/theme.js: qui serve solo la tinta, che non si
// eredita.)
watch(() => [auth.role, theme.isDark], pushTabs);

// Navigazione dall'interno della pagina (link, redirect delle guardie): la
// selezione della barra va riallineata, altrimenti indica una sezione diversa
// da quella mostrata.
watch(currentTab, (name) => {
  if (native && name) tabbar.setSelected(name);
});
</script>

<template>
  <div class="mx-auto flex min-h-screen max-w-md flex-col bg-gray-50">
    <!-- Contenuto: pt rispetta la safe-area (notch). Sul web il pb deve superare
         l'ALTEZZA REALE della nav, che è ~61px + env(safe-area-inset-bottom): con
         il vecchio pb-24 (96px) su un iPhone con home indicator (34px) restava 1px
         scarso e il contenuto finiva incollato alla tab bar. Su iOS nativo l'altezza
         la dice il nativo (--native-tabbar-height, home indicator già incluso), più
         1rem di respiro. -->
    <main
      class="flex-1 px-4 pt-[calc(env(safe-area-inset-top)+1rem)]"
      :class="
        native
          ? 'pb-[calc(var(--native-tabbar-height,0px)+1rem)]'
          : 'pb-[calc(env(safe-area-inset-bottom)+6rem)]'
      "
    >
      <RouterView />
    </main>

    <BottomNav v-if="!native" />
  </div>
</template>
