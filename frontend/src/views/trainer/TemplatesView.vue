<script setup>
// Trainer/Admin: libreria di MODELLI di scheda (schede preconfezionate).
// Tabella ordinabile e filtrabile (ricerca libera + filtro Tipo e Livello).
// Da ogni riga: dettaglio (giornate + esercizi) e assegnazione a un cliente
// (il backend clona il modello nelle schede del member).
import { ref, computed, watch, onMounted } from 'vue';
import { api } from '@/lib/api';
import { exerciseImageUrl } from '@/lib/storage';
import Modal from '@/components/Modal.vue';
import Combobox from '@/components/Combobox.vue';
import WorkoutDays from '@/components/WorkoutDays.vue';
import WorkoutDaysEditor from '@/components/WorkoutDaysEditor.vue';

const templates = ref([]);
const members = ref([]);
const catalog = ref([]);
const loading = ref(true);
const error = ref('');

const catalogById = computed(() =>
  Object.fromEntries(catalog.value.map((e) => [e.id, e]))
);
const memberOptions = computed(() =>
  members.value.map((m) => ({ value: m.id, label: m.full_name || m.email || 'Senza nome' }))
);

const dayCount = (t) => (t.days_json || []).length;
const exCount = (t) => (t.days_json || []).reduce((s, d) => s + (d.exercises?.length || 0), 0);
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');

// Opzioni per la combobox esercizi dell'editor (come in WorkoutsView)
const catalogOptions = computed(() =>
  catalog.value.map((c) => ({
    value: c.id,
    label: c.muscle_group ? `${c.name} · ${c.muscle_group}` : c.name,
    image: exerciseImageUrl(c.image_path),
  }))
);
const levelEditOptions = [
  { value: 'principiante', label: 'Principiante' },
  { value: 'intermedio', label: 'Intermedio' },
  { value: 'avanzato', label: 'Avanzato' },
];

// --- Editor modello (crea/modifica) ---
const editing = ref(false);
const editId = ref(null); // null = nuovo
const eTitle = ref('');
const eDescription = ref('');
const eGoal = ref('');
const eLevel = ref('');
const eDays = ref([]);
const eSaving = ref(false);

// Giornate ripulite dai campi solo-editor (_uid), numeri come numeri
function normalizeDays(src) {
  return (src || []).map((d) => ({
    name: d.name || '',
    exercises: (d.exercises || []).map((e) => ({
      exercise_id: e.exercise_id,
      sets: Number(e.sets),
      reps: Number(e.reps),
      rest_seconds: Number(e.rest_seconds),
    })),
  }));
}

function newTemplate() {
  editId.value = null;
  eTitle.value = '';
  eDescription.value = '';
  eGoal.value = '';
  eLevel.value = '';
  eDays.value = [{ name: 'Giorno A', exercises: [] }];
  error.value = '';
  editing.value = true;
}

function editTemplate(t) {
  editId.value = t.id;
  eTitle.value = t.title || '';
  eDescription.value = t.description || '';
  eGoal.value = t.goal || '';
  eLevel.value = t.level || '';
  eDays.value = (t.days_json || []).map((d) => ({
    name: d.name || '',
    exercises: (d.exercises || []).map((e) => ({ ...e })),
  }));
  detailOpen.value = false;
  error.value = '';
  editing.value = true;
}

async function saveTemplate() {
  if (!eTitle.value.trim()) { error.value = 'Il titolo è obbligatorio'; return; }
  eSaving.value = true;
  error.value = '';
  try {
    const payload = {
      title: eTitle.value.trim(),
      description: eDescription.value.trim() || null,
      goal: eGoal.value.trim() || null,
      level: eLevel.value || null,
      days_json: normalizeDays(eDays.value),
    };
    if (editId.value) await api.patch(`/api/templates/${editId.value}`, payload);
    else await api.post('/api/templates', payload);
    editing.value = false;
    templates.value = await api.get('/api/templates');
    toast.value = 'Modello salvato ✔';
    setTimeout(() => (toast.value = ''), 4000);
  } catch (e) {
    error.value = e.message;
  } finally {
    eSaving.value = false;
  }
}

async function removeTemplate(t) {
  if (!confirm(`Eliminare il modello "${t.title}"?`)) return;
  try {
    await api.del(`/api/templates/${t.id}`);
    detailOpen.value = false;
    templates.value = await api.get('/api/templates');
    toast.value = 'Modello eliminato ✔';
    setTimeout(() => (toast.value = ''), 4000);
  } catch (e) {
    error.value = e.message;
  }
}

