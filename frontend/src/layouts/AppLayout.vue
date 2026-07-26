<script setup>
// Shell mobile: contenuto scrollabile + navigazione.
// Niente header: la sezione corrente è indicata dalla navigazione e non ci
// sono azioni globali da ospitare in alto.
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
    <!-- Contenuto: pt rispetta la safe-area (notch). Sul web il pb deve superare
         l'ALTEZZA REALE della nav, che è ~61px + env(safe-area-inset-bottom): con
         il vecchio pb-24 (96px) su un iPhone con home indicator (34px) restava 1px
         scarso e il contenuto finiva incollato alla tab bar. Su iOS nativo non
         serve nulla di tutto questo: la WebView finisce dove inizia la barra. -->
    <main
      class="flex-1 px-4 pt-[calc(env(safe-area-inset-top)+1rem)]"
      :class="native ? 'pb-4' : 'pb-[calc(env(safe-area-inset-bottom)+6rem)]'"
    >
      <RouterView />
    </main>

    <BottomNav v-if="!native" />
  </div>
</template>
