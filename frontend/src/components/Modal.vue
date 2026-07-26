<script setup>
// Pop-up modale riutilizzabile per la modifica/creazione delle entità.
// Uniforma il comportamento in tutta l'app (prima alcuni form erano in pagina).
//   - chiusura: click sul backdrop, tasto Esc, pulsante ✕
//   - blocca lo scroll della pagina sottostante mentre è aperto
//   - stile allineato ai modali già esistenti (bg-white → tema scuro via style.css)
// Uso:
//   <Modal :open="formOpen" title="Modifica" @close="formOpen = false">
//     …contenuto del form…
//   </Modal>
import { ref, watch, onBeforeUnmount } from 'vue';

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
});
const emit = defineEmits(['close']);

function close() {
  emit('close');
}

function onKey(e) {
  if (e.key === 'Escape') close();
}

// L'overlay è `fixed`, quindi vive nel viewport di LAYOUT, che con la tastiera
// aperta non si accorcia: il foglio finiva sotto la tastiera e iOS rimediava
// scrollando tutto verso l'alto — trascinandosi via anche le liste delle combobox.
// Ancorandolo al viewport VISIBILE il contenuto resta sempre nell'area libera e non
// c'è nulla da scrollare. Dove `visualViewport` non c'è, restano valide le classi
// `inset-0`.
const vv = typeof window !== 'undefined' ? window.visualViewport : null;
const viewportStyle = ref(null);

function syncViewport() {
  if (!vv) return;
  viewportStyle.value = {
    top: `${vv.offsetTop}px`,
    left: `${vv.offsetLeft}px`,
    width: `${vv.width}px`,
    height: `${vv.height}px`,
  };
}

function watchViewport(on) {
  if (!vv) return;
  const fn = on ? 'addEventListener' : 'removeEventListener';
  vv[fn]('resize', syncViewport);
  vv[fn]('scroll', syncViewport);
}

watch(
  () => props.open,
  (isOpen) => {
    if (typeof document === 'undefined') return;
    if (isOpen) {
      document.addEventListener('keydown', onKey);
      document.body.style.overflow = 'hidden';
      syncViewport();
      watchViewport(true);
    } else {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      watchViewport(false);
    }
  }
);

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey);
  document.body.style.overflow = '';
  watchViewport(false);
});
</script>

<template>
  <Transition
    enter-active-class="transition duration-150 ease-out"
    enter-from-class="opacity-0"
    enter-to-class="opacity-100"
    leave-active-class="transition duration-100 ease-in"
    leave-from-class="opacity-100"
    leave-to-class="opacity-0"
  >
    <div
      v-if="open"
      class="fixed inset-0 z-40 flex items-end justify-center bg-black/40 px-4 pt-4 pb-[calc(1rem+var(--native-tabbar-height,0px))] sm:items-center"
      :style="viewportStyle"
      role="dialog"
      aria-modal="true"
      @click.self="close"
    >
      <!-- Il pb del contenitore tiene conto della tab bar nativa iOS (0px sul web,
           dove non c'è): essendo un foglio ancorato in basso, senza quello finirebbe
           dietro la barra.
           L'altezza massima del foglio è quella dell'overlay — cioè del viewport
           visibile — e non 85vh: con la tastiera aperta i 85vh sfondano sotto di
           essa. -->
      <div class="max-h-full w-full max-w-sm overflow-y-auto rounded-2xl bg-white p-4 shadow-xl">
        <div class="mb-3 flex items-center justify-between gap-3">
          <h2 class="font-semibold text-gray-900">{{ title }}</h2>
          <button
            class="-mr-1 rounded p-1 text-gray-400 active:scale-90"
            aria-label="Chiudi"
            @click="close"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" class="h-5 w-5"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <slot />
      </div>
    </div>
  </Transition>
</template>
