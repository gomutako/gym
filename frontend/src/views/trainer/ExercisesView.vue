<script setup>
// Catalogo esercizi (trainer/admin): tabella ordinabile/paginata con ricerca,
// più form unico per creazione e modifica.
// La descrizione non è una colonna (starebbe stretta su mobile) ma resta
// filtrabile dalla ricerca e visibile/modificabile nel form.
// L'immagine è condivisa: rappresenta il tipo di esercizio.
import { ref, computed, watch, onMounted } from 'vue';
import { api } from '@/lib/api';
import { exerciseImageUrl, uploadExerciseImage } from '@/lib/storage';
import Modal from '@/components/Modal.vue';
import Combobox from '@/components/Combobox.vue';

const exercises = ref([]);
const loading = ref(true);
const saving = ref(false);
const error = ref('');

// --- Form (creazione + modifica) ---
const emptyForm = () => ({
  name: '',
  muscle_group: '',
  description: '',
  load_type: 'weight',
  has_incline: false,
  video_url: '',
  // Metadati aggiuntivi (allineati alla fonte free-exercise-db)
  equipment: '',
  category: '',
  force: '',
  level: '',
  mechanic: '',
  secondary_muscles: '', // input come lista separata da virgole
  instructions: '',      // input come passi separati da a-capo
});
const form = ref(emptyForm());

// Opzioni per le combobox del form (sostituiscono i vecchi <select>)
const loadTypeOptions = [
  { value: 'weight', label: 'Peso (kg) — es. panca, squat' },
  { value: 'level', label: 'Livello di difficoltà — es. tapis roulant' },
];
const levelOptions = [
  { value: 'principiante', label: 'Principiante' },
  { value: 'intermedio', label: 'Intermedio' },
  { value: 'avanzato', label: 'Avanzato' },
];
const mechanicOptions = [
  { value: 'composto', label: 'Composto' },
  { value: 'isolamento', label: 'Isolamento' },
];
const forceOptions = [
  { value: 'spinta', label: 'Spinta' },
  { value: 'trazione', label: 'Trazione' },
  { value: 'statico', label: 'Statico' },
];

const editingId = ref(null);       // null = creazione
const formOpen = ref(false);

// Editor immagini: lista ordinata di elementi. Ognuno è o un'immagine GIÀ salvata
// (path nel bucket) o un FILE nuovo ancora da caricare (con anteprima locale).
// La prima immagine della lista è la copertina (image_path).
let imgKey = 0;
const imageItems = ref([]); // [{ key, path?, file?, url }]

function addImageFiles(e) {
  for (const f of e.target.files) {
    imageItems.value.push({ key: imgKey++, file: f, url: URL.createObjectURL(f) });
  }
  e.target.value = ''; // consente di riselezionare lo stesso file
}

function removeImage(i) {
  const [rm] = imageItems.value.splice(i, 1);
  if (rm?.file) URL.revokeObjectURL(rm.url); // libera l'anteprima locale
}

function moveImage(i, delta) {
  const j = i + delta;
  if (j < 0 || j >= imageItems.value.length) return;
  const arr = imageItems.value;
  [arr[i], arr[j]] = [arr[j], arr[i]];
}

// Libera le anteprime locali dei file non ancora caricati
function revokeImagePreviews() {
  for (const it of imageItems.value) if (it.file) URL.revokeObjectURL(it.url);
}

function openCreate() {
  editingId.value = null;
  form.value = emptyForm();
  revokeImagePreviews();
  imageItems.value = [];
  formOpen.value = true;
}

function openEdit(ex) {
  editingId.value = ex.id;
  form.value = {
    name: ex.name,
    muscle_group: ex.muscle_group || '',
    description: ex.description || '',
    load_type: ex.load_type || 'weight',
    has_incline: !!ex.has_incline,
    video_url: ex.video_url || '',
    equipment: ex.equipment || '',
    category: ex.category || '',
    force: ex.force || '',
    level: ex.level || '',
    mechanic: ex.mechanic || '',
    secondary_muscles: (ex.secondary_muscles || []).join(', '),
    instructions: (ex.instructions || []).join('\n'),
  };
  revokeImagePreviews();
  const paths = ex.image_paths?.length ? ex.image_paths : ex.image_path ? [ex.image_path] : [];
  imageItems.value = paths.map((p) => ({ key: imgKey++, path: p, url: exerciseImageUrl(p) }));
  formOpen.value = true;
}

function closeForm() {
  formOpen.value = false;
  editingId.value = null;
  revokeImagePreviews();
  imageItems.value = [];
}

