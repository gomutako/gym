<script setup>
// Editor riutilizzabile delle GIORNATE di una scheda/modello: giornate con
// esercizi (dal catalogo) e serie/ripetizioni/recupero, riordinabili.
// v-model = array days_json (mutato in place). Usato da WorkoutsView (schede)
// e TemplatesView (modelli), così l'editor è identico ovunque.
import { onMounted, watch } from 'vue';
import { exerciseImageUrl } from '@/lib/storage';
import Combobox from '@/components/Combobox.vue';

const days = defineModel({ type: Array, default: () => [] });
const props = defineProps({
  catalogOptions: { type: Array, default: () => [] },
  catalogById: { type: Object, default: () => ({}) },
});

// `_uid` = :key stabile per far seguire le combobox alla riga durante il
// riordino (non viene salvato: normalizeDays lo rimuove).
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
// Assegna _uid alle righe caricate dall'esterno (che non ce l'hanno)
function ensureUids() {
  for (const d of days.value || []) {
    for (const ex of d.exercises || []) if (ex._uid == null) ex._uid = ++uid;
  }
}
onMounted(ensureUids);
watch(days, ensureUids);

function addDay() {
  const letter = String.fromCharCode(65 + days.value.length); // A, B, C…
  days.value.push({ name: `Giorno ${letter}`, exercises: [] });
}
function removeDay(i) {
  days.value.splice(i, 1);
}
function addExercise(di) {
  days.value[di].exercises.push(newRow());
}
function removeExercise(di, ei) {
  days.value[di].exercises.splice(ei, 1);
}
function moveExercise(di, ei, delta) {
  const list = days.value[di].exercises;
  const to = ei + delta;
  if (to < 0 || to >= list.length) return;
  const [item] = list.splice(ei, 1);
  list.splice(to, 0, item);
}
</script>

<template>
  <div class="space-y-4">
    <!-- Giornate -->
    <div v-for="(day, di) in days" :key="di" class="rounded-2xl bg-white p-3 shadow-sm">
      <label class="mb-1 block text-xs font-medium text-gray-500">Giornata {{ di + 1 }}</label>
      <div class="mb-2 flex items-center gap-2">
        <input
          v-model="day.name"
          placeholder="Nome giornata (es. Giorno A)"
          class="min-w-0 flex-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm font-semibold focus:border-brand focus:outline-none"
        />
        <button
          title="Rimuovi giornata" aria-label="Rimuovi giornata"
          class="shrink-0 rounded-lg bg-red-50 p-2 text-red-700 active:scale-90"
          @click="removeDay(di)"
        >
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
          <div class="mt-1 grid grid-cols-3 gap-1">
            <div class="relative" title="Serie">
              <span class="pointer-events-none absolute inset-y-0 left-1.5 flex items-center text-gray-400">
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
            class="rounded p-1 text-red-500 active:scale-90"
            @click="removeExercise(di, ei)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" class="h-4 w-4"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
      </div>

      <button
        class="mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand/10 py-2 text-xs font-semibold text-brand-700 active:scale-95"
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
  </div>
</template>
