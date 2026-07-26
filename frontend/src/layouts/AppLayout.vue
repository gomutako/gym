<script setup>
// Shell mobile: contenuto scrollabile + bottom nav fissa.
// Niente header: la sezione corrente è indicata dalla bottom nav e non ci
// sono azioni globali da ospitare in alto.
import BottomNav from '@/components/BottomNav.vue';
</script>

<template>
  <div class="mx-auto flex min-h-screen max-w-md flex-col bg-gray-50">
    <!-- Contenuto: pt rispetta la safe-area (notch). Il pb deve superare l'ALTEZZA
         REALE della nav, che è ~61px + env(safe-area-inset-bottom): con il vecchio
         pb-24 (96px) su un iPhone con home indicator (34px) restava 1px scarso e il
         contenuto finiva incollato alla tab bar. Qui la safe-area entra nel calcolo
         invece di essere assorbita, e i 6rem restanti lasciano un margine visibile. -->
    <main class="flex-1 px-4 pt-[calc(env(safe-area-inset-top)+1rem)] pb-[calc(env(safe-area-inset-bottom)+6rem)]">
      <RouterView />
    </main>

    <BottomNav />
  </div>
</template>
