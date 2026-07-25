<script setup>
// Rendering condiviso di una scheda (giornate + esercizi), identico tra la
// dashboard del member e la modale dei modelli, così la visualizzazione è
// uniforme ovunque. Riceve le giornate (days_json) e il catalogo per id.
import { exerciseImageUrl } from '@/lib/storage';

defineProps({
  days: { type: Array, default: () => [] },
  catalogById: { type: Object, default: () => ({}) },
  title: { type: String, default: '' },
  notes: { type: String, default: '' },
});

function formatRest(seconds) {
  if (seconds == null) return '';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m ? m + "'" : ''}${s ? s + '"' : m ? '' : '0"'}`;
}
</script>

<template>
  <div class="space-y-4">
    <p v-if="title" class="font-semibold text-brand">{{ title }}</p>

    <!-- Giornate -->
    <div v-for="(day, di) in days" :key="di" class="space-y-2">
      <p class="text-sm font-semibold uppercase tracking-wide text-gray-500">
        {{ day.name || 'Giornata ' + (di + 1) }}
      </p>

      <div
        v-for="(ex, i) in day.exercises"
        :key="i"
        class="flex gap-3 rounded-xl bg-white p-3 shadow-sm"
      >
        <!-- Immagine esplicativa (condivisa per tipo) -->
        <div class="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-gray-100">
          <img
            v-if="catalogById[ex.exercise_id]?.image_path"
            :src="exerciseImageUrl(catalogById[ex.exercise_id].image_path)"
            :alt="catalogById[ex.exercise_id]?.name"
            class="h-full w-full object-cover"
          />
          <div v-else class="flex h-full items-center justify-center text-2xl">🏋️</div>
        </div>

        <div class="min-w-0 flex-1">
          <p class="font-medium text-gray-900">
            {{ catalogById[ex.exercise_id]?.name || 'Esercizio' }}
          </p>
          <p v-if="catalogById[ex.exercise_id]?.muscle_group" class="text-xs font-semibold text-brand">
            {{ catalogById[ex.exercise_id].muscle_group }}
          </p>
          <div v-if="catalogById[ex.exercise_id]" class="mt-0.5 flex flex-wrap gap-1">
            <span
              v-if="catalogById[ex.exercise_id].equipment"
              class="inline-flex items-center gap-0.5 rounded bg-gray-100 px-1 py-px text-[9px] font-medium text-gray-500"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-2.5 w-2.5"><path d="M6.5 6.5l11 11M4 7l3-3 3 3-3 3zM14 17l3-3 3 3-3 3zM3 12h2M19 12h2" /></svg>
              {{ catalogById[ex.exercise_id].equipment }}
            </span>
            <span
              v-if="catalogById[ex.exercise_id].level"
              class="inline-flex items-center gap-0.5 rounded bg-gray-100 px-1 py-px text-[9px] font-medium capitalize text-gray-500"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="h-2.5 w-2.5"><path d="M5 19v-4M12 19v-9M19 19v-14" /></svg>
              {{ catalogById[ex.exercise_id].level }}
            </span>
            <span
              v-if="catalogById[ex.exercise_id].mechanic"
              class="inline-flex items-center gap-0.5 rounded bg-gray-100 px-1 py-px text-[9px] font-medium capitalize text-gray-500"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-2.5 w-2.5"><path d="M9 15l6-6M11 6l1-1a3 3 0 1 1 4 4l-1 1M13 18l-1 1a3 3 0 1 1-4-4l1-1" /></svg>
              {{ catalogById[ex.exercise_id].mechanic }}
            </span>
          </div>
          <p
            v-if="catalogById[ex.exercise_id]?.secondary_muscles?.length"
            class="mt-0.5 text-[11px] text-gray-400"
          >
            Anche: {{ catalogById[ex.exercise_id].secondary_muscles.join(', ') }}
          </p>
          <p class="text-sm text-gray-500">
            <template v-if="catalogById[ex.exercise_id]?.load_type === 'level'">
              {{ ex.sets > 1 ? ex.sets + '×' : '' }}{{ ex.reps }} min · rec. {{ formatRest(ex.rest_seconds) }}
            </template>
            <template v-else>
              {{ ex.sets }} serie × {{ ex.reps }} ripetizioni · rec. {{ formatRest(ex.rest_seconds) }}
            </template>
          </p>
          <p v-if="catalogById[ex.exercise_id]?.description" class="mt-1 line-clamp-2 text-xs text-gray-400">
            {{ catalogById[ex.exercise_id].description }}
          </p>
          <a
            v-if="catalogById[ex.exercise_id]?.video_url"
            :href="catalogById[ex.exercise_id].video_url"
            target="_blank" rel="noopener"
            class="mt-1 inline-block text-xs font-semibold text-brand"
          >
            ▶ Guarda il video
          </a>
        </div>
      </div>
    </div>

    <p v-if="notes" class="px-1 text-sm italic text-gray-500">{{ notes }}</p>
  </div>
</template>
