<script setup>
// Bottom navigation bar mobile. Le voci cambiano in base al ruolo.
// Le icone sono inline SVG per evitare dipendenze aggiuntive.
import { computed } from 'vue';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();

// Tab per ruolo: la seconda voce differisce (Corsi per member, Schede per trainer)
const tabs = computed(() => {
  const home = { name: 'dashboard', label: 'Home', icon: 'home' };
  const profile = { name: 'profile', label: 'Profilo', icon: 'user' };
  const templates = { name: 'templates', label: 'Modelli', icon: 'stack' };
  if (auth.role === 'admin') {
    return [
      home,
      { name: 'users', label: 'Utenti', icon: 'group' },
      { name: 'schedule', label: 'Corsi', icon: 'calendar' },
      templates,
      profile,
    ];
  }
  if (auth.role === 'trainer') {
    return [
      home,
      { name: 'clients', label: 'Clienti', icon: 'group' },
      { name: 'exercises', label: 'Esercizi', icon: 'dumbbell' },
      templates,
      profile,
    ];
  }
  return [
    home,
    { name: 'bookings', label: 'Corsi', icon: 'calendar' },
    { name: 'training', label: 'Allena', icon: 'play' },
    profile,
  ];
});
</script>

<template>
  <nav
    class="fixed inset-x-0 bottom-0 z-20 border-t border-gray-200 bg-white pb-safe-bottom"
  >
    <ul class="mx-auto flex max-w-md">
      <li v-for="tab in tabs" :key="tab.name" class="flex-1">
        <RouterLink
          :to="{ name: tab.name }"
          class="flex flex-col items-center gap-1 py-2 text-xs"
          :class="
            $route.name === tab.name ? 'text-brand font-semibold' : 'text-gray-400'
          "
        >
          <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path
              v-if="tab.icon === 'home'"
              stroke-linecap="round" stroke-linejoin="round"
              d="M3 12l9-9 9 9M5 10v10h14V10"
            />
            <path
              v-else-if="tab.icon === 'calendar'"
              stroke-linecap="round" stroke-linejoin="round"
              d="M8 7V3m8 4V3M4 11h16M5 7h14a1 1 0 011 1v11a1 1 0 01-1 1H5a1 1 0 01-1-1V8a1 1 0 011-1z"
            />
            <path
              v-else-if="tab.icon === 'clipboard'"
              stroke-linecap="round" stroke-linejoin="round"
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
            />
            <path
              v-else-if="tab.icon === 'group'"
              stroke-linecap="round" stroke-linejoin="round"
              d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6 0a3 3 0 10-2.5-1.34"
            />
            <path
              v-else-if="tab.icon === 'dumbbell'"
              stroke-linecap="round" stroke-linejoin="round"
              d="M6.5 6.5l11 11M4 7l3-3 3 3-3 3zM14 17l3-3 3 3-3 3zM3 12h2M19 12h2"
            />
            <path
              v-else-if="tab.icon === 'play'"
              stroke-linecap="round" stroke-linejoin="round"
              d="M14.752 11.168l-5.197-3.03A1 1 0 008 9.002v5.996a1 1 0 001.555.832l5.197-3.03a1 1 0 000-1.664zM21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
            <path
              v-else-if="tab.icon === 'stack'"
              stroke-linecap="round" stroke-linejoin="round"
              d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5"
            />
            <path
              v-else
              stroke-linecap="round" stroke-linejoin="round"
              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
            />
          </svg>
          <span>{{ tab.label }}</span>
        </RouterLink>
      </li>
    </ul>
  </nav>
</template>
