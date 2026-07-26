<script setup>
// Trainer: gestione SCHEDE come entità.
// Flusso: seleziona cliente -> lista delle sue schede -> crea/modifica una
// scheda con TITOLO e GIORNATE; ogni giornata ha i suoi esercizi (dal catalogo)
// con serie/ripetizioni/recupero.
import { ref, onMounted, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/lib/api';
import { exerciseImageUrl } from '@/lib/storage';
import Combobox from '@/components/Combobox.vue';
import Modal from '@/components/Modal.vue';
import WorkoutDaysEditor from '@/components/WorkoutDaysEditor.vue';
import ClientCard from '@/components/ClientCard.vue';

const route = useRoute();
const router = useRouter();

const members = ref([]);
const catalog = ref([]);
const templates = ref([]);
// Il cliente è fissato dalla rotta (/clienti/:memberId/schede)
const selectedMemberId = computed(() => route.params.memberId || '');
const member = computed(
  () => members.value.find((m) => m.id === selectedMemberId.value) || null
);
const memberName = computed(() => member.value?.full_name || 'Cliente');
const schede = ref([]); // schede del cliente selezionato

// Editor
const editing = ref(false);
const currentId = ref(null); // null = nuova scheda
const title = ref('');
const notes = ref('');
const goal = ref('');
const level = ref('');
const days = ref([]); // [{ name, exercises: [{exercise_id, sets, reps, rest_seconds}] }]
const editLevelOptions = [
  { value: 'principiante', label: 'Principiante' },
  { value: 'intermedio', label: 'Intermedio' },
  { value: 'avanzato', label: 'Avanzato' },
];

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
// Numero totale di esercizi della scheda (somma sulle giornate)
const schedaExCount = (s) => (s.days_json || []).reduce((n, d) => n + (d.exercises?.length || 0), 0);

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
  newMenuOpen.value = false;
  currentId.value = null;
  title.value = '';
  notes.value = '';
  goal.value = '';
  level.value = '';
  days.value = [{ name: 'Giorno A', exercises: [] }];
  message.value = '';
  editing.value = true;
}

// --- Pulsante composto "Nuova scheda": menu a tendina + scelta da modello ---
const newMenuOpen = ref(false);
const tplPickOpen = ref(false);

// Tabella modelli nella modale: ricerca libera + filtro livello + paginazione
const tplSearch = ref('');
const tplLevelFilter = ref(''); // '' = tutti i livelli
const tplPage = ref(1);
const TPL_PAGE_SIZE = 5;

// Livelli presenti nei modelli, ordinati per difficoltà
const LEVEL_RANK = { principiante: 0, intermedio: 1, avanzato: 2 };
const tplLevels = computed(() =>
  [...new Set(templates.value.map((t) => t.level).filter(Boolean))].sort(
    (a, b) => (LEVEL_RANK[a] ?? 9) - (LEVEL_RANK[b] ?? 9)
  )
);
const tplLevelOptions = computed(() =>
  tplLevels.value.map((l) => ({ value: l, label: l[0].toUpperCase() + l.slice(1) }))
);
const tplDays = (t) => (t.days_json || []).length;
const tplExercises = (t) => (t.days_json || []).reduce((s, d) => s + (d.exercises?.length || 0), 0);

const tplSortKey = ref('title'); // 'title' | 'days' | 'exercises'
const tplSortDir = ref('asc');
function toggleTplSort(key) {
  if (tplSortKey.value === key) {
    tplSortDir.value = tplSortDir.value === 'asc' ? 'desc' : 'asc';
  } else {
    tplSortKey.value = key;
    tplSortDir.value = 'asc';
  }
}
function tplSortIcon(key) {
  if (tplSortKey.value !== key) return '↕';
  return tplSortDir.value === 'asc' ? '↑' : '↓';
}
function tplSortVal(t, key) {
  if (key === 'days') return tplDays(t);
  if (key === 'exercises') return tplExercises(t);
  if (key === 'level') return (t.level || '').toLowerCase();
  return (t.title || '').toLowerCase();
}

