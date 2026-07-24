<script setup>
// Catalogo esercizi (trainer/admin): tabella ordinabile/paginata con ricerca,
// più form unico per creazione e modifica.
// La descrizione non è una colonna (starebbe stretta su mobile) ma resta
// filtrabile dalla ricerca e visibile/modificabile nel form.
// L'immagine è condivisa: rappresenta il tipo di esercizio.
import { ref, computed, watch, onMounted } from 'vue';
import { api } from '@/lib/api';
import { exerciseImageUrl, uploadExerciseImage } from '@/lib/storage';

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
});
const form = ref(emptyForm());
const editingId = ref(null);       // null = creazione
const formOpen = ref(false);
const file = ref(null);            // nuova immagine scelta
const preview = ref(null);         // anteprima locale
const currentImage = ref(null);    // image_path già salvato (in modifica)

function onFile(e) {
  file.value = e.target.files[0] || null;
  preview.value = file.value ? URL.createObjectURL(file.value) : null;
}

function openCreate() {
  editingId.value = null;
  form.value = emptyForm();
  file.value = null;
  preview.value = null;
  currentImage.value = null;
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
  };
  file.value = null;
  preview.value = null;
  currentImage.value = ex.image_path || null;
  formOpen.value = true;
}

function closeForm() {
  formOpen.value = false;
  editingId.value = null;
  file.value = null;
  preview.value = null;
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
    // 1. Carica l'eventuale nuova immagine su Storage e ottieni il path
    let image_path = null;
    if (file.value) image_path = await uploadExerciseImage(file.value);

    if (editingId.value) {
      // In modifica: i campi opzionali vuoti diventano null (svuotamento esplicito)
      await api.patch(`/api/exercises/${editingId.value}`, {
        name: form.value.name,
        muscle_group: form.value.muscle_group || null,
        description: form.value.description || null,
        load_type: form.value.load_type,
        has_incline: form.value.has_incline,
        video_url: form.value.video_url || null,
        ...(image_path ? { image_path } : {}),
      });
    } else {
      await api.post('/api/exercises', {
        name: form.value.name,
        muscle_group: form.value.muscle_group || undefined,
        description: form.value.description || undefined,
        load_type: form.value.load_type,
        has_incline: form.value.has_incline,
        video_url: form.value.video_url || undefined,
        image_path: image_path || undefined,
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
const sortKey = ref('name');
const sortDir = ref('asc');
const page = ref(1);
const PAGE_SIZE = 10;

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
  if (!q) return exercises.value;
  return exercises.value.filter((ex) =>
    [ex.name, ex.muscle_group, ex.description]
      .filter(Boolean)
      .some((v) => v.toLowerCase().includes(q))
  );
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
watch([search, sortKey, sortDir], () => { page.value = 1; });
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
    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{{ error }}</p>

    <!-- Toolbar: ricerca + nuovo -->
    <div class="flex gap-2">
      <input
        v-model="search" type="search" placeholder="Cerca nome, gruppo, descrizione…"
        class="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
      />
      <button
        class="shrink-0 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white active:scale-95"
        @click="formOpen && !editingId ? closeForm() : openCreate()"
      >
        + Nuovo
      </button>
    </div>

    <!-- Form nuovo / modifica esercizio -->
    <section v-if="formOpen" class="rounded-2xl bg-white p-4 shadow-sm">
      <h2 class="mb-3 font-semibold text-gray-900">
        {{ editingId ? 'Modifica esercizio' : 'Nuovo esercizio' }}
      </h2>
      <form class="space-y-3" @submit.prevent="save">
        <input
          v-model="form.name" required placeholder="Nome esercizio"
          class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
        />
        <input
          v-model="form.muscle_group" placeholder="Gruppo muscolare (opzionale)"
          class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
        />
        <textarea
          v-model="form.description" rows="3"
          placeholder="Descrizione esecuzione / tecnica (opzionale)"
          class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
        ></textarea>
        <div>
          <label class="mb-1 block text-xs font-medium text-gray-500">Cosa si registra per serie</label>
          <select
            v-model="form.load_type"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
          >
            <option value="weight">Peso (kg) — es. panca, squat</option>
            <option value="level">Livello di difficoltà — es. tapis roulant</option>
          </select>
        </div>
        <label class="flex items-center gap-2 text-sm text-gray-700">
          <input
            v-model="form.has_incline" type="checkbox"
            class="h-4 w-4 rounded border-gray-300 text-brand focus:ring-brand"
          />
          Registra anche la pendenza (%) — es. tapis roulant
        </label>
        <input
          v-model="form.video_url" type="url" placeholder="URL video esecuzione (opzionale, es. YouTube)"
          class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
        />

        <div class="flex items-center gap-3">
          <label class="cursor-pointer rounded-lg border border-dashed border-gray-300 px-4 py-2 text-sm text-gray-500">
            📎 Immagine
            <input type="file" accept="image/*" class="hidden" @change="onFile" />
          </label>
          <img v-if="preview" :src="preview" class="h-14 w-14 rounded-lg object-cover" />
          <img
            v-else-if="currentImage" :src="exerciseImageUrl(currentImage)"
            class="h-14 w-14 rounded-lg object-cover" alt=""
          />
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
    </section>

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
          <tbody class="divide-y divide-gray-50">
            <tr v-for="ex in paged" :key="ex.id" class="align-middle">
              <td class="px-3 py-2">
                <img
                  v-if="ex.image_path" :src="exerciseImageUrl(ex.image_path)" :alt="ex.name"
                  class="h-12 w-12 rounded-lg object-cover"
                />
                <div v-else class="flex h-12 w-12 items-center justify-center rounded-lg bg-gray-100 text-xl">🏋️</div>
              </td>
              <td class="px-3 py-2 font-medium text-gray-900">{{ ex.name }}</td>
              <td class="px-3 py-2 text-gray-500">{{ ex.muscle_group || '—' }}</td>
              <td class="whitespace-nowrap px-3 py-2">
                <div class="flex justify-end gap-1">
                <button
                  class="rounded-lg p-2 text-brand active:scale-90"
                  title="Modifica" aria-label="Modifica" @click="openEdit(ex)"
                >
                  <!-- matita -->
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
                  <!-- cestino -->
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
