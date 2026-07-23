<script setup>
// Member: avvia un allenamento (scheda + giornata) e calendario dello storico.
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import { useAuthStore } from '@/stores/auth';
import { api } from '@/lib/api';

const router = useRouter();
const { user } = storeToRefs(useAuthStore());

const schede = ref([]);
const sessions = ref([]);
const loading = ref(true);
const error = ref('');

// --- Avvio allenamento ---
const selectedSchedaId = ref('');
const selectedDayIndex = ref('');
const starting = ref(false);

const selectedScheda = computed(() =>
  schede.value.find((s) => s.id === selectedSchedaId.value) || null
);
const days = computed(() => selectedScheda.value?.days_json || []);

async function start() {
  if (!selectedSchedaId.value || selectedDayIndex.value === '') return;
  starting.value = true;
  error.value = '';
  try {
    const session = await api.post('/api/sessions', {
      workout_id: selectedSchedaId.value,
      day_index: Number(selectedDayIndex.value),
    });
    router.push({ name: 'session', params: { id: session.id } });
  } catch (e) {
    error.value = e.message;
  } finally {
    starting.value = false;
  }
}

// --- Calendario ---
const monthCursor = ref(startOfMonth(new Date()));
const selectedDate = ref(null); // filtro giornaliero della lista

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function dateKey(d) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
function sessionDate(s) {
  return new Date(s.completed_at || s.started_at);
}

// Mappa giorno -> sessioni (per i pallini nel calendario)
const sessionsByDay = computed(() => {
  const m = {};
  for (const s of sessions.value) {
    const k = dateKey(sessionDate(s));
    (m[k] ||= []).push(s);
  }
  return m;
});

// Griglia del mese (settimane che iniziano di lunedì)
const weeks = computed(() => {
  const first = monthCursor.value;
  const month = first.getMonth();
  const start = new Date(first);
  const offset = (first.getDay() + 6) % 7; // lun=0
  start.setDate(first.getDate() - offset);

  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    cells.push({
      date: d,
      inMonth: d.getMonth() === month,
      key: dateKey(d),
      count: (sessionsByDay.value[dateKey(d)] || []).length,
    });
  }
  const rows = [];
  for (let i = 0; i < 6; i++) rows.push(cells.slice(i * 7, i * 7 + 7));
  return rows;
});

const monthLabel = computed(() =>
  monthCursor.value.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })
);

function shiftMonth(delta) {
  monthCursor.value = new Date(
    monthCursor.value.getFullYear(),
    monthCursor.value.getMonth() + delta,
    1
  );
  selectedDate.value = null;
}

function pickDay(cell) {
  selectedDate.value = cell.count ? cell.key : null;
}

// Lista sessioni mostrata: filtrata per giorno selezionato, altrimenti tutte
const visibleSessions = computed(() => {
  if (selectedDate.value) return sessionsByDay.value[selectedDate.value] || [];
  return sessions.value;
});

function formatDay(s) {
  return sessionDate(s).toLocaleDateString('it-IT', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
}

async function load() {
  loading.value = true;
  try {
    [schede.value, sessions.value] = await Promise.all([
      api.get(`/api/workouts/member/${user.value.id}`),
      api.get('/api/sessions'),
    ]);
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="space-y-6">
    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{{ error }}</p>

    <!-- Inizia allenamento -->
    <section class="rounded-2xl bg-white p-4 shadow-sm">
      <h2 class="mb-3 font-semibold text-gray-900">Inizia un allenamento</h2>
      <div class="space-y-3">
        <select
          v-model="selectedSchedaId"
          class="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-brand focus:outline-none"
          @change="selectedDayIndex = ''"
        >
          <option value="">— scegli scheda —</option>
          <option v-for="s in schede" :key="s.id" :value="s.id">{{ s.title || 'Senza titolo' }}</option>
        </select>

        <select
          v-if="selectedScheda"
          v-model="selectedDayIndex"
          class="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-brand focus:outline-none"
        >
          <option value="">— scegli giornata —</option>
          <option v-for="(d, i) in days" :key="i" :value="i">
            {{ d.name || 'Giornata ' + (i + 1) }} ({{ (d.exercises || []).length }} esercizi)
          </option>
        </select>

        <button
          :disabled="!selectedSchedaId || selectedDayIndex === '' || starting"
          class="w-full rounded-xl bg-brand py-3 font-semibold text-white active:scale-95 disabled:opacity-50"
          @click="start"
        >
          {{ starting ? 'Avvio…' : '▶ Inizia' }}
        </button>
      </div>
      <p v-if="!loading && !schede.length" class="mt-2 text-sm text-gray-400">
        Nessuna scheda assegnata dal tuo trainer.
      </p>
    </section>

    <!-- Calendario -->
    <section>
      <div class="mb-2 flex items-center justify-between">
        <h2 class="font-semibold text-gray-900">Calendario</h2>
        <div class="flex items-center gap-3 text-sm">
          <button class="text-gray-400" @click="shiftMonth(-1)">‹</button>
          <span class="capitalize text-gray-600">{{ monthLabel }}</span>
          <button class="text-gray-400" @click="shiftMonth(1)">›</button>
        </div>
      </div>

      <div class="rounded-2xl bg-white p-3 shadow-sm">
        <div class="grid grid-cols-7 text-center text-xs text-gray-400">
          <span v-for="d in ['L','M','M','G','V','S','D']" :key="d" class="py-1">{{ d }}</span>
        </div>
        <div v-for="(row, ri) in weeks" :key="ri" class="grid grid-cols-7">
          <button
            v-for="cell in row"
            :key="cell.key"
            class="flex flex-col items-center py-1.5"
            :class="cell.inMonth ? 'text-gray-800' : 'text-gray-300'"
            @click="pickDay(cell)"
          >
            <span
              class="flex h-7 w-7 items-center justify-center rounded-full text-sm"
              :class="selectedDate === cell.key ? 'bg-brand text-white' : ''"
            >
              {{ cell.date.getDate() }}
            </span>
            <span
              class="mt-0.5 h-1.5 w-1.5 rounded-full"
              :class="cell.count ? 'bg-emerald-500' : 'bg-transparent'"
            ></span>
          </button>
        </div>
      </div>
    </section>

    <!-- Storico sessioni -->
    <section>
      <div class="mb-2 flex items-center justify-between">
        <h2 class="font-semibold text-gray-900">Allenamenti effettuati</h2>
        <button v-if="selectedDate" class="text-xs text-brand" @click="selectedDate = null">
          Mostra tutti
        </button>
      </div>
      <p v-if="loading" class="text-sm text-gray-400">Caricamento…</p>
      <p v-else-if="!visibleSessions.length" class="rounded-xl bg-white p-4 text-sm text-gray-400 shadow-sm">
        Nessun allenamento registrato.
      </p>
      <ul v-else class="space-y-2">
        <li
          v-for="s in visibleSessions"
          :key="s.id"
          class="flex items-center justify-between rounded-xl bg-white p-4 shadow-sm"
        >
          <div>
            <p class="font-medium text-gray-900">{{ s.workout_title || 'Scheda' }} · {{ s.day_name }}</p>
            <p class="text-xs text-gray-400">{{ formatDay(s) }}</p>
          </div>
          <div class="flex items-center gap-2">
            <span
              class="rounded-full px-2 py-0.5 text-xs font-semibold"
              :class="s.completed_at ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'"
            >
              {{ s.completed_at ? 'Completato' : 'In corso' }}
            </span>
            <RouterLink :to="{ name: 'session', params: { id: s.id } }" class="text-sm text-brand">›</RouterLink>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>
