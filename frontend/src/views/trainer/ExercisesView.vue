<script setup>
// Catalogo esercizi (trainer/admin): elenco + creazione con upload immagine.
// L'immagine è condivisa: rappresenta il tipo di esercizio.
import { ref, onMounted } from 'vue';
import { api } from '@/lib/api';
import { exerciseImageUrl, uploadExerciseImage } from '@/lib/storage';

const exercises = ref([]);
const loading = ref(true);
const saving = ref(false);
const error = ref('');

const form = ref({ name: '', muscle_group: '', description: '', load_type: 'weight', video_url: '' });
const file = ref(null);
const preview = ref(null);

function onFile(e) {
  file.value = e.target.files[0] || null;
  preview.value = file.value ? URL.createObjectURL(file.value) : null;
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

async function create() {
  error.value = '';
  saving.value = true;
  try {
    // 1. Carica l'immagine su Storage (se presente) e ottieni il path
    let image_path = null;
    if (file.value) image_path = await uploadExerciseImage(file.value);

    // 2. Crea la voce di catalogo via backend
    await api.post('/api/exercises', {
      name: form.value.name,
      muscle_group: form.value.muscle_group || undefined,
      description: form.value.description || undefined,
      load_type: form.value.load_type,
      video_url: form.value.video_url || undefined,
      image_path: image_path || undefined,
    });

    // reset form
    form.value = { name: '', muscle_group: '', description: '', load_type: 'weight', video_url: '' };
    file.value = null;
    preview.value = null;
    await load();
  } catch (e) {
    error.value = e.message;
  } finally {
    saving.value = false;
  }
}

async function remove(id) {
  if (!confirm('Eliminare questo esercizio dal catalogo?')) return;
  try {
    await api.del(`/api/exercises/${id}`);
    await load();
  } catch (e) {
    error.value = e.message;
  }
}

onMounted(load);
</script>

<template>
  <div class="space-y-5">
    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{{ error }}</p>

    <!-- Form nuovo esercizio -->
    <section class="rounded-2xl bg-white p-4 shadow-sm">
      <h2 class="mb-3 font-semibold text-gray-900">Nuovo esercizio</h2>
      <form class="space-y-3" @submit.prevent="create">
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
        </div>

        <button
          type="submit" :disabled="saving"
          class="w-full rounded-lg bg-brand py-2 text-sm font-semibold text-white active:scale-95 disabled:opacity-60"
        >
          {{ saving ? 'Salvataggio…' : 'Aggiungi al catalogo' }}
        </button>
      </form>
    </section>

    <!-- Lista catalogo -->
    <section>
      <h2 class="mb-2 font-semibold text-gray-900">Catalogo</h2>
      <p v-if="loading" class="text-sm text-gray-400">Caricamento…</p>
      <p v-else-if="!exercises.length" class="rounded-xl bg-white p-4 text-sm text-gray-400 shadow-sm">
        Nessun esercizio. Aggiungine uno.
      </p>
      <ul v-else class="grid grid-cols-2 gap-3">
        <li v-for="ex in exercises" :key="ex.id" class="overflow-hidden rounded-2xl bg-white shadow-sm">
          <div class="aspect-video bg-gray-100">
            <img
              v-if="ex.image_path"
              :src="exerciseImageUrl(ex.image_path)"
              :alt="ex.name"
              class="h-full w-full object-cover"
            />
            <div v-else class="flex h-full items-center justify-center text-3xl">🏋️</div>
          </div>
          <div class="p-3">
            <p class="font-medium text-gray-900">{{ ex.name }}</p>
            <p v-if="ex.muscle_group" class="text-xs text-gray-400">{{ ex.muscle_group }}</p>
            <p v-if="ex.description" class="mt-1 line-clamp-3 text-xs text-gray-500">
              {{ ex.description }}
            </p>
            <button
              class="mt-2 text-xs font-semibold text-rose-600"
              @click="remove(ex.id)"
            >
              Elimina
            </button>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>
