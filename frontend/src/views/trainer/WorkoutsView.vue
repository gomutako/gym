<script setup>
// Trainer: gestione SCHEDE come entità.
// Flusso: seleziona cliente -> lista delle sue schede -> crea/modifica una
// scheda con TITOLO e GIORNATE; ogni giornata ha i suoi esercizi (dal catalogo)
// con serie/ripetizioni/recupero.
import { ref, onMounted, computed, watch } from 'vue';
import { api } from '@/lib/api';
import { exerciseImageUrl } from '@/lib/storage';
import Combobox from '@/components/Combobox.vue';

const members = ref([]);
const catalog = ref([]);
const selectedMemberId = ref('');
const schede = ref([]); // schede del cliente selezionato

// Editor
const editing = ref(false);
const currentId = ref(null); // null = nuova scheda
const title = ref('');
const notes = ref('');
const days = ref([]); // [{ name, exercises: [{exercise_id, sets, reps, rest_seconds}] }]

const loading = ref(false);
const saving = ref(false);
const message = ref('');
const error = ref('');

const catalogById = computed(() =>
  Object.fromEntries(catalog.value.map((e) => [e.id, e]))
);

// Le date arrivano dal DB: created_at e updated_at (trigger touch_updated_at)
function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' });
}

// Scheda aperta nell'editor, per mostrarne le date (null se è nuova)
const currentScheda = computed(() => schede.value.find((s) => s.id === currentId.value) || null);

// --- Tabella schede: ricerca / ordinamento / paginazione ---
const schedaSearch = ref('');
const schedaSortKey = ref('updated_at'); // 'title' | 'days' | 'created_at' | 'updated_at'
const schedaSortDir = ref('desc');
const schedaPage = ref(1);
const SCHEDA_PAGE_SIZE = 10;

function schedaSortVal(s, key) {
  if (key === 'title') return (s.title || '').toLowerCase();
  if (key === 'days') return (s.days_json || []).length;
  return s[key] || ''; // created_at / updated_at (ISO → confronto lessicografico = cronologico)
}
function toggleSchedaSort(key) {
  if (schedaSortKey.value === key) {
    schedaSortDir.value = schedaSortDir.value === 'asc' ? 'desc' : 'asc';
  } else {
    schedaSortKey.value = key;
    schedaSortDir.value = key === 'title' ? 'asc' : 'desc';
  }
}
function schedaSortIcon(key) {
  if (schedaSortKey.value !== key) return '↕';
  return schedaSortDir.value === 'asc' ? '↑' : '↓';
}

const filteredSchede = computed(() => {
  const q = schedaSearch.value.trim().toLowerCase();
  if (!q) return schede.value;
  return schede.value.filter((s) => (s.title || '').toLowerCase().includes(q));
});
const sortedSchede = computed(() => {
  const dir = schedaSortDir.value === 'asc' ? 1 : -1;
  return [...filteredSchede.value].sort((a, b) => {
    const va = schedaSortVal(a, schedaSortKey.value);
    const vb = schedaSortVal(b, schedaSortKey.value);
    let cmp = va < vb ? -1 : va > vb ? 1 : 0;
    if (cmp === 0) cmp = (a.updated_at || '') < (b.updated_at || '') ? -1 : 1;
    return cmp * dir;
  });
});
const schedaPageCount = computed(() => Math.max(1, Math.ceil(sortedSchede.value.length / SCHEDA_PAGE_SIZE)));
const pagedSchede = computed(() =>
  sortedSchede.value.slice((schedaPage.value - 1) * SCHEDA_PAGE_SIZE, schedaPage.value * SCHEDA_PAGE_SIZE)
);
const schedaFrom = computed(() => (sortedSchede.value.length ? (schedaPage.value - 1) * SCHEDA_PAGE_SIZE + 1 : 0));
const schedaTo = computed(() => Math.min(schedaPage.value * SCHEDA_PAGE_SIZE, sortedSchede.value.length));

watch([schedaSearch, schedaSortKey, schedaSortDir, selectedMemberId], () => { schedaPage.value = 1; });
watch(schedaPageCount, (n) => { if (schedaPage.value > n) schedaPage.value = n; });

const memberOptions = computed(() =>
  members.value.map((m) => ({ value: m.id, label: m.full_name || 'Senza nome' }))
);