const filteredTemplates = computed(() => {
  const q = tplSearch.value.trim().toLowerCase();
  const lvl = tplLevelFilter.value;
  return templates.value.filter((t) => {
    if (lvl && t.level !== lvl) return false;
    if (!q) return true;
    return [t.title, t.goal, t.level].filter(Boolean).some((v) => v.toLowerCase().includes(q));
  });
});
const sortedTemplates = computed(() => {
  const dir = tplSortDir.value === 'asc' ? 1 : -1;
  return [...filteredTemplates.value].sort((a, b) => {
    const va = tplSortVal(a, tplSortKey.value);
    const vb = tplSortVal(b, tplSortKey.value);
    const cmp = va < vb ? -1 : va > vb ? 1 : 0;
    return cmp * dir;
  });
});
const tplPageCount = computed(() => Math.max(1, Math.ceil(sortedTemplates.value.length / TPL_PAGE_SIZE)));
const pagedTemplates = computed(() =>
  sortedTemplates.value.slice((tplPage.value - 1) * TPL_PAGE_SIZE, tplPage.value * TPL_PAGE_SIZE)
);
watch([tplSearch, tplLevelFilter, tplSortKey, tplSortDir], () => { tplPage.value = 1; });

function openTemplatePicker() {
  newMenuOpen.value = false;
  tplSearch.value = '';
  tplLevelFilter.value = '';
  tplPage.value = 1;
  error.value = '';
  tplPickOpen.value = true;
}

// Crea una nuova scheda copiando il modello scelto, poi apre l'editor per rifinirla.
async function newFromTemplate(tpl) {
  if (!tpl) return;
  saving.value = true;
  error.value = '';
  try {
    const created = await api.post('/api/workouts', {
      member_id: selectedMemberId.value,
      title: tpl.title,
      notes: tpl.description || '',
      goal: tpl.goal || null,
      level: tpl.level || null,
      days_json: normalizeDays(tpl.days_json),
    });
    tplPickOpen.value = false;
    schede.value = await api.get(`/api/workouts/member/${selectedMemberId.value}`);
    editScheda(created); // apre l'editor sulla scheda appena creata
    message.value = 'Scheda creata dal modello — rifiniscila e salva ✔';
  } catch (e) {
    error.value = e.message;
  } finally {
    saving.value = false;
  }
}

// --- Salva una scheda (o lo stato dell'editor) come nuovo MODELLO ---
const saveTplOpen = ref(false);
const stpTitle = ref('');
const stpGoal = ref('');
const stpLevel = ref('');
const stpNotes = ref('');
const stpDays = ref([]);
const stpSaving = ref(false);
const stpLevelOptions = [
  { value: 'principiante', label: 'Principiante' },
  { value: 'intermedio', label: 'Intermedio' },
  { value: 'avanzato', label: 'Avanzato' },
];

// source = una scheda della lista, oppure null = stato corrente dell'editor
function openSaveAsTemplate(source = null) {
  const base = source
    ? { title: source.title, notes: source.notes, goal: source.goal, level: source.level, days: source.days_json }
    : { title: title.value, notes: notes.value, goal: goal.value, level: level.value, days: days.value };
  stpTitle.value = `${base.title || 'Senza titolo'} (modello)`;
  stpNotes.value = base.notes || '';
  stpGoal.value = base.goal || '';
  stpLevel.value = base.level || '';
  stpDays.value = normalizeDays(base.days);
  error.value = '';
  saveTplOpen.value = true;
}

async function saveAsTemplate() {
  if (!stpTitle.value.trim()) return;
  stpSaving.value = true;
  error.value = '';
  try {
    await api.post('/api/templates', {
      title: stpTitle.value.trim(),
      description: stpNotes.value.trim() || null,
      goal: stpGoal.value.trim() || null,
      level: stpLevel.value || null,
      days_json: stpDays.value,
    });
    saveTplOpen.value = false;
    message.value = 'Modello creato dalla scheda ✔';
  } catch (e) {
    error.value = e.message;
  } finally {
    stpSaving.value = false;
  }
}

