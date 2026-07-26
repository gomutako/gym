<script setup>
// Crediti e versione, in fondo al profilo di ogni utente.
//
// Due categorie con obblighi diversi, tenute distinte di proposito:
// - free-exercise-db è di pubblico dominio (Unlicense): l'attribuzione è una
//   cortesia verso chi ha reso disponibile il catalogo, non un obbligo;
// - le librerie sono MIT, che invece richiede di riportare l'avviso di
//   copyright nelle distribuzioni del software.
//
// Collassato per non appesantire il profilo: chi cerca i crediti li apre.
import { ref } from 'vue';

const open = ref(false);

// Versione dal package.json, iniettata da Vite (vedi vite.config.js).
const version = __APP_VERSION__;

const libraries = [
  { name: 'Vue', url: 'https://vuejs.org' },
  { name: 'Vue Router', url: 'https://router.vuejs.org' },
  { name: 'Pinia', url: 'https://pinia.vuejs.org' },
  { name: 'Vite', url: 'https://vite.dev' },
  { name: 'Tailwind CSS', url: 'https://tailwindcss.com' },
  { name: 'Supabase JS', url: 'https://supabase.com' },
  { name: 'Capacitor', url: 'https://capacitorjs.com' },
];
</script>

<template>
  <section class="pb-2 pt-4 text-center">
    <button
      type="button"
      class="text-[11px] text-gray-400 active:scale-95"
      @click="open = !open"
    >
      Versione {{ version }} · Crediti {{ open ? '⌃' : '⌄' }}
    </button>

    <div v-if="open" class="mx-auto mt-3 max-w-xs space-y-3 text-left text-[11px] leading-relaxed text-gray-400">
      <div>
        <p class="font-semibold text-gray-500">Catalogo esercizi</p>
        <p>
          Dati e immagini da
          <a
            href="https://github.com/yuhonas/free-exercise-db"
            target="_blank" rel="noopener"
            class="text-brand underline"
          >free-exercise-db</a>
          di yuhonas, rilasciato in pubblico dominio (Unlicense). I nomi degli esercizi
          sono quelli originali in inglese; le descrizioni sono tradotte in italiano.
        </p>
      </div>

      <div>
        <p class="font-semibold text-gray-500">Software libero</p>
        <p>
          Questa app è costruita con
          <template v-for="(lib, i) in libraries" :key="lib.name"><a
            :href="lib.url"
            target="_blank" rel="noopener"
            class="text-brand underline"
          >{{ lib.name }}</a><span v-if="i < libraries.length - 2">, </span><span v-else-if="i === libraries.length - 2"> e </span></template>,
          tutti distribuiti con licenza MIT. Il testo delle licenze e l'avviso di
          copyright dei rispettivi autori sono inclusi nei pacchetti da cui l'app
          è compilata.
        </p>
      </div>

      <div>
        <p class="font-semibold text-gray-500">Salute</p>
        <p>
          Su iPhone i dati di frequenza cardiaca e calorie sono letti da Apple Health
          con il tuo consenso, restano sul dispositivo e vengono salvati solo come
          riepilogo dell'allenamento.
        </p>
      </div>
    </div>
  </section>
</template>