const catalogOptions = computed(() =>
  catalog.value.map((c) => ({
    value: c.id,
    // il gruppo muscolare entra nel testo cercabile della combobox
    label: c.muscle_group ? `${c.name} · ${c.muscle_group}` : c.name,
    image: exerciseImageUrl(c.image_path),
  }))
);

async function loadSchede() {
  editing.value = false;
  schede.value = [];
  error.value = '';
  if (!selectedMemberId.value) return;
  loading.value = true;
  try {
    schede.value = await api.get(`/api/workouts/member/${selectedMemberId.value}`);
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

function newScheda() {
  currentId.value = null;
  title.value = '';
  notes.value = '';
  days.value = [{ name: 'Giorno A', exercises: [] }];
  message.value = '';
  editing.value = true;
}

function editScheda(s) {
  currentId.value = s.id;
  title.value = s.title || '';
  notes.value = s.notes || '';
  // Copia profonda per non mutare la lista
  days.value = (s.days_json || []).map((d) => ({
    name: d.name || '',
    exercises: (d.exercises || []).map((e) => newRow(e)),
  }));
  message.value = '';
  editing.value = true;
}

// Riga esercizio dell'editor. `_uid` serve solo come :key stabile: riordinando
// la lista, le combobox devono seguire la riga e non l'indice. Non viene salvato.
let uid = 0;
function newRow(e = {}) {
  return {
    _uid: ++uid,
    exercise_id: e.exercise_id || '',
    sets: e.sets ?? 3,
    reps: e.reps ?? 10,
    rest_seconds: e.rest_seconds ?? 90,
  };
}

// --- Gestione giornate ---
function addDay() {
  const letter = String.fromCharCode(65 + days.value.length); // A, B, C...
  days.value.push({ name: `Giorno ${letter}`, exercises: [] });
}
function removeDay(i) {
  days.value.splice(i, 1);
}

// --- Gestione esercizi in una giornata ---
function addExercise(dayIdx) {
  days.value[dayIdx].exercises.push(newRow());
}
function removeExercise(dayIdx, exIdx) {
  days.value[dayIdx].exercises.splice(exIdx, 1);
}
// Sposta un esercizio su/giù nella giornata (delta -1 / +1)
function moveExercise(dayIdx, exIdx, delta) {
  const list = days.value[dayIdx].exercises;
  const to = exIdx + delta;
  if (to < 0 || to >= list.length) return;
  const [item] = list.splice(exIdx, 1);
  list.splice(to, 0, item);
}

async function save() {
  saving.value = true;
  message.value = '';
  error.value = '';
  try {
    const payload = {
      title: title.value,
      notes: notes.value,
      days_json: normalizeDays(days.value),
    };
    if (currentId.value) {
      await api.patch(`/api/workouts/${currentId.value}`, payload);
    } else {
      const created = await api.post('/api/workouts', {
        member_id: selectedMemberId.value,
        ...payload,
      });
      currentId.value = created.id;
    }
    message.value = 'Scheda salvata ✔';
    await loadScheThenKeepEditing();
  } catch (e) {
    error.value = e.message;
  } finally {
    saving.value = false;
  }
}

// Ricarica la lista schede ma resta nell'editor corrente
async function loadScheThenKeepEditing() {
  schede.value = await api.get(`/api/workouts/member/${selectedMemberId.value}`);
  editing.value = true;
}

// --- Duplica scheda (stesso cliente o un altro) ---
// La copia è una nuova scheda: il duplicato non è legato all'originale.
const dupOpen = ref(false);
const dupTitle = ref('');
const dupTargetId = ref('');
const dupDays = ref([]);   // giornate da copiare (già normalizzate)
const dupNotes = ref('');
const dupSaving = ref(false);

// Giornate ripulite dai campi solo-editor (_uid) e con i numeri come numeri
function normalizeDays(source) {
  return (source || []).map((d) => ({
    name: d.name || '',
    exercises: (d.exercises || []).map((e) => ({
      exercise_id: e.exercise_id,
      sets: Number(e.sets),
      reps: Number(e.reps),
      rest_seconds: Number(e.rest_seconds),
    })),
  }));
}

// Da un elemento della lista schede oppure dallo stato corrente dell'editor
function openDuplicate(s = null) {
  dupTitle.value = `${(s ? s.title : title.value) || 'Senza titolo'} (copia)`;
  dupNotes.value = s ? s.notes || '' : notes.value;
  dupDays.value = normalizeDays(s ? s.days_json : days.value);
  dupTargetId.value = selectedMemberId.value;
  message.value = '';
  error.value = '';
  dupOpen.value = true;
}

async function duplicate() {
  if (!dupTargetId.value) return;
  dupSaving.value = true;
  error.value = '';
  try {
    await api.post('/api/workouts', {
      member_id: dupTargetId.value,
      title: dupTitle.value,
      notes: dupNotes.value,
      days_json: dupDays.value,
    });
    const sameClient = dupTargetId.value === selectedMemberId.value;
    const targetName = memberOptions.value.find((o) => o.value === dupTargetId.value)?.label;
    dupOpen.value = false;
    message.value = sameClient ? 'Scheda duplicata ✔' : `Scheda assegnata a ${targetName} ✔`;
    // La lista mostra il cliente selezionato: si aggiorna solo se è lo stesso
    if (sameClient) schede.value = await api.get(`/api/workouts/member/${selectedMemberId.value}`);
  } catch (e) {
    error.value = e.message;
  } finally {
    dupSaving.value = false;
  }
}

// Attiva/disattiva la scheda "in uso" (esclusiva per cliente)
async function toggleActive(s) {
  error.value = '';
  const next = !s.is_active;
  try {
    await api.patch(`/api/workouts/${s.id}/active`, { is_active: next });
    // Riflette l'esclusività in locale: se attivo questa, spengo le altre
    for (const w of schede.value) w.is_active = next && w.id === s.id;
    if (!next) s.is_active = false;
  } catch (e) {
    error.value = e.message;
  }
}

async function deleteScheda() {
  if (!currentId.value) return;
  if (!confirm('Eliminare questa scheda?')) return;
  try {
    await api.del(`/api/workouts/${currentId.value}`);
    await loadSchede();
  } catch (e) {
    error.value = e.message;
  }
}

onMounted(async () => {
  try {
    [members.value, catalog.value] = await Promise.all([
      api.get('/api/members'),
      api.get('/api/exercises'),
    ]);
  } catch (e) {
    error.value = e.message;
  }
});
</script>

<template>
  <div class="space-y-4">
    <!-- Selezione cliente -->
    <div>
      <label class="mb-1 block text-sm font-medium text-gray-700">Cliente</label>
      <Combobox
        v-model="selectedMemberId"
        :options="memberOptions"
        placeholder="Cerca cliente…"
        empty-text="Nessun cliente trovato"
        @change="loadSchede"
      />
    </div>

    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{{ error }}</p>
    <p v-if="message" class="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-600">{{ message }}</p>
    <p v-if="loading" class="text-sm text-gray-400">Caricamento…</p>

    <!-- Lista schede del cliente + nuova -->
    <template v-if="selectedMemberId && !loading">
      <section v-if="!editing" class="space-y-2">
        <div class="flex items-center justify-between">
          <h2 class="font-semibold text-gray-900">Schede</h2>
          <button
            class="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white active:scale-95"
            @click="newScheda"
          >
            + Nuova scheda
          </button>
        </div>

        <p v-if="!schede.length" class="rounded-xl bg-white p-4 text-sm text-gray-400 shadow-sm">
          Nessuna scheda per questo cliente.
        </p>

        <template v-else>
          <input
            v-model="schedaSearch" type="search" placeholder="Cerca scheda per titolo…"
            class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-brand focus:outline-none"
          />

          <p v-if="!sortedSchede.length" class="rounded-xl bg-white p-4 text-sm text-gray-400 shadow-sm">
            Nessun risultato per “{{ schedaSearch }}”.
          </p>

          <template v-else>
            <div class="overflow-hidden rounded-2xl bg-white shadow-sm">
              <table class="w-full table-fixed text-left text-sm">
                <thead class="border-b border-gray-100 text-xs uppercase text-gray-400">
                  <tr>
                    <th class="px-3 py-2">
                      <button class="font-semibold uppercase" @click="toggleSchedaSort('title')">
                        Titolo <span class="text-gray-300">{{ schedaSortIcon('title') }}</span>
                      </button>
                    </th>
                    <th class="w-14 px-2 py-2 text-center">
                      <button class="font-semibold uppercase" @click="toggleSchedaSort('days')">
                        Gg <span class="text-gray-300">{{ schedaSortIcon('days') }}</span>
                      </button>
                    </th>
                    <th class="w-24 px-2 py-2">
                      <button class="font-semibold uppercase" @click="toggleSchedaSort('updated_at')">
                        Agg. <span class="text-gray-300">{{ schedaSortIcon('updated_at') }}</span>
                      </button>
                    </th>
                    <th class="w-16 px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-50">
                  <tr v-for="s in pagedSchede" :key="s.id">
                    <td class="px-3 py-2">
                      <div class="flex items-start gap-2">
                        <button
                          class="mt-0.5 shrink-0 active:scale-90"
                          :class="s.is_active ? 'text-amber-500' : 'text-gray-300'"
                          :title="s.is_active ? 'Scheda in uso — clicca per disattivare' : 'Imposta come scheda in uso'"
                          :aria-label="s.is_active ? 'Scheda in uso' : 'Imposta come attiva'"
                          @click="toggleActive(s)"
                        >
                          <svg viewBox="0 0 24 24" :fill="s.is_active ? 'currentColor' : 'none'"
                               stroke="currentColor" stroke-width="1.6" stroke-linecap="round"
                               stroke-linejoin="round" class="h-5 w-5">
                            <path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 18.9 6.1 21l1.2-6.5L2.5 9.9l6.6-.9z" />
                          </svg>
                        </button>
                        <div class="min-w-0">
                          <p class="truncate font-medium text-gray-900">{{ s.title || 'Senza titolo' }}</p>
                          <p class="text-xs text-gray-400" :title="`Creata il ${fmtDateTime(s.created_at)}`">
                            Creata {{ fmtDate(s.created_at) }}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td class="px-2 py-2 text-center text-gray-600">{{ (s.days_json || []).length }}</td>
                    <td class="px-2 py-2 text-xs text-gray-500" :title="`Aggiornata il ${fmtDateTime(s.updated_at)}`">
                      {{ fmtDate(s.updated_at) }}
                    </td>
                    <td class="px-2 py-2">
                      <div class="flex justify-end gap-1">
                        <button
                          title="Duplica" aria-label="Duplica"
                          class="rounded-lg p-1.5 text-gray-500 active:scale-90"
                          @click="openDuplicate(s)"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                               stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5">
                            <rect x="9" y="9" width="12" height="12" rx="2" />
                            <path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
                          </svg>
                        </button>
                        <button
                          title="Apri" aria-label="Apri"
                          class="rounded-lg p-1.5 text-brand active:scale-90"
                          @click="editScheda(s)"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                               stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5">
                            <path d="M12 20h9" />
                            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="flex items-center justify-between text-xs text-gray-500">
              <span>{{ schedaFrom }}–{{ schedaTo }} di {{ sortedSchede.length }}</span>
              <div class="flex items-center gap-2">
                <button :disabled="schedaPage === 1" class="rounded-lg border border-gray-300 px-3 py-1 font-semibold disabled:opacity-40" @click="schedaPage--">‹</button>
                <span>{{ schedaPage }} / {{ schedaPageCount }}</span>
                <button :disabled="schedaPage === schedaPageCount" class="rounded-lg border border-gray-300 px-3 py-1 font-semibold disabled:opacity-40" @click="schedaPage++">›</button>
              </div>
            </div>
          </template>
        </template>
      </section>

      <!-- Editor scheda -->
      <section v-else class="space-y-4">
        <button class="text-sm text-brand" @click="editing = false">‹ Torna alle schede</button>

        <input
          v-model="title"
          placeholder="Titolo scheda (es. Ipertrofia - Fase 1)"
          class="w-full rounded-xl border border-gray-300 px-4 py-3 font-medium focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
        />

        <div v-if="currentScheda" class="-mt-2 flex items-center justify-between gap-2">
          <p class="text-xs text-gray-400">
            Creata il {{ fmtDateTime(currentScheda.created_at) }}
            <template v-if="currentScheda.updated_at && currentScheda.updated_at !== currentScheda.created_at">
              · ultima modifica {{ fmtDateTime(currentScheda.updated_at) }}
            </template>
          </p>
          <button
            class="flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold active:scale-95"
            :class="currentScheda.is_active ? 'bg-amber-100 text-amber-700' : 'border border-gray-300 text-gray-500'"
            @click="toggleActive(currentScheda)"
          >
            <svg viewBox="0 0 24 24" :fill="currentScheda.is_active ? 'currentColor' : 'none'"
                 stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4">
              <path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 18.9 6.1 21l1.2-6.5L2.5 9.9l6.6-.9z" />
            </svg>
            {{ currentScheda.is_active ? 'In uso' : 'Imposta in uso' }}
          </button>
        </div>

        <p v-if="!catalog.length" class="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
          Catalogo vuoto: aggiungi esercizi nella sezione <b>Esercizi</b>.
        </p>

        <!-- Giornate -->
        <div v-for="(day, di) in days" :key="di" class="rounded-2xl bg-white p-3 shadow-sm">
          <div class="mb-2 flex items-center gap-2">
            <input
              v-model="day.name"
              placeholder="Nome giornata"
              class="min-w-0 flex-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm font-semibold focus:border-brand focus:outline-none"
            />
            <button
              title="Rimuovi giornata" aria-label="Rimuovi giornata"
              class="shrink-0 rounded-lg bg-rose-50 p-2 text-rose-600 active:scale-90"
              @click="removeDay(di)"
            >
              <!-- cestino: come nel catalogo esercizi -->
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                   stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5">
                <path d="M3 6h18" /><path d="M8 6V4h8v2" />
                <path d="M6 6l1 14h10l1-14" /><path d="M10 11v6M14 11v6" />
              </svg>
            </button>
          </div>

          <!-- Esercizi della giornata -->
          <div v-for="(ex, ei) in day.exercises" :key="ex._uid" class="mb-3 flex gap-2">
            <div class="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-gray-100">
              <img
                v-if="catalogById[ex.exercise_id]?.image_path"
                :src="exerciseImageUrl(catalogById[ex.exercise_id].image_path)"
                class="h-full w-full object-cover"
              />
              <div v-else class="flex h-full items-center justify-center text-lg">🏋️</div>
            </div>
            <div class="min-w-0 flex-1">
              <Combobox
                v-model="ex.exercise_id"
                :options="catalogOptions"
                dense
                :clearable="false"
                placeholder="Cerca esercizio…"
                empty-text="Nessun esercizio trovato"
              />
              <!-- serie / ripetizioni / recupero: icona a sinistra, resta leggibile
                   anche a campo pieno (il placeholder sparisce col valore) -->
              <div class="mt-1 grid grid-cols-3 gap-1">
                <div class="relative" title="Serie">
                  <span class="pointer-events-none absolute inset-y-0 left-1.5 flex items-center text-gray-400">
                    <!-- pila = numero di serie -->
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                         stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5">
                      <path d="M12 3l9 5-9 5-9-5 9-5Z" /><path d="M3 13l9 5 9-5" />
                    </svg>
                  </span>
                  <input v-model.number="ex.sets" type="number" min="1" placeholder="serie" aria-label="Serie"
                    class="w-full rounded border border-gray-300 py-1 pl-6 pr-1 text-center text-xs focus:border-brand focus:outline-none" />
                </div>

                <div
                  class="relative"
                  :title="catalogById[ex.exercise_id]?.load_type === 'level' ? 'Minuti' : 'Ripetizioni'"
                >
                  <span class="pointer-events-none absolute inset-y-0 left-1.5 flex items-center text-gray-400">
                    <!-- level: orologio (minuti) · weight: frecce di ripetizione -->
                    <svg v-if="catalogById[ex.exercise_id]?.load_type === 'level'"
                         viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                         stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5">
                      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
                    </svg>
                    <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                         stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5">
                      <path d="M17 2l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" />
                      <path d="M7 22l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
                    </svg>
                  </span>
                  <input v-model.number="ex.reps" type="number" min="1"
                    :placeholder="catalogById[ex.exercise_id]?.load_type === 'level' ? 'min' : 'ripet.'"
                    :aria-label="catalogById[ex.exercise_id]?.load_type === 'level' ? 'Minuti' : 'Ripetizioni'"
                    class="w-full rounded border border-gray-300 py-1 pl-6 pr-1 text-center text-xs focus:border-brand focus:outline-none" />
                </div>

                <div class="relative" title="Recupero (secondi)">
                  <span class="pointer-events-none absolute inset-y-0 left-1.5 flex items-center text-gray-400">
                    <!-- cronometro = recupero -->
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                         stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5">
                      <path d="M10 2h4" /><path d="M12 14v-4" /><circle cx="12" cy="14" r="8" />
                    </svg>
                  </span>
                  <input v-model.number="ex.rest_seconds" type="number" min="0" step="15" placeholder="rec.s"
                    aria-label="Recupero in secondi"
                    class="w-full rounded border border-gray-300 py-1 pl-6 pr-1 text-center text-xs focus:border-brand focus:outline-none" />
                </div>
              </div>
            </div>
            <div class="flex shrink-0 flex-col items-center gap-0.5">
              <button
                :disabled="ei === 0" title="Sposta su" aria-label="Sposta su"
                class="rounded p-1 text-gray-400 active:scale-90 disabled:opacity-30"
                @click="moveExercise(di, ei, -1)"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4"><path d="M18 15l-6-6-6 6" /></svg>
              </button>
              <button
                :disabled="ei === day.exercises.length - 1" title="Sposta giù" aria-label="Sposta giù"
                class="rounded p-1 text-gray-400 active:scale-90 disabled:opacity-30"
                @click="moveExercise(di, ei, 1)"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4"><path d="M6 9l6 6 6-6" /></svg>
              </button>
              <button
                title="Rimuovi" aria-label="Rimuovi"
                class="rounded p-1 text-rose-500 active:scale-90"
                @click="removeExercise(di, ei)"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" class="h-4 w-4"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
          </div>

          <button
            class="mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand/10 py-2 text-xs font-semibold text-brand active:scale-95"
            @click="addExercise(di)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
                 stroke-linecap="round" class="h-4 w-4"><path d="M12 5v14M5 12h14" /></svg>
            Aggiungi esercizio
          </button>
        </div>

        <button
          class="flex w-full items-center justify-center gap-2 rounded-xl border border-brand bg-white py-3 text-sm font-semibold text-brand active:scale-95"
          @click="addDay"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
               stroke-linecap="round" class="h-5 w-5"><path d="M12 5v14M5 12h14" /></svg>
          Aggiungi giornata
        </button>

        <!-- Note -->
        <div>
          <label class="mb-1 block text-sm font-medium text-gray-700">Note</label>
          <textarea v-model="notes" rows="2"
            class="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"></textarea>
        </div>

        <div class="flex gap-2">
          <button
            :disabled="saving"
            class="flex-1 rounded-xl bg-brand py-3 font-semibold text-white active:scale-95 disabled:opacity-60"
            @click="save"
          >
            {{ saving ? 'Salvataggio…' : 'Salva scheda' }}
          </button>
          <button
            class="rounded-xl border border-gray-300 px-4 py-3 text-sm font-semibold text-gray-700"
            @click="openDuplicate()"
          >
            Duplica
          </button>
          <button
            v-if="currentId"
            class="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-600"
            @click="deleteScheda"
          >
            Elimina
          </button>
        </div>
      </section>
    </template>

    <!-- Dialogo duplica / assegna -->
    <div
      v-if="dupOpen"
      class="fixed inset-0 z-30 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      @click.self="dupOpen = false"
    >
      <div class="w-full max-w-sm space-y-3 rounded-2xl bg-white p-4 shadow-xl">
        <h2 class="font-semibold text-gray-900">Duplica scheda</h2>
        <p class="text-xs text-gray-500">
          Crea una copia indipendente: scegli a chi assegnarla.
        </p>

        <div>
          <label class="mb-1 block text-xs font-medium text-gray-500">Titolo della copia</label>
          <input
            v-model="dupTitle"
            class="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
        </div>

        <div>
          <label class="mb-1 block text-xs font-medium text-gray-500">Assegna a</label>
          <Combobox
            v-model="dupTargetId"
            :options="memberOptions"
            :clearable="false"
            placeholder="Cerca cliente…"
            empty-text="Nessun cliente trovato"
          />
        </div>

        <div class="flex gap-2 pt-1">
          <button
            class="rounded-xl border border-gray-300 px-4 py-3 text-sm font-semibold text-gray-600"
            @click="dupOpen = false"
          >
            Annulla
          </button>
          <button
            :disabled="dupSaving || !dupTargetId"
            class="flex-1 rounded-xl bg-brand py-3 text-sm font-semibold text-white active:scale-95 disabled:opacity-60"
            @click="duplicate"
          >
            {{ dupSaving ? 'Copia…' : 'Duplica' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