async function load() {
  loading.value = true;
  try {
    exercises.value = await api.get('/api/exercises');
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function save() {
  error.value = '';
  saving.value = true;
  try {
    // 1. Risolvi le immagini nell'ordine scelto: i file nuovi vengono caricati,
    //    quelli già salvati mantengono il loro path. La prima è la copertina.
    const image_paths = [];
    for (const it of imageItems.value) {
      image_paths.push(it.path ?? (await uploadExerciseImage(it.file)));
    }
    const image_path = image_paths[0] ?? null;

    // "muscolo1, muscolo2" -> ['muscolo1', 'muscolo2'] (vuoto -> [])
    const secondary = form.value.secondary_muscles
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    // istruzioni: un passo per riga
    const steps = form.value.instructions
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    if (editingId.value) {
      // In modifica: i campi opzionali vuoti diventano null (svuotamento esplicito)
      await api.patch(`/api/exercises/${editingId.value}`, {
        name: form.value.name,
        muscle_group: form.value.muscle_group || null,
        description: form.value.description || null,
        load_type: form.value.load_type,
        has_incline: form.value.has_incline,
        video_url: form.value.video_url || null,
        equipment: form.value.equipment || null,
        category: form.value.category || null,
        force: form.value.force || null,
        level: form.value.level || null,
        mechanic: form.value.mechanic || null,
        secondary_muscles: secondary,
        instructions: steps,
        image_path, // copertina (o null se nessuna immagine)
        image_paths, // elenco ordinato completo (carousel)
      });
    } else {
      await api.post('/api/exercises', {
        name: form.value.name,
        muscle_group: form.value.muscle_group || undefined,
        description: form.value.description || undefined,
        load_type: form.value.load_type,
        has_incline: form.value.has_incline,
        video_url: form.value.video_url || undefined,
        equipment: form.value.equipment || undefined,
        category: form.value.category || undefined,
        force: form.value.force || undefined,
        level: form.value.level || undefined,
        mechanic: form.value.mechanic || undefined,
        ...(secondary.length ? { secondary_muscles: secondary } : {}),
        ...(steps.length ? { instructions: steps } : {}),
        ...(image_path ? { image_path, image_paths } : {}),
      });
    }

    closeForm();
    await load();
  } catch (e) {
    error.value = e.message;
  } finally {
    saving.value = false;
  }
}

async function remove(ex) {
  if (!confirm(`Eliminare "${ex.name}" dal catalogo?`)) return;
  try {
    await api.del(`/api/exercises/${ex.id}`);
    if (editingId.value === ex.id) closeForm();
    await load();
  } catch (e) {
    error.value = e.message;
  }
}

// --- Ricerca / ordinamento / paginazione ---
const search = ref('');
const groupFilter = ref(''); // '' = tutti
const equipmentFilter = ref('');
const levelFilter = ref('');
const mechanicFilter = ref('');
const sortKey = ref('name');
const sortDir = ref('asc');
const page = ref(1);
const PAGE_SIZE = 20;

// Opzioni distinte dal catalogo per i filtri combobox
const cap = (v) => v[0].toUpperCase() + v.slice(1);
const LEVEL_RANK = { principiante: 0, intermedio: 1, avanzato: 2 };
const distinctOptions = (key, sorter) =>
  [...new Set(exercises.value.map((e) => e[key]).filter(Boolean))]
    .sort(sorter)
    .map((v) => ({ value: v, label: cap(v) }));

const groupFilterOptions = computed(() => distinctOptions('muscle_group', (a, b) => a.localeCompare(b, 'it')));
const equipmentFilterOptions = computed(() => distinctOptions('equipment', (a, b) => a.localeCompare(b, 'it')));
const levelFilterOptions = computed(() => distinctOptions('level', (a, b) => (LEVEL_RANK[a] ?? 9) - (LEVEL_RANK[b] ?? 9)));
const mechanicFilterOptions = computed(() => distinctOptions('mechanic', (a, b) => a.localeCompare(b, 'it')));

function toggleSort(key) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
  } else {
    sortKey.value = key;
    sortDir.value = 'asc';
  }
}

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return exercises.value.filter((ex) => {
    if (groupFilter.value && ex.muscle_group !== groupFilter.value) return false;
    if (equipmentFilter.value && ex.equipment !== equipmentFilter.value) return false;
    if (levelFilter.value && ex.level !== levelFilter.value) return false;
    if (mechanicFilter.value && ex.mechanic !== mechanicFilter.value) return false;
    if (!q) return true;
    return [ex.name, ex.muscle_group, ex.description, ex.equipment, ex.category,
      ...(ex.secondary_muscles || [])]
      .filter(Boolean)
      .some((v) => v.toLowerCase().includes(q));
  });
});

