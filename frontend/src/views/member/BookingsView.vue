<script setup>
// Calendario/lista corsi con prenotazione e annullamento.
// Usa il backend Fastify (che applica capacità e anti-doppione).
import { ref, onMounted, computed } from 'vue';
import { api } from '@/lib/api';

const classes = ref([]);
const myBookings = ref([]); // [{ id, classes: {...} }]
const loading = ref(true);
const busyId = ref(null); // id del corso su cui è in corso un'azione
const error = ref('');

// Mappa class_id -> booking_id per sapere cosa ho già prenotato
const bookedMap = computed(() => {
  const m = {};
  for (const b of myBookings.value) {
    if (b.classes?.id) m[b.classes.id] = b.id;
  }
  return m;
});

function formatDate(iso) {
  return new Date(iso).toLocaleString('it-IT', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

async function load() {
  loading.value = true;
  try {
    [classes.value, myBookings.value] = await Promise.all([
      api.get('/api/classes'),
      api.get('/api/bookings'),
    ]);
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function book(classId) {
  error.value = '';
  busyId.value = classId;
  try {
    await api.post('/api/bookings', { class_id: classId });
    await load();
  } catch (e) {
    error.value = e.message; // es. "Corso al completo"
  } finally {
    busyId.value = null;
  }
}

async function cancel(classId) {
  error.value = '';
  busyId.value = classId;
  try {
    await api.del(`/api/bookings/${bookedMap.value[classId]}`);
    await load();
  } catch (e) {
    error.value = e.message;
  } finally {
    busyId.value = null;
  }
}

onMounted(load);
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-lg font-bold text-gray-900">Prenotazioni</h1>
    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
      {{ error }}
    </p>

    <p v-if="loading" class="text-sm text-gray-400">Caricamento corsi…</p>
    <p v-else-if="!classes.length" class="rounded-xl bg-white p-4 text-sm text-gray-400 shadow-sm">
      Nessun corso in programma.
    </p>

    <ul v-else class="space-y-3">
      <li
        v-for="c in classes"
        :key="c.id"
        class="rounded-2xl bg-white p-4 shadow-sm"
      >
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="font-semibold text-gray-900">{{ c.name }}</p>
            <p class="text-sm text-gray-500">{{ formatDate(c.start_time) }}</p>
            <p v-if="c.description" class="mt-1 text-sm text-gray-400">{{ c.description }}</p>
          </div>

          <!-- Azione: annulla se prenotato, altrimenti prenota -->
          <button
            v-if="bookedMap[c.id]"
            :disabled="busyId === c.id"
            class="shrink-0 rounded-full bg-rose-100 px-4 py-2 text-sm font-semibold text-rose-600 active:scale-95 disabled:opacity-60"
            @click="cancel(c.id)"
          >
            Annulla
          </button>
          <button
            v-else
            :disabled="busyId === c.id"
            class="shrink-0 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white active:scale-95 disabled:opacity-60"
            @click="book(c.id)"
          >
            Prenota
          </button>
        </div>
      </li>
    </ul>
  </div>
</template>
