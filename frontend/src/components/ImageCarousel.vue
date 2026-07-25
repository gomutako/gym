<script setup>
// Carousel di immagini per la scheda esercizio: mostra tutte le immagini della
// fonte (es. inizio/fine del movimento). Con una sola immagine si comporta come
// un <img> normale (nessun controllo). I path sono quelli del bucket Storage:
// vengono risolti in URL con exerciseImageUrl.
import { ref, computed, watch } from 'vue';
import { exerciseImageUrl } from '@/lib/storage';

const props = defineProps({
  paths: { type: Array, default: () => [] }, // path Storage, in ordine
  alt: { type: String, default: '' },
  fallback: { type: String, default: '🏋️' }, // mostrato se non c'è nessuna immagine
});

const urls = computed(() => (props.paths || []).filter(Boolean).map(exerciseImageUrl));
const index = ref(0);

// Se cambia l'esercizio (nuovo set di immagini) riparti dalla prima
watch(urls, () => { index.value = 0; });

const count = computed(() => urls.value.length);
function go(delta) {
  if (!count.value) return;
  index.value = (index.value + delta + count.value) % count.value;
}
</script>

<template>
  <div class="relative h-full w-full">
    <img
      v-if="count"
      :src="urls[index]"
      :alt="alt"
      class="h-full w-full object-cover"
    />
    <div v-else class="flex h-full items-center justify-center text-6xl">{{ fallback }}</div>

    <!-- Controlli solo con più di un'immagine -->
    <template v-if="count > 1">
      <button
        type="button" aria-label="Immagine precedente"
        class="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-1.5 text-white active:scale-90"
        @click="go(-1)"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
             stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4"><path d="M15 18l-6-6 6-6" /></svg>
      </button>
      <button
        type="button" aria-label="Immagine successiva"
        class="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-1.5 text-white active:scale-90"
        @click="go(1)"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
             stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4"><path d="M9 18l6-6-6-6" /></svg>
      </button>
      <div class="absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
        <button
          v-for="(u, i) in urls" :key="i"
          type="button" :aria-label="`Vai all'immagine ${i + 1}`"
          class="h-1.5 rounded-full transition-all"
          :class="i === index ? 'w-4 bg-white' : 'w-1.5 bg-white/50'"
          @click="index = i"
        />
      </div>
    </template>
  </div>
</template>