const sorted = computed(() =>
  // copia: sort muta l'array
  [...filtered.value].sort((a, b) => {
    const va = (a[sortKey.value] ?? '').toString().toLowerCase();
    const vb = (b[sortKey.value] ?? '').toString().toLowerCase();
    // le righe senza valore restano in fondo a prescindere dalla direzione
    if (!va && vb) return 1;
    if (va && !vb) return -1;
    const cmp = va.localeCompare(vb, 'it');
    return sortDir.value === 'asc' ? cmp : -cmp;
  })
);

const pageCount = computed(() => Math.max(1, Math.ceil(sorted.value.length / PAGE_SIZE)));
const paged = computed(() => sorted.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));
const rangeFrom = computed(() => (sorted.value.length ? (page.value - 1) * PAGE_SIZE + 1 : 0));
const rangeTo = computed(() => Math.min(page.value * PAGE_SIZE, sorted.value.length));

// Filtro/ordinamento cambiano l'insieme: torna alla prima pagina
watch([search, groupFilter, equipmentFilter, levelFilter, mechanicFilter, sortKey, sortDir], () => { page.value = 1; });
// Dopo un'eliminazione la pagina corrente può non esistere più
watch(pageCount, (n) => { if (page.value > n) page.value = n; });

function sortIcon(key) {
  if (sortKey.value !== key) return '↕';
  return sortDir.value === 'asc' ? '↑' : '↓';
}

