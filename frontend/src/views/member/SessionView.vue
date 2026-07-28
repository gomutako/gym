<script setup>
// Member: allenamento in corso come CAROSELLO (una card esercizio alla volta).
// Ogni card ha le righe delle SERIE: reps effettuate + carico (kg o livello),
// precompilate dalla volta scorsa; ogni riga si segna come eseguita e fa
// partire un TIMER di recupero. A fine recupero la riga diventa gialla.
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { getSession, updateSession, deleteSession } from '@/lib/data/sessions';
import { listExercises } from '@/lib/data/exercises';
import ImageCarousel from '@/components/ImageCarousel.vue';
import * as healthkit from '@/lib/healthkit';
import * as restNotify from '@/lib/rest-notifications';

// Immagini di un esercizio del catalogo: tutte (image_paths) o la sola copertina
const exerciseImages = (ex) =>
  ex?.image_paths?.length ? ex.image_paths : ex?.image_path ? [ex.image_path] : [];

const route = useRoute();
const router = useRouter();

const session = ref(null);
const catalog = ref([]);
const loading = ref(true);
const error = ref('');
const completing = ref(false);

const hkSupported = healthkit.isSupported();
const liveHR = ref(null);         // bpm corrente
const liveKcal = ref(null);       // kcal attive accumulate (ultimo sample cumulativo)
const lastSampleAt = ref(null);   // per rilevare "in attesa Watch"
const hkError = ref('');          // perché i dati non arrivano (permesso, plugin, dispositivo)
const now = ref(Date.now());      // tick periodico per rendere reattivo hrStale
let hkUnsub = null;
let hkTickInterval = null;

const index = ref(0);
const direction = ref('next');

const catalogById = computed(() =>
  Object.fromEntries(catalog.value.map((e) => [e.id, e]))
);

const log = computed(() => session.value?.exercises_log || []);
const current = computed(() => log.value[index.value] || null);

// --- Descrizione dell'esecuzione: troncata, espandibile ---
// Durante l'allenamento servono a colpo d'occhio le serie da fare, non un muro di
// testo tra la durata e il video: le istruzioni del catalogo arrivano a una decina
// di passi. Si mostrano i primi COLLAPSED_STEPS (o poche righe di description) con
// un tasto per il resto.
const COLLAPSED_STEPS = 1;
const COLLAPSED_CHARS = 90;
const descExpanded = ref(false);

const exInfo = computed(() => catalogById.value[current.value?.exercise_id] || null);
const steps = computed(() => exInfo.value?.instructions || []);
const shownSteps = computed(() =>
  descExpanded.value ? steps.value : steps.value.slice(0, COLLAPSED_STEPS));
// Il tasto compare solo se c'è davvero altro da leggere, altrimenti è rumore.
const descTruncatable = computed(() =>
  steps.value.length
    ? steps.value.length > COLLAPSED_STEPS
    : (exInfo.value?.description || '').length > COLLAPSED_CHARS);

const saved = computed(() => session.value?.biometrics_json || null);
const badgeHR = computed(() => (hkSupported && !session.value?.completed_at) ? liveHR.value : saved.value?.hr_avg ?? null);
const badgeKcal = computed(() => {
  const v = (hkSupported && !session.value?.completed_at) ? liveKcal.value : saved.value?.active_kcal;
  return v == null ? null : Math.round(v);
});
// L'Apple Watch non scrive il battito nel HealthKit dell'iPhone in tempo reale: lo
// sincronizza a blocchi, ogni pochi minuti. Con una soglia di 30 secondi il badge
// risultava "in attesa" per quasi tutto l'allenamento, pur avendo dati validi.
const HK_STALE_MS = 5 * 60 * 1000;

const hrStale = computed(() =>
  hkSupported && !session.value?.completed_at &&
  (!lastSampleAt.value || now.value - lastSampleAt.value > HK_STALE_MS));