async function load() {
  loading.value = true;
  try {
    [templates.value, members.value, catalog.value] = await Promise.all([
      api.get('/api/templates'),
      api.get('/api/members'),
      api.get('/api/exercises'),
    ]);
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

// --- Filtri: ricerca libera + Tipo (goal) + Livello ---
const search = ref('');
const typeFilter = ref('');
const levelFilter = ref('');

const LEVEL_RANK = { principiante: 0, intermedio: 1, avanzato: 2 };
const typeOptions = computed(() =>
  [...new Set(templates.value.map((t) => t.goal).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'it'))
    .map((g) => ({ value: g, label: cap(g) }))
);
const levelOptions = computed(() =>
  [...new Set(templates.value.map((t) => t.level).filter(Boolean))]
    .sort((a, b) => (LEVEL_RANK[a] ?? 9) - (LEVEL_RANK[b] ?? 9))
    .map((l) => ({ value: l, label: cap(l) }))
);

// --- Ordinamento ---
const sortKey = ref('title'); // 'title' | 'goal' | 'level' | 'days' | 'exercises'
const sortDir = ref('asc');
function toggleSort(key) {
  if (sortKey.value === key) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
  else { sortKey.value = key; sortDir.value = 'asc'; }
}
function sortIcon(key) {
  if (sortKey.value !== key) return '↕';
  return sortDir.value === 'asc' ? '↑' : '↓';
}
function sortVal(t, key) {
  if (key === 'days') return dayCount(t);
  if (key === 'exercises') return exCount(t);
  if (key === 'level') return LEVEL_RANK[t.level] ?? 9;
  if (key === 'goal') return (t.goal || '').toLowerCase();
  return (t.title || '').toLowerCase();
}

// --- Paginazione ---
const page = ref(1);
const PAGE_SIZE = 10;

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return templates.value.filter((t) => {
    if (typeFilter.value && t.goal !== typeFilter.value) return false;
    if (levelFilter.value && t.level !== levelFilter.value) return false;
    if (!q) return true;
    return [t.title, t.goal, t.level, t.description]
      .filter(Boolean)
      .some((v) => v.toLowerCase().includes(q));
  });
});
const sorted = computed(() => {
  const dir = sortDir.value === 'asc' ? 1 : -1;
  return [...filtered.value].sort((a, b) => {
    const va = sortVal(a, sortKey.value);
    const vb = sortVal(b, sortKey.value);
    const cmp = va < vb ? -1 : va > vb ? 1 : 0;
    return cmp * dir;
  });
});
const pageCount = computed(() => Math.max(1, Math.ceil(sorted.value.length / PAGE_SIZE)));
const paged = computed(() => sorted.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));
const rangeFrom = computed(() => (sorted.value.length ? (page.value - 1) * PAGE_SIZE + 1 : 0));
const rangeTo = computed(() => Math.min(page.value * PAGE_SIZE, sorted.value.length));

watch([search, typeFilter, levelFilter, sortKey, sortDir], () => { page.value = 1; });
watch(pageCount, (n) => { if (page.value > n) page.value = n; });

// --- Dettaglio ---
const detailOpen = ref(false);
const detailTemplate = ref(null);
function openDetail(t) {
  detailTemplate.value = t;
  detailOpen.value = true;
}

// --- Assegnazione ---
const assignOpen = ref(false);
const assignTemplate = ref(null);
const assignMemberId = ref('');
const assigning = ref(false);
const toast = ref('');

function openAssign(t) {
  assignTemplate.value = t;
  assignMemberId.value = '';
  error.value = '';
  assignOpen.value = true;
}