onMounted(load);
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-lg font-bold text-gray-900">Esercizi</h1>
    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{{ error }}</p>

    <!-- Toolbar: ricerca + filtro gruppo + nuovo -->
    <div class="flex gap-2">
      <input
        v-model="search" type="search" placeholder="Cerca…"
        class="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
      />
      <button
        class="shrink-0 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white active:scale-95"
        @click="formOpen && !editingId ? closeForm() : openCreate()"
      >
        + Nuovo
      </button>
    </div>
    <!-- Filtri -->
    <div class="grid grid-cols-2 gap-2">
      <Combobox v-model="groupFilter" :options="groupFilterOptions" dense placeholder="Tutti i gruppi" empty-text="Nessun gruppo" />
      <Combobox v-model="equipmentFilter" :options="equipmentFilterOptions" dense placeholder="Tutte le attrezzature" empty-text="Nessuna attrezzatura" />
      <Combobox v-model="levelFilter" :options="levelFilterOptions" dense placeholder="Tutti i livelli" empty-text="Nessun livello" />
      <Combobox v-model="mechanicFilter" :options="mechanicFilterOptions" dense placeholder="Tutte le meccaniche" empty-text="Nessuna meccanica" />
    </div>

    <!-- Form nuovo / modifica esercizio -->
    <Modal
      :open="formOpen"
      :title="editingId ? 'Modifica esercizio' : 'Nuovo esercizio'"
      @close="closeForm"
    >
      <form class="space-y-3" @submit.prevent="save">
        <div>
          <label class="mb-1 block text-xs font-medium text-gray-500">Nome esercizio</label>
          <input
            v-model="form.name" required placeholder="Es. Panca piana"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
          />
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-gray-500">Gruppo muscolare</label>
          <input
            v-model="form.muscle_group" placeholder="Muscolo primario (opzionale)"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
          />
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-gray-500">Descrizione</label>
          <textarea
            v-model="form.description" rows="3"
            placeholder="Esecuzione / tecnica (opzionale)"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
          ></textarea>
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-gray-500">Cosa si registra per serie</label>
          <Combobox
            v-model="form.load_type"
            :options="loadTypeOptions"
            :clearable="false"
            dense
          />
        </div>
        <label class="flex items-center gap-2 text-sm text-gray-700">
          <input
            v-model="form.has_incline" type="checkbox"
            class="h-4 w-4 rounded border-gray-300 text-brand focus:ring-brand"
          />
          Registra anche la pendenza (%) — es. tapis roulant
        </label>
        <div>
          <label class="mb-1 block text-xs font-medium text-gray-500">Video esecuzione</label>
          <input
            v-model="form.video_url" type="url" placeholder="URL (opzionale, es. YouTube)"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
          />
        </div>

        <!-- Metadati aggiuntivi -->
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="mb-1 block text-xs font-medium text-gray-500">Attrezzatura</label>
            <input
              v-model="form.equipment" placeholder="Es. Bilanciere"
              class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
            />
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-gray-500">Categoria</label>
            <input
              v-model="form.category" placeholder="Es. forza"
              class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
            />
          </div>
        </div>
        <div class="grid grid-cols-3 gap-3">
          <div>
            <label class="mb-1 block text-xs font-medium text-gray-500">Livello</label>
            <Combobox v-model="form.level" :options="levelOptions" dense placeholder="—" empty-text="—" />
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-gray-500">Meccanica</label>
            <Combobox v-model="form.mechanic" :options="mechanicOptions" dense placeholder="—" empty-text="—" />
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-gray-500">Sforzo</label>
            <Combobox v-model="form.force" :options="forceOptions" dense placeholder="—" empty-text="—" />
          </div>
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-gray-500">Muscoli secondari</label>
          <input
            v-model="form.secondary_muscles"
            placeholder="Separati da virgola (opzionale)"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
          />
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-gray-500">Istruzioni</label>
          <textarea
            v-model="form.instructions" rows="4"
            placeholder="Un passo per riga (opzionale)"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
          ></textarea>
        </div>

        <div>
          <label class="mb-1 block text-xs font-medium text-gray-500">Immagini</label>
          <p class="mb-2 text-[11px] text-gray-400">
            La prima è la copertina. Usa le frecce per riordinare, la ✕ per eliminare.
          </p>
          <div class="flex flex-wrap gap-2">
            <div
              v-for="(img, i) in imageItems" :key="img.key"
              class="relative h-20 w-20 overflow-hidden rounded-lg bg-gray-100"
            >
              <img :src="img.url" class="h-full w-full object-cover" alt="" />
              <span
                v-if="i === 0"
                class="absolute left-0 top-0 rounded-br bg-brand px-1 py-0.5 text-[9px] font-semibold text-white"
              >
                Copertina
              </span>
              <button
                type="button" aria-label="Elimina immagine"
                class="absolute right-0.5 top-0.5 rounded-full bg-black/50 p-0.5 text-white active:scale-90"
                @click="removeImage(i)"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
                     stroke-linecap="round" class="h-3 w-3"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
              <div class="absolute inset-x-0 bottom-0 flex justify-between bg-black/40 text-white">
                <button
                  type="button" aria-label="Sposta indietro" :disabled="i === 0"
                  class="px-1.5 text-sm font-bold leading-5 disabled:opacity-30"
                  @click="moveImage(i, -1)"
                >‹</button>
                <button
                  type="button" aria-label="Sposta avanti" :disabled="i === imageItems.length - 1"
                  class="px-1.5 text-sm font-bold leading-5 disabled:opacity-30"
                  @click="moveImage(i, 1)"
                >›</button>
              </div>
            </div>
            <label
              class="flex h-20 w-20 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 text-gray-400"
            >
              <span class="text-2xl leading-none">+</span>
              <span class="text-[10px]">Aggiungi</span>
              <input type="file" accept="image/*" multiple class="hidden" @change="addImageFiles" />
            </label>
          </div>
        </div>

        <div class="flex gap-2">
          <button
            type="button"
            class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-600"
            @click="closeForm"
          >
            Annulla
          </button>
          <button
            type="submit" :disabled="saving"
            class="flex-1 rounded-lg bg-brand py-2 text-sm font-semibold text-white active:scale-95 disabled:opacity-60"
          >
            {{ saving ? 'Salvataggio…' : editingId ? 'Salva modifiche' : 'Aggiungi al catalogo' }}
          </button>
        </div>
      </form>
    </Modal>

    <!-- Tabella catalogo -->
    <section>
      <p v-if="loading" class="text-sm text-gray-400">Caricamento…</p>
      <p v-else-if="!exercises.length" class="rounded-xl bg-white p-4 text-sm text-gray-400 shadow-sm">
        Nessun esercizio. Aggiungine uno.
      </p>
      <p v-else-if="!sorted.length" class="rounded-xl bg-white p-4 text-sm text-gray-400 shadow-sm">
        Nessun risultato per “{{ search }}”.
      </p>

      <div v-else class="rounded-2xl bg-white shadow-sm">
        <table class="w-full table-fixed text-left text-sm">
          <thead class="border-b border-gray-100 text-xs uppercase text-gray-400">
            <tr>
              <th class="w-16 px-3 py-2">Foto</th>
              <th class="px-3 py-2">
                <button class="font-semibold uppercase" @click="toggleSort('name')">
                  Nome <span class="text-gray-300">{{ sortIcon('name') }}</span>
                </button>
              </th>
              <th class="px-3 py-2">
                <button class="font-semibold uppercase" @click="toggleSort('muscle_group')">
                  Gruppo <span class="text-gray-300">{{ sortIcon('muscle_group') }}</span>
                </button>
              </th>
              <th class="w-24 px-3 py-2 text-right">Azioni</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="ex in paged" :key="ex.id">
              <tr class="align-middle" :class="!(ex.equipment || ex.level || ex.mechanic) && 'border-b border-gray-50'">
                <td class="px-3 pt-2" :class="(ex.equipment || ex.level || ex.mechanic) ? 'pb-1' : 'pb-2'">
                  <img
                    v-if="ex.image_path" :src="exerciseImageUrl(ex.image_path)" :alt="ex.name"
                    class="h-12 w-12 rounded-lg object-cover"
                  />
                  <div v-else class="flex h-12 w-12 items-center justify-center rounded-lg bg-gray-100 text-xl">🏋️</div>
                </td>
                <td class="px-3 pt-2 font-medium text-gray-900" :class="(ex.equipment || ex.level || ex.mechanic) ? 'pb-1' : 'pb-2'">{{ ex.name }}</td>
                <td class="px-3 pt-2 text-gray-500" :class="(ex.equipment || ex.level || ex.mechanic) ? 'pb-1' : 'pb-2'">{{ ex.muscle_group || '—' }}</td>
                <td class="whitespace-nowrap px-3 pt-2" :class="(ex.equipment || ex.level || ex.mechanic) ? 'pb-1' : 'pb-2'">
                  <div class="flex justify-end gap-1">
                    <button
                      class="rounded-lg p-2 text-brand active:scale-90"
                      title="Modifica" aria-label="Modifica" @click="openEdit(ex)"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                           stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5">
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                      </svg>
                    </button>
                    <button
                      class="rounded-lg p-2 text-rose-600 active:scale-90"
                      title="Elimina" aria-label="Elimina" @click="remove(ex)"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                           stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5">
                        <path d="M3 6h18" />
                        <path d="M8 6V4h8v2" />
                        <path d="M6 6l1 14h10l1-14" />
                        <path d="M10 11v6M14 11v6" />
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
              <!-- Seconda riga: chip su tutta la larghezza -->
              <tr v-if="ex.equipment || ex.level || ex.mechanic" class="border-b border-gray-50">
                <td></td>
                <td colspan="3" class="px-3 pb-2 pt-0">
                  <div class="flex flex-wrap gap-1">
                    <span v-if="ex.equipment" class="inline-flex items-center gap-0.5 rounded bg-gray-100 px-1 py-px text-[9px] font-medium text-gray-500">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-2.5 w-2.5"><path d="M6.5 6.5l11 11M4 7l3-3 3 3-3 3zM14 17l3-3 3 3-3 3zM3 12h2M19 12h2" /></svg>
                      {{ ex.equipment }}
                    </span>
                    <span v-if="ex.level" class="inline-flex items-center gap-0.5 rounded bg-gray-100 px-1 py-px text-[9px] font-medium capitalize text-gray-500">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="h-2.5 w-2.5"><path d="M5 19v-4M12 19v-9M19 19v-14" /></svg>
                      {{ ex.level }}
                    </span>
                    <span v-if="ex.mechanic" class="inline-flex items-center gap-0.5 rounded bg-gray-100 px-1 py-px text-[9px] font-medium capitalize text-gray-500">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-2.5 w-2.5"><path d="M9 15l6-6M11 6l1-1a3 3 0 1 1 4 4l-1 1M13 18l-1 1a3 3 0 1 1-4-4l1-1" /></svg>
                      {{ ex.mechanic }}
                    </span>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <!-- Paginazione -->
      <div v-if="sorted.length" class="mt-3 flex items-center justify-between text-xs text-gray-500">
        <span>{{ rangeFrom }}–{{ rangeTo }} di {{ sorted.length }}</span>
        <div class="flex items-center gap-2">
          <button
            :disabled="page === 1"
            class="rounded-lg border border-gray-300 px-3 py-1 font-semibold disabled:opacity-40"
            @click="page--"
          >
            ‹
          </button>
          <span>{{ page }} / {{ pageCount }}</span>
          <button
            :disabled="page === pageCount"
            class="rounded-lg border border-gray-300 px-3 py-1 font-semibold disabled:opacity-40"
            @click="page++"
          >
            ›
          </button>
        </div>
      </div>
    </section>
  </div>
</template>