// Età dell'ultimo campione ricevuto, per non far sparire un valore ancora utile:
// null finché non arriva nulla, altrimenti "ora" / "N min".
const sampleAge = computed(() => {
  if (!lastSampleAt.value || !hkSupported || session.value?.completed_at) return null;
  const minutes = Math.floor((now.value - lastSampleAt.value) / 60000);
  return minutes < 1 ? 'ora' : `${minutes} min`;
});

function fmtDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('it-IT', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

// Un esercizio è "fatto" quando tutte le sue serie sono segnate
const isExerciseDone = (ex) =>
  (ex.sets_log?.length || 0) > 0 && ex.sets_log.every((r) => r.done);
const doneCount = computed(() => log.value.filter(isExerciseDone).length);
const allDone = computed(() => log.value.length > 0 && doneCount.value === log.value.length);

function unitLabel(loadType) {
  return loadType === 'level' ? 'liv.' : 'kg';
}
// Esercizi "a livello" (es. tapis roulant): le "reps" sono minuti di esecuzione
const isLevel = (ex) => ex?.load_type === 'level';
// Esercizi con pendenza (es. tapis roulant): serie con una colonna in più (%)
const hasIncline = (ex) => !!ex?.has_incline;
// Colonne griglia serie: +1 colonna (pendenza) quando l'esercizio la prevede
const gridCols = computed(() =>
  hasIncline(current.value)
    ? 'grid-cols-[1.5rem_1fr_1fr_1fr_auto_2rem]'
    : 'grid-cols-[1.5rem_1fr_1fr_auto_2rem]'
);
function fmtTimer(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
// Recupero in minuti: 90 -> "1,30 min"
function fmtRestMin(sec) {
  const m = Math.floor((sec || 0) / 60);
  const s = (sec || 0) % 60;
  return `${m},${String(s).padStart(2, '0')} min`;
}

// --- Navigazione carosello ---
function go(i) {
  if (i < 0 || i >= log.value.length) return;
  direction.value = i > index.value ? 'next' : 'prev';
  index.value = i;
  descExpanded.value = false; // ogni esercizio riparte con la descrizione corta
}
const next = () => go(index.value + 1);
const prev = () => go(index.value - 1);

let touchX = 0;
function onTouchStart(e) { touchX = e.changedTouches[0].screenX; }
function onTouchEnd(e) {
  const dx = e.changedTouches[0].screenX - touchX;
  if (Math.abs(dx) > 50) (dx < 0 ? next : prev)();
}

// --- Timer di recupero per riga ---
// Si conserva l'ISTANTE DI FINE, non i secondi rimanenti: in background iOS
// sospende la WebView e un contatore che scala da sé resterebbe indietro
// rispetto alla notifica già consegnata.
const restEndsAt = reactive({}); // key -> epoch ms di fine (0 = recupero chiuso)
const nowTick = ref(Date.now());
let tickInterval = null;
const keyOf = (exI, rowI) => `${exI}_${rowI}`;

function restRemaining(exI, rowI) {
  const end = restEndsAt[keyOf(exI, rowI)];
  if (end === undefined) return null;
  if (end === 0) return 0;
  return Math.max(0, Math.ceil((end - nowTick.value) / 1000));
}

function startRest(exI, rowI, seconds) {
  const k = keyOf(exI, rowI);
  if (!seconds || seconds <= 0) { restEndsAt[k] = 0; return; } // nessun recupero -> subito pronto
  restEndsAt[k] = Date.now() + seconds * 1000;
}
function clearRest(exI, rowI) {
  delete restEndsAt[keyOf(exI, rowI)];
}
// Chiude subito il recupero (equivale allo scadere): riga gialla
function endRest(exI, rowI) {
  restEndsAt[keyOf(exI, rowI)] = 0;
}
// Stato riga: 'resting' (timer in corso), 'over' (recupero finito), null (mai avviato)
function restState(exI, rowI) {
  const v = restRemaining(exI, rowI);
  if (v === null) return null;
  return v > 0 ? 'resting' : 'over';
}

onMounted(() => {
  // Un intervallo solo per la vista: aggiorna l'"adesso" da cui tutte le righe
  // ricavano il proprio rimanente.
  tickInterval = setInterval(() => { nowTick.value = Date.now(); }, 500);
  // Rientrando dal background il tick può essere stato sospeso: riallinea subito.
  document.addEventListener('visibilitychange', onVisible);
});

function onVisible() {
  if (!document.hidden) nowTick.value = Date.now();
}

onUnmounted(() => {
  if (tickInterval) clearInterval(tickInterval);
  document.removeEventListener('visibilitychange', onVisible);
  if (hkTickInterval) clearInterval(hkTickInterval);
  if (hkUnsub) hkUnsub();
  if (hkSupported) healthkit.stop();
});

// --- Persistenza (salva tutto il log esercizi) ---
async function persist() {
  error.value = '';
  try {
    await updateSession(session.value.id, {
      exercises_log: session.value.exercises_log,
    });
  } catch (e) {
    error.value = e.message;
  }
}

// Pulsante della serie, tre comportamenti in base allo stato:
//  - non eseguita        -> segna eseguita + avvia il recupero
//  - recupero in corso   -> chiude subito il recupero (riga gialla, pronta)
//  - eseguita & recupero finito -> annulla la serie
function onSetButton(exI, rowI) {
  const row = log.value[exI].sets_log[rowI];
  const state = restState(exI, rowI); // null | 'resting' | 'over'
  if (!row.done) {
    row.done = true;
    row.done_at = new Date().toISOString();
    startRest(exI, rowI, log.value[exI].rest_seconds);
    persist();

    // Notifica di fine recupero: il permesso si chiede qui, al primo "fatto"
    // con recupero, dove il motivo è evidente.
    const rest = log.value[exI].rest_seconds;
    if (rest > 0) {
      const ex = log.value[exI];
      // Il dialogo di sistema per il permesso può restare aperto per secoli
      // rispetto a un tap: se nel frattempo questa riga viene chiusa in anticipo
      // o annullata, restEndsAt cambia (nuovo istante o azzerato). Si ricontrolla
      // com'era AL MOMENTO di programmare, altrimenti un permesso concesso in
      // ritardo farebbe partire una notifica "fantasma" per un recupero non più
      // attivo.
      const restEndAtSchedule = restEndsAt[keyOf(exI, rowI)];
      restNotify.ensurePermission().then((ok) => {
        if (!ok || restEndsAt[keyOf(exI, rowI)] !== restEndAtSchedule) return;
        restNotify.schedule({
          seconds: rest,
          body: restNotify.restBody(
            catalogById.value[ex.exercise_id]?.name, rowI + 1, ex.sets_log.length),
          sessionId: session.value.id,
          exerciseIndex: exI,
        }).catch(() => { /* la notifica è un di più: non blocca l'allenamento */ });
      });
    }
  } else if (state === 'resting') {
    endRest(exI, rowI); // done resta true, già persistito
    restNotify.cancel().catch(() => {});
  } else {
    row.done = false;
    row.done_at = null;
    clearRest(exI, rowI);
    persist();
    restNotify.cancel().catch(() => {});
  }
}

function addSet(exI) {
  const ex = log.value[exI];
  const last = ex.sets_log[ex.sets_log.length - 1];
  ex.sets_log.push({
    reps: last?.reps ?? ex.target_reps ?? null,
    load: last?.load ?? null,
    ...(hasIncline(ex) ? { incline: last?.incline ?? null } : {}),
    done: false,
  });
  persist();
}

function removeSet(exI, rowI) {
  const ex = log.value[exI];
  ex.sets_log.splice(rowI, 1);
  // gli indici si spostano: azzera i timer di questo esercizio
  ex.sets_log.forEach((_, i) => clearRest(exI, i));
  persist();
}

async function complete() {
  completing.value = true;
  error.value = '';
  try {
    // Salva ANCHE lo stato corrente (pesi/reps eventualmente modificati e non
    // ancora persistiti), non solo il completamento: così il prefill della
    // prossima sessione ritrova i valori impostati.
    let biometrics_json;
    if (hkSupported) {
      try {
        await healthkit.stop();
        if (hkUnsub) { hkUnsub(); hkUnsub = null; }
        biometrics_json = await healthkit.summary(
          new Date(session.value.started_at).toISOString(),
          new Date().toISOString());
      } catch {
        // biometrici opzionali: non bloccare il completamento della sessione
      }
    }
    await updateSession(session.value.id, {
      exercises_log: session.value.exercises_log,
      completed_at: new Date().toISOString(),
      ...(biometrics_json ? { biometrics_json } : {}),
    });
    restNotify.cancel().catch(() => {});
    router.push({ name: 'training' });
  } catch (e) {
    error.value = e.message;
  } finally {
    completing.value = false;
  }
}

// Elimina l'allenamento. Sta qui e non nello storico: nella lista il bersaglio
// sarebbe a un dito dal pulsante che apre la sessione, e l'operazione non si
// annulla. Chi elimina è dentro l'allenamento, quindi vede cosa sta buttando.
const deleting = ref(false);
async function remove() {
  if (!session.value) return;
  if (!confirm('Eliminare questo allenamento? L\'operazione non è reversibile.')) return;
  deleting.value = true;
  error.value = '';
  try {
    if (hkSupported) {
      try { await healthkit.stop(); } catch { /* il monitor si ferma comunque all'uscita */ }
      if (hkUnsub) { hkUnsub(); hkUnsub = null; }
    }
    await deleteSession(session.value.id);
    router.push({ name: 'training' });
  } catch (e) {
    error.value = e.message;
    deleting.value = false;
  }
}

onMounted(async () => {
  try {
    [session.value, catalog.value] = await Promise.all([
      getSession(route.params.id),
      listExercises(),
    ]);
    if (hkSupported && session.value && !session.value.completed_at) {
      try {
        const auth = await healthkit.requestAuth();
        if (auth.granted) {
          hkUnsub = healthkit.onSample((s) => {
            lastSampleAt.value = Date.now();
            if (s.type === 'heartRate') liveHR.value = Math.round(s.value);
            // Accumulo NON arrotondato: i campioni di energia attiva del Watch valgono
            // frazioni di kcal, e arrotondare a ogni somma parziale azzererebbe il
            // totale per sempre (0 + 0.02 → 0, ripetuto per decine di campioni).
            // L'arrotondamento avviene solo in visualizzazione, in badgeKcal.
            else if (s.type === 'activeEnergy') liveKcal.value = (liveKcal.value || 0) + s.value;
          });
          // Stesso normalizzatore usato per summary(): PostgREST serializza
          // started_at con 6 decimali, che il parser ISO nativo non accetta.
          await healthkit.start(new Date(session.value.started_at).toISOString());
        } else {
          hkError.value = auth.error || 'Accesso ai dati di salute non concesso';
        }
        // Tick periodico: rende hrStale reattivo (Date.now() da solo non è una dipendenza Vue)
        hkTickInterval = setInterval(() => { now.value = Date.now(); }, 5000);
      } catch (e) {
        // HealthKit resta opzionale — non blocca il caricamento della sessione — ma
        // l'errore va mostrato: ingoiarlo rende un plugin non registrato o un
        // permesso negato indistinguibile da "il Watch non sta trasmettendo".
        hkError.value = e?.message || String(e);
      }
    }
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="space-y-4">
    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</p>
    <p v-if="loading" class="text-sm text-gray-400">Caricamento…</p>

    <template v-else-if="session">
      <!-- Intestazione + progresso -->
      <div class="rounded-2xl bg-white p-4 shadow-sm">
        <p class="font-semibold text-gray-900">{{ session.workout_title }} · {{ session.day_name }}</p>
        <p class="mt-0.5 text-xs text-gray-400">
          <span class="capitalize">Iniziato {{ fmtDateTime(session.started_at) }}</span>
          <span v-if="session.completed_at" class="capitalize"> · completato {{ fmtDateTime(session.completed_at) }}</span>
        </p>
        <div class="mt-2 flex items-center gap-2">
          <div class="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
            <div class="h-full rounded-full bg-emerald-500 transition-all"
              :style="{ width: (log.length ? (doneCount / log.length) * 100 : 0) + '%' }"></div>
          </div>
          <span class="text-sm text-gray-500">{{ doneCount }}/{{ log.length }}</span>
        </div>

        <div v-if="hkSupported || saved" class="mt-3 flex flex-wrap gap-2">
          <span class="inline-flex items-center gap-1 rounded-full bg-red-50 px-3 py-1 text-sm font-medium text-red-700">
            ❤️ {{ badgeHR != null ? badgeHR + ' bpm' : '—' }}
            <span v-if="badgeHR != null && sampleAge" class="font-normal text-red-400">· {{ sampleAge }}</span>
          </span>
          <span class="inline-flex items-center gap-1 rounded-full bg-orange-50 px-3 py-1 text-sm font-medium text-orange-600">
            🔥 {{ badgeKcal != null ? badgeKcal + ' kcal' : '—' }}
          </span>
          <span v-if="hkError" class="inline-flex items-center rounded-full bg-amber-50 px-3 py-1 text-xs text-amber-700">
            ⚠️ {{ hkError }}
          </span>
          <span v-else-if="hrStale" class="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-500">
            <!-- Non dice "avvia un allenamento": l'allenamento può essere già in corso
                 e i dati semplicemente non ancora sincronizzati dal Watch. -->
            ⏳ {{ lastSampleAt ? 'In attesa di dati dal Watch' : 'Avvia un allenamento sul Watch' }}
          </span>
        </div>
      </div>

      <p v-if="!log.length" class="rounded-xl bg-white p-4 text-sm text-gray-400 shadow-sm">
        Questa giornata non ha esercizi.
      </p>

      <template v-else>
        <div class="relative overflow-hidden" @touchstart.passive="onTouchStart" @touchend.passive="onTouchEnd">
          <Transition :name="direction === 'next' ? 'slide-next' : 'slide-prev'" mode="out-in">
            <div :key="index" class="overflow-hidden rounded-2xl bg-white shadow-sm">
              <div class="aspect-[16/9] bg-gray-100">
                <ImageCarousel
                  :paths="exerciseImages(catalogById[current.exercise_id])"
                  :alt="catalogById[current.exercise_id]?.name"
                />
              </div>

              <div class="p-4">
                <p class="text-lg font-bold text-gray-900">
                  {{ catalogById[current.exercise_id]?.name || 'Esercizio' }}
                </p>
                <div class="mt-1 flex flex-wrap items-center gap-1">
                  <span
                    v-if="catalogById[current.exercise_id]?.muscle_group"
                    class="inline-block rounded-full bg-brand/10 px-2 py-0.5 text-xs font-semibold text-brand-700"
                  >
                    {{ catalogById[current.exercise_id].muscle_group }}
                  </span>
                  <span
                    v-if="catalogById[current.exercise_id]?.equipment"
                    class="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500"
                  >
                    {{ catalogById[current.exercise_id].equipment }}
                  </span>
                  <span
                    v-if="catalogById[current.exercise_id]?.level"
                    class="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium capitalize text-gray-500"
                  >
                    {{ catalogById[current.exercise_id].level }}
                  </span>
                  <span
                    v-if="catalogById[current.exercise_id]?.mechanic"
                    class="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium capitalize text-gray-500"
                  >
                    {{ catalogById[current.exercise_id].mechanic }}
                  </span>
                </div>
                <p
                  v-if="catalogById[current.exercise_id]?.secondary_muscles?.length"
                  class="mt-1 text-xs text-gray-400"
                >
                  Anche: {{ catalogById[current.exercise_id].secondary_muscles.join(', ') }}
                </p>

                <!-- Serie×ripetizioni e recupero, compatti (es. 4x10 · 1,30 min) -->
                <div class="mt-2 flex items-center gap-4 text-sm text-gray-600">
                  <span class="inline-flex items-center gap-1.5">
                    <svg class="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round"
                        d="M6.5 6.5l11 11M4 7l3-3 3 3-3 3zM14 17l3-3 3 3-3 3zM3 12h2M19 12h2" />
                    </svg>
                    <span class="font-semibold">
                      <template v-if="isLevel(current)">
                        {{ current.sets_log.length > 1 ? current.sets_log.length + 'x' : '' }}{{ current.target_reps }} min
                      </template>
                      <template v-else>{{ current.sets_log.length }}x{{ current.target_reps }}</template>
                    </span>
                  </span>
                  <span class="inline-flex items-center gap-1.5">
                    <svg class="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 2" />
                      <path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span class="font-semibold">{{ fmtRestMin(current.rest_seconds) }}</span>
                  </span>
                </div>

                <ol
                  v-if="steps.length"
                  class="mt-3 list-decimal space-y-1 pl-4 text-xs text-gray-400"
                >
                  <li v-for="(step, si) in shownSteps" :key="si">{{ step }}</li>
                </ol>
                <p
                  v-else-if="exInfo?.description"
                  class="mt-3 text-xs text-gray-400"
                  :class="{ 'line-clamp-2': !descExpanded }"
                >
                  {{ exInfo.description }}
                </p>
                <button
                  v-if="descTruncatable"
                  type="button"
                  class="mt-1 ml-auto block text-xs font-semibold text-brand active:scale-95"
                  @click="descExpanded = !descExpanded"
                >
                  {{ descExpanded ? 'Mostra meno' : 'Leggi tutto' }}
                </button>
                <a
                  v-if="catalogById[current.exercise_id]?.video_url"
                  :href="catalogById[current.exercise_id].video_url"
                  target="_blank" rel="noopener"
                  class="mt-2 inline-flex items-center gap-1 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-700 active:scale-95"
                >
                  ▶ Guarda il video
                </a>

                <!-- Righe delle serie -->
                <div class="mt-3 space-y-2">
                  <!-- intestazione colonne -->
                  <div :class="gridCols" class="grid items-center gap-2 px-1 text-[11px] uppercase tracking-wide text-gray-400">
                    <span>#</span>
                    <span>{{ isLevel(current) ? 'min' : 'reps' }}</span>
                    <span>{{ unitLabel(current.load_type) }}</span>
                    <span v-if="hasIncline(current)">pend. %</span>
                    <span></span>
                    <span></span>
                  </div>

                  <div
                    v-for="(row, ri) in current.sets_log"
                    :key="ri"
                    :class="[gridCols, restState(index, ri) === 'resting'
                      ? 'bg-yellow-100'
                      : (row.done ? 'bg-emerald-100' : 'bg-gray-50')]"
                    class="grid items-center gap-2 rounded-xl px-2 py-1.5 transition-colors"
                  >
                    <span class="text-center text-sm font-semibold text-gray-500">{{ ri + 1 }}</span>

                    <input v-model.number="row.reps" type="number" min="0" inputmode="numeric"
                      class="w-full rounded-lg border-0 bg-white px-2 py-1.5 text-center text-sm focus:outline-none focus:ring-2 focus:ring-brand/40"
                      @change="persist" />

                    <input v-model.number="row.load" type="number" min="0" step="0.5" inputmode="decimal"
                      :placeholder="unitLabel(current.load_type)"
                      class="w-full rounded-lg border-0 bg-white px-2 py-1.5 text-center text-sm focus:outline-none focus:ring-2 focus:ring-brand/40"
                      @change="persist" />

                    <input v-if="hasIncline(current)" v-model.number="row.incline" type="number" min="0" step="0.5" inputmode="decimal"
                      placeholder="%"
                      class="w-full rounded-lg border-0 bg-white px-2 py-1.5 text-center text-sm focus:outline-none focus:ring-2 focus:ring-brand/40"
                      @change="persist" />

                    <!-- Segna eseguita / timer -->
                    <button
                      class="min-w-[3.75rem] rounded-lg px-2 py-1.5 text-xs font-semibold active:scale-95"
                      :class="row.done
                        ? (restState(index, ri) === 'resting' ? 'bg-yellow-400 text-yellow-900' : 'bg-emerald-500 text-white')
                        : 'bg-brand text-white'"
                      @click="onSetButton(index, ri)"
                    >
                      <template v-if="row.done && restState(index, ri) === 'resting'">
                        ⏱ {{ fmtTimer(restRemaining(index, ri)) }}
                      </template>
                      <template v-else-if="row.done">✓ fatto</template>
                      <template v-else>Fatto</template>
                    </button>

                    <button class="text-gray-300 active:text-red-500" @click="removeSet(index, ri)" aria-label="Rimuovi serie">✕</button>
                  </div>

                  <button
                    class="mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand/10 py-2 text-xs font-semibold text-brand-700 active:scale-95"
                    @click="addSet(index)"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
                         stroke-linecap="round" class="h-4 w-4"><path d="M12 5v14M5 12h14" /></svg>
                    Aggiungi serie
                  </button>
                </div>
              </div>
            </div>
          </Transition>
        </div>

        <!-- Paginatore -->
        <div class="flex items-center justify-between">
          <button class="flex h-10 w-10 items-center justify-center rounded-full bg-white text-xl text-gray-600 shadow-sm disabled:opacity-30"
            :disabled="index === 0" @click="prev">‹</button>
          <div class="flex items-center gap-1.5">
            <button
              v-for="(ex, i) in log" :key="i"
              class="h-2.5 rounded-full transition-all"
              :class="[i === index ? 'w-5' : 'w-2.5', isExerciseDone(ex) ? 'bg-emerald-500' : (i === index ? 'bg-brand' : 'bg-gray-300')]"
              @click="go(i)"
            ></button>
          </div>
          <button class="flex h-10 w-10 items-center justify-center rounded-full bg-white text-xl text-gray-600 shadow-sm disabled:opacity-30"
            :disabled="index === log.length - 1" @click="next">›</button>
        </div>
        <p class="text-center text-xs text-gray-400">Esercizio {{ index + 1 }} di {{ log.length }}</p>
      </template>

      <!-- Completa / torna -->
      <button
        v-if="!session.completed_at"
        :disabled="completing"
        class="w-full rounded-xl py-3 font-semibold text-white active:scale-95 disabled:opacity-60"
        :class="allDone ? 'bg-emerald-600' : 'bg-gray-400'"
        @click="complete"
      >
        {{ completing ? 'Salvataggio…' : allDone ? 'Termina allenamento' : 'Termina comunque' }}
      </button>
      <button
        v-else
        class="w-full rounded-xl border border-gray-200 py-3 font-semibold text-gray-600"
        @click="router.push({ name: 'training' })"
      >
        Torna al calendario
      </button>

      <!-- Distruttiva: staccata dalle azioni principali, in fondo alla pagina -->
      <div class="border-t border-gray-100 pt-4">
        <button
          :disabled="deleting"
          class="w-full rounded-xl border border-red-200 bg-red-50 py-3 text-sm font-semibold text-red-700 active:scale-95 disabled:opacity-60"
          @click="remove"
        >
          {{ deleting ? 'Eliminazione…' : 'Elimina allenamento' }}
        </button>
        <p class="mt-2 text-center text-xs text-gray-400">
          Sparisce da calendario e statistiche, e i carichi che hai registrato qui
          non serviranno più a precompilare la prossima volta.
        </p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.slide-next-enter-active, .slide-next-leave-active,
.slide-prev-enter-active, .slide-prev-leave-active {
  transition: transform 0.25s ease, opacity 0.25s ease;
}
.slide-next-enter-from { transform: translateX(40px); opacity: 0; }
.slide-next-leave-to { transform: translateX(-40px); opacity: 0; }
.slide-prev-enter-from { transform: translateX(-40px); opacity: 0; }
.slide-prev-leave-to { transform: translateX(40px); opacity: 0; }
</style>
