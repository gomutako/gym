<script setup>
// Shell mobile: contenuto scrollabile + bottom nav fissa.
// Niente header: la sezione corrente è indicata dalla bottom nav e non ci
// sono azioni globali da ospitare in alto.
import BottomNav from '@/components/BottomNav.vue';
</script>

<template>
  <div class="mx-auto flex min-h-screen max-w-md flex-col bg-gray-50">
    <!-- Contenuto: pt rispetta la safe-area (notch); pb lascia spazio alla bottom nav -->
    <main class="flex-1 px-4 pb-24 pt-[calc(env(safe-area-inset-top)+1rem)]">
      <RouterView />
    </main>

    <BottomNav />
  </div>
</template>
