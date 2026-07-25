<script setup>
// Dashboard Trainer: le classi a me assegnate, con lista partecipanti espandibile.
import { ref, onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import { useAuthStore } from '@/stores/auth';
import { api } from '@/lib/api';
import IdentityCard from '@/components/IdentityCard.vue';

const auth = useAuthStore();
const { user } = storeToRefs(auth);

const classes = ref([]);
const loading = ref(true);
const expanded = ref(null); // id del corso espanso
const participants = ref({}); // { [classId]: [ {id, profiles:{full_name}} ] }
const loadingParts = ref(null);

function formatDate(iso) {
  return new Date(iso).toLocaleString('it-IT', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

async function toggle(classId) {
  if (expanded.value === classId) {
    expanded.value = null;
    return;
  }
  expanded.value = classId;
  // Carica i partecipanti solo la prima volta
  if (!participants.value[classId]) {
    loadingParts.value = classId;
    try {
      participants.value[classId] = await api.get(`/api/bookings/class/${classId}`);
    } finally {
      loadingParts.value = null;
    }
  }
}

onMounted(async () => {
  try {
    // Tutte le classi, filtrate su quelle di cui sono trainer
    const all = await api.get('/api/classes');
    classes.value = all.filter((c) => c.trainer_id === user.value.id);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="space-y-5">
    <IdentityCard />

    <section>
      <h2 class="mb-2 font-semibold text-gray-900">Le mie classi</h2>

      <p v-if="loading" class="text-sm text-gray-400">Caricamento…</p>
      <p v-else-if="!classes.length" class="rounded-xl bg-white p-4 text-sm text-gray-400 shadow-sm">
        Nessuna classe assegnata.
      </p>

      <ul v-else class="space-y-3">
        <li v-for="c in classes" :key="c.id" class="overflow-hidden rounded-2xl bg-white shadow-sm">
          <button
            class="flex w-full items-center justify-between p-4 text-left"
            @click="toggle(c.id)"
          >
            <div>
              <p class="font-semibold text-gray-900">{{ c.name }}</p>
              <p class="text-sm text-gray-500">{{ formatDate(c.start_time) }}</p>
            </div>
            <span class="text-xs text-gray-400">
              max {{ c.max_capacity }}
              <svg
                class="ml-1 inline h-4 w-4 transition-transform"
                :class="expanded === c.id ? 'rotate-180' : ''"
                fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
              >
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </span>
          </button>

          <!-- Partecipanti -->
          <div v-if="expanded === c.id" class="border-t border-gray-100 px-4 py-3">
            <p v-if="loadingParts === c.id" class="text-sm text-gray-400">Caricamento partecipanti…</p>
            <template v-else>
              <p class="mb-2 text-xs font-semibold uppercase text-gray-400">
                Partecipanti ({{ participants[c.id]?.length || 0 }})
              </p>
              <p v-if="!participants[c.id]?.length" class="text-sm text-gray-400">
                Nessun iscritto.
              </p>
              <ul v-else class="space-y-1">
                <li
                  v-for="p in participants[c.id]"
                  :key="p.id"
                  class="flex items-center gap-2 text-sm text-gray-700"
                >
                  <span class="h-2 w-2 rounded-full bg-emerald-400"></span>
                  {{ p.profiles?.full_name || 'Senza nome' }}
                </li>
              </ul>
            </template>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>