function editScheda(s) {
  currentId.value = s.id;
  title.value = s.title || '';
  notes.value = s.notes || '';
  goal.value = s.goal || '';
  level.value = s.level || '';
  // Copia profonda per non mutare la lista (il _uid lo assegna l'editor)
  days.value = (s.days_json || []).map((d) => ({
    name: d.name || '',
    exercises: (d.exercises || []).map((e) => ({ ...e })),
  }));
  message.value = '';
  editing.value = true;
}

async function save() {
  saving.value = true;
  message.value = '';
  error.value = '';
  try {
    const payload = {
      title: title.value,
      notes: notes.value,
      goal: goal.value || null,
      level: level.value || null,
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
    [members.value, catalog.value, templates.value] = await Promise.all([
      api.get('/api/members'),
      api.get('/api/exercises'),
      api.get('/api/templates'),
    ]);
    await loadSchede();
  } catch (e) {
    error.value = e.message;
  }
});

// Se si naviga a un altro cliente senza smontare la vista, ricarica le schede
watch(selectedMemberId, loadSchede);
</script>

<template>
  <div class="space-y-4">
    <!-- Header: torna ai clienti + card cliente -->
    <div class="space-y-2">
      <button class="text-sm text-brand active:scale-95" @click="router.push({ name: 'clients' })">‹ Clienti</button>
      <ClientCard v-if="member" :member="member" />
    </div>

    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</p>
    <p v-if="message" class="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{{ message }}</p>
    <p v-if="loading" class="text-sm text-gray-400">Caricamento…</p>

    <!-- Lista schede del cliente + nuova -->
    <template v-if="selectedMemberId && !loading">
      <section v-if="!editing" class="space-y-2">
        <div class="flex items-center justify-between">
          <h2 class="font-semibold text-gray-900">Schede</h2>
          <!-- Pulsante composto: azione principale + menu (da modello) -->
          <div class="relative">
            <div class="flex">
              <button
                class="rounded-l-full bg-brand px-4 py-2 text-sm font-semibold text-white active:scale-95"
                @click="newScheda"
              >
                + Nuova scheda
              </button>
              <button
                class="rounded-r-full border-l border-white/30 bg-brand px-2 text-white active:scale-95"
                aria-label="Altre opzioni" @click="newMenuOpen = !newMenuOpen"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
                     stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4"
                     :class="newMenuOpen && 'rotate-180'"><path d="M6 9l6 6 6-6" /></svg>
              </button>
            </div>
            <div v-if="newMenuOpen" class="fixed inset-0 z-10" @click="newMenuOpen = false"></div>
            <div
              v-if="newMenuOpen"
              class="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg"
            >
              <button class="block w-full px-4 py-2 text-left text-sm text-gray-700 active:bg-gray-100" @click="newScheda">
                Scheda vuota
              </button>
              <button class="block w-full px-4 py-2 text-left text-sm text-gray-700 active:bg-gray-100" @click="openTemplatePicker">
                Da un modello…
              </button>
            </div>
          </div>
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
                    <th class="w-24 px-2 py-2">
                      <button class="font-semibold uppercase" @click="toggleSchedaSort('updated_at')">
                        Agg. <span class="text-gray-300">{{ schedaSortIcon('updated_at') }}</span>
                      </button>
                    </th>
                    <th class="w-24 px-2 py-2"></th>
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
                          <div v-if="s.goal || s.level" class="mt-0.5 flex flex-wrap gap-1">
                            <span v-if="s.goal" class="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-semibold capitalize text-brand-700">{{ s.goal }}</span>
                            <span v-if="s.level" class="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold capitalize text-gray-500">{{ s.level }}</span>
                          </div>
                          <div class="mt-0.5 flex flex-wrap items-center gap-1">
                            <span class="inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500"
                                  :title="`Creata il ${fmtDateTime(s.created_at)}`">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3">
                                <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
                              </svg>
                              {{ fmtDate(s.created_at) }}
                            </span>
                            <span class="inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500" title="Giornate">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3">
                                <rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" />
                              </svg>
                              {{ (s.days_json || []).length }}
                            </span>
                            <span class="inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500" title="Esercizi">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3">
                                <path d="M6.5 6.5l11 11M4 7l3-3 3 3-3 3zM14 17l3-3 3 3-3 3zM3 12h2M19 12h2" />
                              </svg>
                              {{ schedaExCount(s) }}
                            </span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td class="px-2 py-2 text-xs text-gray-500" :title="`Aggiornata il ${fmtDateTime(s.updated_at)}`">
                      {{ fmtDate(s.updated_at) }}
                    </td>
                    <td class="px-2 py-2">
                      <div class="flex justify-end gap-0.5">
                        <button
                          title="Salva come modello" aria-label="Salva come modello"
                          class="rounded-lg p-1.5 text-gray-500 active:scale-90"
                          @click="openSaveAsTemplate(s)"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                               stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5">
                            <path d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5" />
                          </svg>
                        </button>
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

        <div>
          <label class="mb-1 block text-sm font-medium text-gray-700">Titolo scheda</label>
          <input
            v-model="title"
            placeholder="Es. Ipertrofia - Fase 1"
            class="w-full rounded-xl border border-gray-300 px-4 py-3 font-medium focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="mb-1 block text-xs font-medium text-gray-500">Tipo</label>
            <input
              v-model="goal" placeholder="Es. ipertrofia"
              class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
            />
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-gray-500">Livello</label>
            <Combobox v-model="level" :options="editLevelOptions" dense placeholder="—" empty-text="—" />
          </div>
        </div>

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

        <!-- Giornate + esercizi (editor condiviso) -->
        <WorkoutDaysEditor
          v-model="days"
          :catalog-options="catalogOptions"
          :catalog-by-id="catalogById"
        />

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
            class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700"
            @click="deleteScheda"
          >
            Elimina
          </button>
        </div>
        <button
          class="w-full rounded-xl border border-brand/40 bg-brand/5 py-2.5 text-sm font-semibold text-brand active:scale-95"
          @click="openSaveAsTemplate()"
        >
          ★ Salva come modello
        </button>
      </section>
    </template>

    <!-- Dialogo duplica / assegna -->
    <Modal :open="dupOpen" title="Duplica scheda" @close="dupOpen = false">
      <div class="space-y-3">
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
    </Modal>

    <!-- Nuova scheda da un modello -->
    <Modal :open="tplPickOpen" title="Nuova scheda da modello" @close="tplPickOpen = false">
      <p v-if="error" class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</p>
      <p class="mb-3 text-sm text-gray-500">
        Scegli un modello: verrà creata una scheda per <b>{{ memberName }}</b> e si aprirà l'editor.
      </p>
      <div class="mb-2 flex gap-2">
        <input
          v-model="tplSearch" type="search" placeholder="Cerca modello…"
          class="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
        />
        <div class="w-36 shrink-0">
          <Combobox
            v-model="tplLevelFilter"
            :options="tplLevelOptions"
            dense
            placeholder="Tutti i livelli"
            empty-text="Nessun livello"
          />
        </div>
      </div>

      <p v-if="!filteredTemplates.length" class="rounded-lg bg-gray-50 p-3 text-sm text-gray-400">
        Nessun modello trovato.
      </p>
      <template v-else>
        <div class="overflow-hidden rounded-xl border border-gray-100">
          <table class="w-full table-fixed text-left text-sm">
            <thead class="border-b border-gray-100 text-xs uppercase text-gray-400">
              <tr>
                <th class="px-3 py-2">
                  <button class="font-semibold uppercase" @click="toggleTplSort('title')">
                    Modello <span class="text-gray-300">{{ tplSortIcon('title') }}</span>
                  </button>
                </th>
                <th class="w-20 px-1 py-2">
                  <button class="font-semibold uppercase" @click="toggleTplSort('level')">
                    Liv. <span class="text-gray-300">{{ tplSortIcon('level') }}</span>
                  </button>
                </th>
                <th class="w-8 px-1 py-2 text-center">
                  <button class="font-semibold uppercase" @click="toggleTplSort('days')">
                    Gg <span class="text-gray-300">{{ tplSortIcon('days') }}</span>
                  </button>
                </th>
                <th class="w-8 px-1 py-2 text-center">
                  <button class="font-semibold uppercase" @click="toggleTplSort('exercises')">
                    Es <span class="text-gray-300">{{ tplSortIcon('exercises') }}</span>
                  </button>
                </th>
                <th class="w-10 px-1 py-2"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-50">
              <tr v-for="t in pagedTemplates" :key="t.id">
                <td class="px-3 py-2">
                  <p class="truncate font-medium text-gray-900">{{ t.title }}</p>
                  <p v-if="t.goal" class="truncate text-[11px] capitalize text-gray-400">{{ t.goal }}</p>
                </td>
                <td class="px-1 py-2">
                  <span class="truncate capitalize text-xs text-gray-500">{{ t.level || '—' }}</span>
                </td>
                <td class="px-1 py-2 text-center text-gray-500">{{ tplDays(t) }}</td>
                <td class="px-1 py-2 text-center text-gray-500">{{ tplExercises(t) }}</td>
                <td class="px-1 py-2 text-right">
                  <button
                    :disabled="saving" title="Crea da questo modello" aria-label="Crea da questo modello"
                    class="rounded-lg bg-brand p-1.5 text-white active:scale-90 disabled:opacity-60"
                    @click="newFromTemplate(t)"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                         stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="tplPageCount > 1" class="mt-2 flex items-center justify-between text-xs text-gray-500">
          <span>{{ filteredTemplates.length }} modelli</span>
          <div class="flex items-center gap-2">
            <button :disabled="tplPage === 1" class="rounded-lg border border-gray-300 px-3 py-1 font-semibold disabled:opacity-40" @click="tplPage--">‹</button>
            <span>{{ tplPage }} / {{ tplPageCount }}</span>
            <button :disabled="tplPage === tplPageCount" class="rounded-lg border border-gray-300 px-3 py-1 font-semibold disabled:opacity-40" @click="tplPage++">›</button>
          </div>
        </div>
      </template>
    </Modal>

    <!-- Salva scheda come modello -->
    <Modal :open="saveTplOpen" title="Salva come modello" @close="saveTplOpen = false">
      <p v-if="error" class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</p>
      <p class="mb-3 text-sm text-gray-500">
        Crea un modello riutilizzabile dalle giornate di questa scheda (non legato al cliente).
      </p>
      <div class="space-y-3">
        <div>
          <label class="mb-1 block text-xs font-medium text-gray-500">Titolo</label>
          <input
            v-model="stpTitle"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
          />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="mb-1 block text-xs font-medium text-gray-500">Tipo</label>
            <input
              v-model="stpGoal" placeholder="Es. ipertrofia"
              class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
            />
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-gray-500">Livello</label>
            <Combobox v-model="stpLevel" :options="stpLevelOptions" dense placeholder="—" empty-text="—" />
          </div>
        </div>
        <div class="flex gap-2 pt-1">
          <button
            class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-600"
            @click="saveTplOpen = false"
          >
            Annulla
          </button>
          <button
            :disabled="stpSaving || !stpTitle.trim()"
            class="flex-1 rounded-lg bg-brand py-2 text-sm font-semibold text-white active:scale-95 disabled:opacity-60"
            @click="saveAsTemplate"
          >
            {{ stpSaving ? 'Salvataggio…' : 'Crea modello' }}
          </button>
        </div>
      </div>
    </Modal>
  </div>
</template>