async function assign() {
  if (!assignMemberId.value) return;
  assigning.value = true;
  error.value = '';
  try {
    await api.post(`/api/templates/${assignTemplate.value.id}/assign`, {
      member_id: assignMemberId.value,
    });
    const who = memberOptions.value.find((o) => o.value === assignMemberId.value)?.label || 'cliente';
    toast.value = `"${assignTemplate.value.title}" assegnato a ${who} ✔`;
    assignOpen.value = false;
    setTimeout(() => (toast.value = ''), 4000);
  } catch (e) {
    error.value = e.message;
  } finally {
    assigning.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="space-y-4">
    <p v-if="error && !assignOpen" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</p>
    <p v-if="toast" class="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{{ toast }}</p>

    <div v-if="!editing" class="flex items-center justify-between">
      <h1 class="text-lg font-bold text-gray-900">Modelli</h1>
      <button
        class="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white active:scale-95"
        @click="newTemplate"
      >
        + Nuovo modello
      </button>
    </div>

    <template v-if="!editing">
    <!-- Filtri -->
    <input
      v-model="search" type="search" placeholder="Cerca modello…"
      class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-brand focus:outline-none"
    />
    <div class="grid grid-cols-2 gap-2">
      <Combobox v-model="typeFilter" :options="typeOptions" dense placeholder="Tutti i tipi" empty-text="Nessun tipo" />
      <Combobox v-model="levelFilter" :options="levelOptions" dense placeholder="Tutti i livelli" empty-text="Nessun livello" />
    </div>

    <p v-if="loading" class="text-sm text-gray-400">Caricamento…</p>
    <p v-else-if="!templates.length" class="rounded-xl bg-white p-4 text-sm text-gray-400 shadow-sm">
      Nessun modello.
    </p>
    <p v-else-if="!sorted.length" class="rounded-xl bg-white p-4 text-sm text-gray-400 shadow-sm">
      Nessun risultato con i filtri correnti.
    </p>

    <template v-else>
      <div class="overflow-hidden rounded-2xl bg-white shadow-sm">
        <table class="w-full table-fixed text-left text-sm">
          <thead class="border-b border-gray-100 text-xs uppercase text-gray-400">
            <tr>
              <th class="px-3 py-2">
                <button class="font-semibold uppercase" @click="toggleSort('title')">
                  Titolo <span class="text-gray-300">{{ sortIcon('title') }}</span>
                </button>
              </th>
              <th class="w-12 px-2 py-2 text-center">
                <button class="font-semibold uppercase" @click="toggleSort('days')">
                  Gg <span class="text-gray-300">{{ sortIcon('days') }}</span>
                </button>
              </th>
              <th class="w-12 px-2 py-2 text-center">
                <button class="font-semibold uppercase" @click="toggleSort('exercises')">
                  Es <span class="text-gray-300">{{ sortIcon('exercises') }}</span>
                </button>
              </th>
              <th class="w-20 px-2 py-2 text-right">Azioni</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-50">
            <tr v-for="t in paged" :key="t.id" class="align-middle">
              <td class="px-3 py-2">
                <p class="truncate font-medium text-gray-900">{{ t.title }}</p>
                <div v-if="t.goal || t.level" class="mt-0.5 flex flex-wrap gap-1">
                  <span v-if="t.goal" class="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-semibold capitalize text-brand-700">{{ t.goal }}</span>
                  <span v-if="t.level" class="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold capitalize text-gray-500">{{ t.level }}</span>
                </div>
              </td>
              <td class="px-2 py-2 text-center text-gray-500">{{ dayCount(t) }}</td>
              <td class="px-2 py-2 text-center text-gray-500">{{ exCount(t) }}</td>
              <td class="whitespace-nowrap px-2 py-2">
                <div class="flex justify-end gap-1">
                  <button
                    class="rounded-lg p-1.5 text-gray-500 active:scale-90"
                    title="Dettaglio" aria-label="Dettaglio" @click="openDetail(t)"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                         stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5">
                      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" />
                    </svg>
                  </button>
                  <button
                    class="rounded-lg p-1.5 text-brand active:scale-90"
                    title="Assegna a cliente" aria-label="Assegna a cliente" @click="openAssign(t)"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                         stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5">
                      <path d="M16 11a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" /><path d="M4 21v-1a5 5 0 0 1 5-5h3" />
                      <path d="M19 15v6M22 18h-6" />
                    </svg>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="flex items-center justify-between text-xs text-gray-500">
        <span>{{ rangeFrom }}–{{ rangeTo }} di {{ sorted.length }}</span>
        <div class="flex items-center gap-2">
          <button :disabled="page === 1" class="rounded-lg border border-gray-300 px-3 py-1 font-semibold disabled:opacity-40" @click="page--">‹</button>
          <span>{{ page }} / {{ pageCount }}</span>
          <button :disabled="page === pageCount" class="rounded-lg border border-gray-300 px-3 py-1 font-semibold disabled:opacity-40" @click="page++">›</button>
        </div>
      </div>
    </template>
    </template>

    <!-- Editor modello (crea/modifica) -->
    <section v-else class="space-y-4">
      <button class="text-sm text-brand" @click="editing = false">‹ Torna ai modelli</button>
      <div>
        <label class="mb-1 block text-sm font-medium text-gray-700">Titolo</label>
        <input
          v-model="eTitle" placeholder="Es. Full Body 3x"
          class="w-full rounded-xl border border-gray-300 px-4 py-3 font-medium focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
        />
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="mb-1 block text-xs font-medium text-gray-500">Tipo</label>
          <input
            v-model="eGoal" placeholder="Es. ipertrofia"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
          />
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-gray-500">Livello</label>
          <Combobox v-model="eLevel" :options="levelEditOptions" dense placeholder="—" empty-text="—" />
        </div>
      </div>
      <div>
        <label class="mb-1 block text-xs font-medium text-gray-500">Descrizione</label>
        <textarea
          v-model="eDescription" rows="2" placeholder="Opzionale"
          class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
        ></textarea>
      </div>

      <WorkoutDaysEditor v-model="eDays" :catalog-options="catalogOptions" :catalog-by-id="catalogById" />

      <div class="flex gap-2">
        <button
          class="rounded-xl border border-gray-300 px-4 py-3 text-sm font-semibold text-gray-600"
          @click="editing = false"
        >
          Annulla
        </button>
        <button
          :disabled="eSaving"
          class="flex-1 rounded-xl bg-brand py-3 text-sm font-semibold text-white active:scale-95 disabled:opacity-60"
          @click="saveTemplate"
        >
          {{ eSaving ? 'Salvataggio…' : 'Salva modello' }}
        </button>
      </div>
    </section>

    <!-- Modale dettaglio: giornate + esercizi -->
    <Modal :open="detailOpen" :title="detailTemplate?.title || 'Modello'" @close="detailOpen = false">
      <div v-if="detailTemplate">
        <div class="mb-3 flex flex-wrap gap-1">
          <span v-if="detailTemplate.goal" class="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-semibold capitalize text-brand-700">{{ detailTemplate.goal }}</span>
          <span v-if="detailTemplate.level" class="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold capitalize text-gray-500">{{ detailTemplate.level }}</span>
        </div>
        <WorkoutDays
          :days="detailTemplate.days_json"
          :catalog-by-id="catalogById"
          :notes="detailTemplate.description || ''"
        />
        <div class="mt-4 space-y-2">
          <button
            class="w-full rounded-lg bg-brand py-2 text-sm font-semibold text-white active:scale-95"
            @click="detailOpen = false; openAssign(detailTemplate)"
          >
            Assegna a cliente
          </button>
          <div class="flex gap-2">
            <button
              class="flex-1 rounded-lg border border-gray-300 py-2 text-sm font-semibold text-gray-600 active:scale-95"
              @click="editTemplate(detailTemplate)"
            >
              Modifica
            </button>
            <button
              class="flex-1 rounded-lg border border-red-200 bg-red-50 py-2 text-sm font-semibold text-red-700 active:scale-95"
              @click="removeTemplate(detailTemplate)"
            >
              Elimina
            </button>
          </div>
        </div>
      </div>
    </Modal>

    <!-- Modale assegnazione -->
    <Modal :open="assignOpen" :title="assignTemplate?.title || 'Assegna modello'" @close="assignOpen = false">
      <p v-if="error" class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</p>
      <p class="mb-3 text-sm text-gray-500">
        Crea una copia di questo modello nelle schede del cliente scelto.
      </p>
      <div>
        <label class="mb-1 block text-xs font-medium text-gray-500">Cliente</label>
        <Combobox
          v-model="assignMemberId"
          :options="memberOptions"
          :clearable="false"
          placeholder="Cerca cliente…"
          empty-text="Nessun cliente trovato"
        />
      </div>
      <div class="mt-4 flex gap-2">
        <button
          type="button"
          class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-600"
          @click="assignOpen = false"
        >
          Annulla
        </button>
        <button
          :disabled="assigning || !assignMemberId"
          class="flex-1 rounded-lg bg-brand py-2 text-sm font-semibold text-white active:scale-95 disabled:opacity-60"
          @click="assign"
        >
          {{ assigning ? 'Assegno…' : 'Assegna' }}
        </button>
      </div>
    </Modal>
  </div>
</template>
