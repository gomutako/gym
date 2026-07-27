<script setup>
// Member: avvia un allenamento (scheda + giornata) e calendario dello storico.
import { ref, computed, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import { useAuthStore } from '@/stores/auth';
import { listWorkoutsForMember, setWorkoutActive } from '@/lib/data/workouts';
import { listOwnSessions, startSession } from '@/lib/data/sessions';
import Combobox from '@/components/Combobox.vue';

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

// value = indice della giornata nella scheda (numero, come lo vuole /api/sessions)
const dayOptions = computed(() =>
  days.value.map((d, i) => ({
    value: i,
    label: `${d.name || 'Giornata ' + (i + 1)} · ${(d.exercises || []).length} esercizi`,
  }))
);

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Attiva/disattiva la scheda "in uso" (una sola per il member)
const togglingActive = ref(false);
async function toggleActive() {
  const s = selectedScheda.value;
  if (!s) return;
  togglingActive.value = true;
  error.value = '';
  const next = !s.is_active;
  try {
    await setWorkoutActive(s.id, next);
    for (const w of schede.value) w.is_active = next && w.id === s.id;
  } catch (e) {
    error.value = e.message;
  } finally {
    togglingActive.value = false;
  }
}

const schedaOptions = computed(() =>
  schede.value.filter((s) => !s.archived).map((s) => {
    const updated = s.updated_at && s.updated_at !== s.created_at;
    return {
      value: s.id,
      // ★ marca la scheda in uso; il numero di giornate distingue titoli simili
      label: `${s.is_active ? '★ ' : ''}${s.title || 'Senza titolo'} · ${(s.days_json || []).length} giornate`,
      sublabel: updated
        ? `Creata ${fmtDate(s.created_at)} · agg. ${fmtDate(s.updated_at)}`
        : `Creata ${fmtDate(s.created_at)}`,
    };
  })
);

async function start() {
  if (!selectedSchedaId.value || selectedDayIndex.value === '') return;
  starting.value = true;
  error.value = '';
  try {
    const session = await startSession(
      selectedSchedaId.value,
      Number(selectedDayIndex.value),
      user.value.id
    );
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

// --- Codifica visiva del calendario ---
// Colore = scheda, lettera = giornata. Il colore è solo rinforzo: la lettera
// (e la legenda) portano l'informazione, così resta leggibile anche a chi non
// distingue le tinte. Palette categorica validata su fondo chiaro (CVD-safe).
const SCHEDA_COLORS = ['#2a78d6', '#eb6834', '#1baf7a'];
const OTHER_COLOR = '#6b7280'; // dalla quarta scheda in poi: grigio, senza identità

// Le sessioni tengono lo snapshot della scheda: se è stata cancellata resta il titolo
function schedaKey(s) {
  return s.workout_id || s.workout_title || '—';
}

// Ordine stabile: prima apparizione cronologica → il colore di una scheda non
// cambia aggiungendo allenamenti nuovi
const schedeInCalendar = computed(() => {
  const seen = new Map();
  const byTime = [...sessions.value].sort(
    (a, b) => new Date(a.started_at) - new Date(b.started_at)
  );
  for (const s of byTime) {
    const k = schedaKey(s);
    if (!seen.has(k)) seen.set(k, s.workout_title || 'Scheda');
  }
  return [...seen].map(([key, title], i) => ({
    key,
    title,
    color: SCHEDA_COLORS[i] || OTHER_COLOR,
  }));
});

const colorByScheda = computed(() =>
  Object.fromEntries(schedeInCalendar.value.map((w) => [w.key, w.color]))
);

// "Giorno A" -> A · "Petto e tricipiti" -> P · senza nome -> numero della giornata
function dayLetter(s) {
  const name = (s.day_name || '').trim();
  const m = name.match(/giorno\s+(\S{1,2})/i);
  if (m) return m[1].toUpperCase();
  if (name) return name[0].toUpperCase();
  return String((s.day_index ?? 0) + 1);
}

// Completato = pastiglia piena (tinta al 18%); in corso = solo contorno
function badgeStyle(s) {
  const color = colorByScheda.value[schedaKey(s)] || OTHER_COLOR;
  return s.completed_at
    ? { backgroundColor: `${color}2e`, boxShadow: `inset 0 0 0 1px ${color}66` }
    : { boxShadow: `inset 0 0 0 1.5px ${color}` };
}

const MAX_BADGES = 3;
function cellBadges(cell) {
  return (sessionsByDay.value[cell.key] || []).slice(0, MAX_BADGES);
}
function cellExtra(cell) {
  return Math.max(0, (sessionsByDay.value[cell.key] || []).length - MAX_BADGES);
}

// Mappa giorno -> sessioni (per i badge nel calendario)
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

// Lista sessioni mostrata: filtrata per giorno selezionato, altrimenti tutte;
// ordinata per la colonna scelta nell'intestazione tabella
const histSortKey = ref('date'); // 'date' | 'workout' | 'status'
const histSortDir = ref('asc');

// Valore di confronto per colonna. A parità, la data fa da tie-breaker stabile.
function histSortValue(s, key) {
  if (key === 'workout') return `${s.workout_title || ''} ${s.day_name || ''}`.toLowerCase();
  if (key === 'status') return s.completed_at ? 1 : 0; // In corso prima di Completato in asc
  return sessionDate(s).getTime();
}

const visibleSessions = computed(() => {
  const list = selectedDate.value
    ? sessionsByDay.value[selectedDate.value] || []
    : sessions.value;
  const dir = histSortDir.value === 'asc' ? 1 : -1;
  const key = histSortKey.value;
  return [...list].sort((a, b) => {
    const va = histSortValue(a, key);
    const vb = histSortValue(b, key);
    let cmp = typeof va === 'string' ? va.localeCompare(vb, 'it') : va - vb;
    if (cmp === 0) cmp = sessionDate(a) - sessionDate(b); // tie-breaker: cronologico
    return cmp * dir;
  });
});

// Paginazione dello storico (la lista può crescere molto)
const HIST_PAGE_SIZE = 8;
const histPage = ref(1);
const histPageCount = computed(() =>
  Math.max(1, Math.ceil(visibleSessions.value.length / HIST_PAGE_SIZE))
);
const pagedSessions = computed(() =>
  visibleSessions.value.slice((histPage.value - 1) * HIST_PAGE_SIZE, histPage.value * HIST_PAGE_SIZE)
);
const histFrom = computed(() =>
  visibleSessions.value.length ? (histPage.value - 1) * HIST_PAGE_SIZE + 1 : 0
);
const histTo = computed(() =>
  Math.min(histPage.value * HIST_PAGE_SIZE, visibleSessions.value.length)
);

function histSort(key) {
  if (histSortKey.value === key) {
    histSortDir.value = histSortDir.value === 'asc' ? 'desc' : 'asc';
  } else {
    histSortKey.value = key;
    histSortDir.value = 'asc';
  }
}
function histSortIcon(key) {
  if (histSortKey.value !== key) return '↕';
  return histSortDir.value === 'asc' ? '↑' : '↓';
}
// Cambio di filtro/ordinamento o eliminazioni: mantieni la pagina valida
watch([selectedDate, histSortKey, histSortDir], () => { histPage.value = 1; });
watch(histPageCount, (n) => { if (histPage.value > n) histPage.value = n; });

function formatDay(s) {
  return sessionDate(s).toLocaleString('it-IT', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}
function formatDayDate(s) {
  return sessionDate(s).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
}
function formatDayTime(s) {
  return sessionDate(s).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

async function load() {
  loading.value = true;
  try {
    [schede.value, sessions.value] = await Promise.all([
      listWorkoutsForMember(user.value.id),
      listOwnSessions(user.value.id),
    ]);
    // Preseleziona la scheda "in uso", se presente
    const active = schede.value.find((s) => s.is_active);
    if (active && !selectedSchedaId.value) selectedSchedaId.value = active.id;
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
    <h1 class="text-lg font-bold text-gray-900">Allenamenti</h1>
    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</p>

    <!-- Inizia allenamento -->
    <section class="rounded-2xl bg-white p-4 shadow-sm">
      <h2 class="mb-3 font-semibold text-gray-900">Inizia un allenamento</h2>
      <div class="space-y-3">
        <Combobox
          v-model="selectedSchedaId"
          :options="schedaOptions"
          :clearable="false"
          placeholder="Cerca scheda…"
          empty-text="Nessuna scheda trovata"
          @change="selectedDayIndex = ''"
        />

        <Combobox
          v-if="selectedScheda"
          v-model="selectedDayIndex"
          :options="dayOptions"
          :clearable="false"
          placeholder="Scegli giornata…"
          empty-text="Nessuna giornata nella scheda"
        />

        <div v-if="selectedScheda" class="flex items-center justify-between gap-2">
          <p class="text-xs text-gray-400">
            Scheda del {{ fmtDate(selectedScheda.created_at) }}
            <template v-if="selectedScheda.updated_at && selectedScheda.updated_at !== selectedScheda.created_at">
              · aggiornata il {{ fmtDate(selectedScheda.updated_at) }}
            </template>
          </p>
          <button
            :disabled="togglingActive"
            class="flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold active:scale-95 disabled:opacity-50"
            :class="selectedScheda.is_active ? 'bg-amber-100 text-amber-700' : 'border border-gray-300 text-gray-500'"
            @click="toggleActive"
          >
            <svg viewBox="0 0 24 24" :fill="selectedScheda.is_active ? 'currentColor' : 'none'"
                 stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4">
              <path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 18.9 6.1 21l1.2-6.5L2.5 9.9l6.6-.9z" />
            </svg>
            {{ selectedScheda.is_active ? 'In uso' : 'Imposta in uso' }}
          </button>
        </div>

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
            <!-- una pastiglia per allenamento: colore = scheda, lettera = giornata -->
            <span class="mt-0.5 flex h-4 items-center justify-center gap-px">
              <span
                v-for="s in cellBadges(cell)"
                :key="s.id"
                :style="badgeStyle(s)"
                :title="`${s.workout_title || 'Scheda'} · ${s.day_name || 'giornata'}${s.completed_at ? '' : ' (in corso)'}`"
                class="flex h-4 min-w-[1rem] items-center justify-center rounded px-0.5 text-[9px] font-bold leading-none text-gray-900"
              >
                {{ dayLetter(s) }}
              </span>
              <span v-if="cellExtra(cell)" class="text-[9px] font-semibold text-gray-400">
                +{{ cellExtra(cell) }}
              </span>
            </span>
          </button>
        </div>

        <!-- Legenda: senza, il colore da solo non direbbe nulla -->
        <div v-if="schedeInCalendar.length" class="mt-2 border-t border-gray-100 pt-2">
          <div class="flex flex-wrap gap-x-3 gap-y-1">
            <span
              v-for="w in schedeInCalendar"
              :key="w.key"
              class="flex items-center gap-1 text-xs text-gray-600"
            >
              <span
                class="h-3 w-3 rounded"
                :style="{ backgroundColor: `${w.color}2e`, boxShadow: `inset 0 0 0 1px ${w.color}66` }"
              ></span>
              {{ w.title }}
            </span>
          </div>
          <p class="mt-1 text-[11px] text-gray-400">
            La lettera è la giornata · pastiglia piena = completato, contorno = in corso
          </p>
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

      <template v-else>
        <div class="overflow-hidden rounded-2xl bg-white shadow-sm">
          <table class="w-full table-fixed text-left text-sm">
            <thead class="border-b border-gray-100 text-xs uppercase text-gray-400">
              <tr>
                <th class="w-28 px-3 py-2">
                  <button class="font-semibold uppercase" @click="histSort('date')">
                    Data <span class="text-gray-300">{{ histSortIcon('date') }}</span>
                  </button>
                </th>
                <th class="px-3 py-2">
                  <button class="font-semibold uppercase" @click="histSort('workout')">
                    Allenamento <span class="text-gray-300">{{ histSortIcon('workout') }}</span>
                  </button>
                </th>
                <th class="w-24 px-2 py-2">
                  <button class="font-semibold uppercase" @click="histSort('status')">
                    Stato <span class="text-gray-300">{{ histSortIcon('status') }}</span>
                  </button>
                </th>
                <th class="w-10 px-2 py-2"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-50">
              <tr v-for="s in pagedSessions" :key="s.id">
                <td class="px-3 py-2 text-xs text-gray-500">
                  <span class="block capitalize">{{ formatDayDate(s) }}</span>
                  <span class="block text-gray-400">{{ formatDayTime(s) }}</span>
                </td>
                <td class="px-3 py-2">
                  <p class="truncate font-medium text-gray-900">{{ s.workout_title || 'Scheda' }}</p>
                  <p class="truncate text-xs text-gray-400">{{ s.day_name }}</p>
                </td>
                <td class="px-2 py-2">
                  <span
                    class="inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold"
                    :class="s.completed_at ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'"
                  >
                    {{ s.completed_at ? 'Completato' : 'In corso' }}
                  </span>
                </td>
                <td class="px-2 py-2 text-right">
                  <RouterLink
                    :to="{ name: 'session', params: { id: s.id } }"
                    class="inline-block rounded-lg p-1.5 text-brand active:scale-90"
                    aria-label="Apri allenamento"
                  >›</RouterLink>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="mt-3 flex items-center justify-between text-xs text-gray-500">
          <span>{{ histFrom }}–{{ histTo }} di {{ visibleSessions.length }}</span>
          <div class="flex items-center gap-2">
            <button
              :disabled="histPage === 1"
              class="rounded-lg border border-gray-300 px-3 py-1 font-semibold disabled:opacity-40"
              @click="histPage--"
            >‹</button>
            <span>{{ histPage }} / {{ histPageCount }}</span>
            <button
              :disabled="histPage === histPageCount"
              class="rounded-lg border border-gray-300 px-3 py-1 font-semibold disabled:opacity-40"
              @click="histPage++"
            >›</button>
          </div>
        </div>
      </template>
    </section>
  </div>
</template>
