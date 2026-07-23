<script setup>
// Trainer: gestione SCHEDE come entità.
// Flusso: seleziona cliente -> lista delle sue schede -> crea/modifica una
// scheda con TITOLO e GIORNATE; ogni giornata ha i suoi esercizi (dal catalogo)
// con serie/ripetizioni/recupero.
import { ref, onMounted, computed } from 'vue';
import { api } from '@/lib/api';
import { exerciseImageUrl } from '@/lib/storage';

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
    exercises: (d.exercises || []).map((e) => ({
      exercise_id: e.exercise_id || '',
      sets: e.sets ?? 3,
      reps: e.reps ?? 10,
      rest_seconds: e.rest_seconds ?? 90,
    })),
  }));
  message.value = '';
  editing.value = true;
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
  days.value[dayIdx].exercises.push({ exercise_id: '', sets: 3, reps: 10, rest_seconds: 90 });
}
function removeExercise(dayIdx, exIdx) {
  days.value[dayIdx].exercises.splice(exIdx, 1);
}

async function save() {
  saving.value = true;
  message.value = '';
  error.value = '';
  try {
    const payload = {
      title: title.value,
      notes: notes.value,
      days_json: days.value.map((d) => ({
        name: d.name,
        exercises: d.exercises.map((e) => ({
          exercise_id: e.exercise_id,
          sets: Number(e.sets),
          reps: Number(e.reps),
          rest_seconds: Number(e.rest_seconds),
        })),
      })),
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
      <select
        v-model="selectedMemberId"
        class="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
        @change="loadSchede"
      >
        <option value="">— seleziona —</option>
        <option v-for="m in members" :key="m.id" :value="m.id">
          {{ m.full_name || 'Senza nome' }}
        </option>
      </select>
    </div>

    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{{ error }}</p>
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
        <ul v-else class="space-y-2">
          <li
            v-for="s in schede"
            :key="s.id"
            class="flex items-center justify-between rounded-xl bg-white p-4 shadow-sm"
          >
            <div>
              <p class="font-medium text-gray-900">{{ s.title || 'Senza titolo' }}</p>
              <p class="text-xs text-gray-400">
                {{ (s.days_json || []).length }} giornate
              </p>
            </div>
            <button class="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-700" @click="editScheda(s)">
              Apri
            </button>
          </li>
        </ul>
      </section>

      <!-- Editor scheda -->
      <section v-else class="space-y-4">
        <button class="text-sm text-brand" @click="editing = false">‹ Torna alle schede</button>

        <input
          v-model="title"
          placeholder="Titolo scheda (es. Ipertrofia - Fase 1)"
          class="w-full rounded-xl border border-gray-300 px-4 py-3 font-medium focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
        />

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
            <button class="shrink-0 rounded-lg bg-rose-50 px-2 py-1.5 text-xs font-semibold text-rose-600" @click="removeDay(di)">
              Rimuovi giorno
            </button>
          </div>

          <!-- Esercizi della giornata -->
          <div v-for="(ex, ei) in day.exercises" :key="ei" class="mb-2 flex gap-2 border-t border-gray-100 pt-2">
            <div class="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-gray-100">
              <img
                v-if="catalogById[ex.exercise_id]?.image_path"
                :src="exerciseImageUrl(catalogById[ex.exercise_id].image_path)"
                class="h-full w-full object-cover"
              />
              <div v-else class="flex h-full items-center justify-center text-lg">🏋️</div>
            </div>
            <div class="min-w-0 flex-1">
              <select
                v-model="ex.exercise_id"
                class="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
              >
                <option value="">— scegli esercizio —</option>
                <option v-for="c in catalog" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select>
              <div class="mt-1 grid grid-cols-3 gap-1">
                <input v-model.number="ex.sets" type="number" min="1" placeholder="serie"
                  class="w-full rounded border border-gray-300 px-1 py-1 text-center text-xs focus:border-brand focus:outline-none" />
                <input v-model.number="ex.reps" type="number" min="1"
                  :placeholder="catalogById[ex.exercise_id]?.load_type === 'level' ? 'min' : 'ripet.'"
                  class="w-full rounded border border-gray-300 px-1 py-1 text-center text-xs focus:border-brand focus:outline-none" />
                <input v-model.number="ex.rest_seconds" type="number" min="0" step="15" placeholder="rec.s"
                  class="w-full rounded border border-gray-300 px-1 py-1 text-center text-xs focus:border-brand focus:outline-none" />
              </div>
            </div>
            <button class="shrink-0 self-start text-rose-500" @click="removeExercise(di, ei)">✕</button>
          </div>

          <button
            class="mt-1 w-full rounded-lg border border-dashed border-gray-300 py-1.5 text-xs text-gray-500"
            @click="addExercise(di)"
          >
            + Aggiungi esercizio
          </button>
        </div>

        <button
          class="w-full rounded-lg border border-dashed border-gray-400 py-2 text-sm font-medium text-gray-600 active:scale-95"
          @click="addDay"
        >
          + Aggiungi giornata
        </button>

        <!-- Note -->
        <div>
          <label class="mb-1 block text-sm font-medium text-gray-700">Note</label>
          <textarea v-model="notes" rows="2"
            class="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"></textarea>
        </div>

        <p v-if="message" class="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-600">{{ message }}</p>

        <div class="flex gap-2">
          <button
            :disabled="saving"
            class="flex-1 rounded-xl bg-brand py-3 font-semibold text-white active:scale-95 disabled:opacity-60"
            @click="save"
          >
            {{ saving ? 'Salvataggio…' : 'Salva scheda' }}
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
  </div>
</template>
