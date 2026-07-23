<script setup>
// Shell mobile: header in alto, contenuto scrollabile, bottom nav fissa.
import { useRoute } from 'vue-router';
import { computed } from 'vue';
import BottomNav from '@/components/BottomNav.vue';

const route = useRoute();

// Titolo dell'header in base alla rotta corrente
const title = computed(() => {
  const map = {
    dashboard: 'Gym Manager',
    bookings: 'Prenota un corso',
    training: 'Allenamento',
    session: 'Allenamento in corso',
    workouts: 'Schede allenamento',
    exercises: 'Catalogo esercizi',
    users: 'Gestione utenti',
    schedule: 'Palinsesto corsi',
    profile: 'Profilo',
  };
  return map[route.name] || 'Gym Manager';
});
</script>

<template>
  <div class="mx-auto flex min-h-screen max-w-md flex-col bg-gray-50">
    <!-- Header -->
    <header
      class="sticky top-0 z-10 border-b border-gray-200 bg-white px-4 py-3"
    >
      <h1 class="text-lg font-bold text-gray-900">{{ title }}</h1>
    </header>

    <!-- Contenuto (pb-20 lascia spazio alla bottom nav) -->
    <main class="flex-1 px-4 py-4 pb-24">
      <RouterView />
    </main>

    <BottomNav />
  </div>
</template>
