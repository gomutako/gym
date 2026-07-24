<script setup>
// Combobox: input di ricerca + lista filtrata (sostituisce una <select> quando
// le opzioni sono tante). Opzioni: [{ value, label, sublabel?, image? }] — se
// `image` c'è (URL) la riga mostra la miniatura, `sublabel` è una seconda riga
// grigia (non entra nel campo chiuso). v-model = value scelto.
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';

const props = defineProps({
  modelValue: { type: [String, Number], default: '' },
  options: { type: Array, default: () => [] }, // [{ value, label }]
  placeholder: { type: String, default: 'Cerca…' },
  emptyText: { type: String, default: 'Nessun risultato' },
  dense: { type: Boolean, default: false }, // variante compatta (righe di form fitte)
  clearable: { type: Boolean, default: true }, // false = si può solo cambiare la scelta
  imageFallback: { type: String, default: '🏋️' }, // mostrato se l'opzione non ha immagine
});
const emit = defineEmits(['update:modelValue', 'change']);

const root = ref(null);
const input = ref(null);
const open = ref(false);
const query = ref('');       // testo digitato mentre la lista è aperta
const highlighted = ref(-1);

const selected = computed(() => props.options.find((o) => o.value === props.modelValue) || null);
const selectedLabel = computed(() => selected.value?.label || '');

// Se almeno un'opzione porta un'immagine, tutte le righe riservano lo spazio
// della miniatura (allineamento costante anche per quelle senza).
const withImages = computed(() => props.options.some((o) => 'image' in o));

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return props.options;
  return props.options.filter((o) => (o.label || '').toLowerCase().includes(q));
});

// Il campo mostra la selezione quando è chiuso, il testo digitato quando è aperto
const display = computed(() => (open.value ? query.value : selectedLabel.value));

function openList() {
  if (open.value) return;
  open.value = true;
  query.value = '';
  highlighted.value = filtered.value.findIndex((o) => o.value === props.modelValue);
}

function closeList() {
  open.value = false;
  query.value = '';
  highlighted.value = -1;
}

function onInput(e) {
  if (!open.value) open.value = true;
  query.value = e.target.value;
  highlighted.value = filtered.value.length ? 0 : -1;
}

function select(opt) {
  emit('update:modelValue', opt.value);
  emit('change', opt.value);
  closeList();
  input.value?.blur();
}

function clear() {
  emit('update:modelValue', '');
  emit('change', '');
  closeList();
}

function move(delta) {
  if (!open.value) return openList();
  const n = filtered.value.length;
  if (!n) return;
  highlighted.value = (highlighted.value + delta + n) % n;
}

function onEnter() {
  if (!open.value) return openList();
  const opt = filtered.value[highlighted.value];
  if (opt) select(opt);
}

function onClickOutside(e) {
  if (root.value && !root.value.contains(e.target)) closeList();
}

// Se le opzioni cambiano mentre si filtra, l'indice evidenziato può uscire dal range
watch(filtered, (list) => {
  if (highlighted.value >= list.length) highlighted.value = list.length ? 0 : -1;
});

onMounted(() => document.addEventListener('mousedown', onClickOutside));
onBeforeUnmount(() => document.removeEventListener('mousedown', onClickOutside));
</script>

<template>
  <div ref="root" class="relative">
    <div class="relative">
      <input
        ref="input"
        type="text"
        role="combobox"
        :aria-expanded="open"
        aria-autocomplete="list"
        :value="display"
        :placeholder="placeholder"
        class="w-full border border-gray-300 bg-white focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
        :class="[
          dense ? 'rounded-lg py-1.5 pl-2 text-sm' : 'rounded-xl py-3 pl-4',
          // spazio a destra: una o due icone
          clearable ? (dense ? 'pr-12' : 'pr-16') : (dense ? 'pr-8' : 'pr-10'),
        ]"
        @focus="openList"
        @input="onInput"
        @keydown.down.prevent="move(1)"
        @keydown.up.prevent="move(-1)"
        @keydown.enter.prevent="onEnter"
        @keydown.esc.prevent="closeList"
        @keydown.tab="closeList"
      />
      <div class="absolute inset-y-0 flex items-center gap-1" :class="dense ? 'right-1' : 'right-2'">
        <button
          v-if="clearable && modelValue"
          type="button" title="Svuota" aria-label="Svuota"
          class="rounded p-1 text-gray-400 active:scale-90"
          @click="clear"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" class="h-4 w-4"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        <button
          type="button" tabindex="-1" aria-label="Apri elenco"
          class="rounded p-1 text-gray-400"
          @click="open ? closeList() : input.focus()"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4"
               :class="open && 'rotate-180'"><path d="M6 9l6 6 6-6" /></svg>
        </button>
      </div>
    </div>

    <ul
      v-if="open"
      role="listbox"
      class="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-gray-200 bg-white py-1 shadow-lg"
    >
      <li v-if="!filtered.length" class="px-4 py-2 text-sm text-gray-400">{{ emptyText }}</li>
      <li
        v-for="(opt, i) in filtered"
        :key="opt.value"
        role="option"
        :aria-selected="opt.value === modelValue"
        class="flex cursor-pointer items-center gap-2 px-4 py-2 text-sm"
        :class="[
          i === highlighted ? 'bg-brand/10 text-brand' : 'text-gray-700',
          opt.value === modelValue && 'font-semibold',
        ]"
        @mouseenter="highlighted = i"
        @mousedown.prevent="select(opt)"
      >
        <template v-if="withImages">
          <img
            v-if="opt.image" :src="opt.image" :alt="''"
            class="h-9 w-9 shrink-0 rounded-lg bg-gray-100 object-cover"
          />
          <span
            v-else
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-base"
          >{{ imageFallback }}</span>
        </template>
        <span class="min-w-0 flex-1">
          <span class="block truncate">{{ opt.label }}</span>
          <span v-if="opt.sublabel" class="block truncate text-xs font-normal text-gray-400">{{ opt.sublabel }}</span>
        </span>
      </li>
    </ul>
  </div>
</template>
