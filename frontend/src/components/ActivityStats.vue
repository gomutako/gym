<script setup>
// Statistiche attività del member, calcolate dalle sessioni di allenamento.
// Fonti: workout_sessions (exercises_log con sets_log: reps/load/done) + catalogo
// esercizi (muscle_group, load_type). Grafici inline (SVG/HTML), tema-aware:
// l'accento usa `text-brand` (rimappato più chiaro in dark) via currentColor,
// il testo usa i token grigi. Una sola tinta per magnitudo (regola dataviz).
import { computed } from 'vue';

const props = defineProps({
  sessions: { type: Array, default: () => [] },
  catalog: { type: Array, default: () => [] },
});

const catalogById = computed(() =>
  Object.fromEntries(props.catalog.map((e) => [e.id, e]))
);

const nf = new Intl.NumberFormat('it-IT');

// data di riferimento di una sessione (fine se completata, altrimenti inizio)
function sessionDate(s) {
  return new Date(s.completed_at || s.started_at);
}

// tutte le serie effettivamente eseguite di una sessione, con carico e gruppo
function doneSets(s) {
  const out = [];
  for (const ex of s.exercises_log || []) {
    const cat = catalogById.value[ex.exercise_id];
    const loadType = ex.load_type || cat?.load_type || 'weight';
    for (const set of ex.sets_log || []) {
      if (set.done) out.push({ reps: set.reps || 0, load: set.load || 0, loadType, muscle: cat?.muscle_group || null });
    }
  }
  return out;
}

// --- KPI ---
const completedSessions = computed(() => props.sessions.filter((s) => s.completed_at));
const kpi = computed(() => {
  const now = new Date();
  let series = 0;
  let volume = 0;
  let thisMonth = 0;
  for (const s of completedSessions.value) {
    const d = sessionDate(s);
    if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) thisMonth++;
    for (const set of doneSets(s)) {
      series++;
      if (set.loadType === 'weight') volume += set.reps * set.load;
    }
  }
  return { total: completedSessions.value.length, thisMonth, series, volume };
});

// --- Serie temporale: ultime 12 settimane (lun→dom) ---
const WEEKS = 12;
function weekStartKey(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const offset = (x.getDay() + 6) % 7; // lun = 0
  x.setDate(x.getDate() - offset);
  return x;
}
const weekly = computed(() => {
  const start = weekStartKey(new Date());
  start.setDate(start.getDate() - 7 * (WEEKS - 1));
  const buckets = [];
  for (let i = 0; i < WEEKS; i++) {
    const ws = new Date(start);
    ws.setDate(start.getDate() + i * 7);
    buckets.push({ ws, count: 0, volume: 0 });
  }
  const idxOf = (d) => Math.floor((weekStartKey(d) - start) / (7 * 86400000));
  for (const s of completedSessions.value) {
    const i = idxOf(sessionDate(s));
    if (i < 0 || i >= WEEKS) continue;
    buckets[i].count++;
    for (const set of doneSets(s)) if (set.loadType === 'weight') buckets[i].volume += set.reps * set.load;
  }
  return buckets;
});
const maxCount = computed(() => Math.max(1, ...weekly.value.map((w) => w.count)));
const maxVolume = computed(() => Math.max(1, ...weekly.value.map((w) => w.volume)));

// etichetta mese mostrata quando cambia il mese (asse discreto)
function weekLabel(w, i) {
  const prev = i > 0 ? weekly.value[i - 1].ws : null;
  if (i === 0 || w.ws.getMonth() !== prev.getMonth()) {
    return w.ws.toLocaleDateString('it-IT', { month: 'short' });
  }
  return '';
}

// path dell'area volume in viewBox 100x40 (0,0 alto-sx)
const volumeArea = computed(() => {
  const W = 100, H = 40, n = weekly.value.length;
  const x = (i) => (n === 1 ? 0 : (i / (n - 1)) * W);
  const y = (v) => H - (v / maxVolume.value) * (H - 4) - 2;
  const pts = weekly.value.map((w, i) => `${x(i).toFixed(2)},${y(w.volume).toFixed(2)}`);
  return {
    line: 'M' + pts.join(' L'),
    area: `M0,${H} L` + pts.join(' L') + ` L${W},${H} Z`,
    last: weekly.value[n - 1],
  };
});

// --- Gruppi muscolari (ultimi 30 giorni), serie per gruppo ---
const muscleBars = computed(() => {
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const map = {};
  for (const s of completedSessions.value) {
    if (sessionDate(s) < since) continue;
    for (const set of doneSets(s)) {
      const k = set.muscle || 'Altro';
      map[k] = (map[k] || 0) + 1;
    }
  }
  const rows = Object.entries(map).map(([name, count]) => ({ name, count }));
  rows.sort((a, b) => b.count - a.count);
  const top = rows.slice(0, 6);
  const max = Math.max(1, ...top.map((r) => r.count));
  return top.map((r) => ({ ...r, pct: Math.round((r.count / max) * 100) }));
});

const hasData = computed(() => completedSessions.value.length > 0);
</script>

<template>
  <section>
    <h2 class="mb-2 font-semibold text-gray-900">La mia attività</h2>

    <p v-if="!hasData" class="rounded-xl bg-white p-4 text-sm text-gray-400 shadow-sm">
      Ancora nessun allenamento completato. Le statistiche compariranno qui.
    </p>

    <div v-else class="space-y-3">
      <!-- KPI -->
      <div class="grid grid-cols-2 gap-3">
        <div class="rounded-2xl bg-white p-3 shadow-sm">
          <p class="text-2xl font-bold text-gray-900">{{ kpi.total }}</p>
          <p class="text-xs text-gray-500">Allenamenti</p>
        </div>
        <div class="rounded-2xl bg-white p-3 shadow-sm">
          <p class="text-2xl font-bold text-gray-900">{{ kpi.thisMonth }}</p>
          <p class="text-xs text-gray-500">Questo mese</p>
        </div>
        <div class="rounded-2xl bg-white p-3 shadow-sm">
          <p class="text-2xl font-bold text-gray-900">{{ nf.format(kpi.series) }}</p>
          <p class="text-xs text-gray-500">Serie completate</p>
        </div>
        <div class="rounded-2xl bg-white p-3 shadow-sm">
          <p class="text-2xl font-bold text-gray-900">{{ nf.format(kpi.volume) }}<span class="text-sm font-semibold text-gray-400"> kg</span></p>
          <p class="text-xs text-gray-500">Volume totale</p>
        </div>
      </div>

      <!-- Allenamenti per settimana -->
      <div class="rounded-2xl bg-white p-4 shadow-sm">
        <p class="mb-3 text-sm font-medium text-gray-700">Allenamenti per settimana</p>
        <div class="flex h-28 items-end gap-1 text-brand">
          <div v-for="(w, i) in weekly" :key="i" class="flex flex-1 flex-col items-center justify-end gap-1" :title="`${w.count} allenamenti`">
            <span v-if="w.count" class="text-[10px] font-semibold text-gray-400">{{ w.count }}</span>
            <div
              class="w-full rounded-t bg-current"
              :style="{ height: `${(w.count / maxCount) * 100}%`, minHeight: w.count ? '3px' : '0' }"
            ></div>
          </div>
        </div>
        <div class="mt-1 flex gap-1">
          <span v-for="(w, i) in weekly" :key="i" class="flex-1 text-center text-[9px] capitalize text-gray-400">
            {{ weekLabel(w, i) }}
          </span>
        </div>
      </div>

      <!-- Volume nel tempo -->
      <div class="rounded-2xl bg-white p-4 shadow-sm">
        <div class="mb-2 flex items-baseline justify-between">
          <p class="text-sm font-medium text-gray-700">Volume per settimana</p>
          <p class="text-xs text-gray-400">ultima: {{ nf.format(Math.round(volumeArea.last.volume)) }} kg</p>
        </div>
        <svg viewBox="0 0 100 40" preserveAspectRatio="none" class="h-24 w-full text-brand">
          <path :d="volumeArea.area" fill="currentColor" fill-opacity="0.12" />
          <path :d="volumeArea.line" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
        </svg>
        <div class="mt-1 flex gap-1">
          <span v-for="(w, i) in weekly" :key="i" class="flex-1 text-center text-[9px] capitalize text-gray-400">
            {{ weekLabel(w, i) }}
          </span>
        </div>
      </div>

      <!-- Gruppi muscolari (ultimi 30 giorni) -->
      <div class="rounded-2xl bg-white p-4 shadow-sm">
        <p class="mb-3 text-sm font-medium text-gray-700">Serie per gruppo muscolare <span class="text-xs font-normal text-gray-400">· ultimi 30 giorni</span></p>
        <p v-if="!muscleBars.length" class="text-xs text-gray-400">Nessuna serie negli ultimi 30 giorni.</p>
        <ul v-else class="space-y-2">
          <li v-for="m in muscleBars" :key="m.name" class="flex items-center gap-2">
            <span class="w-24 shrink-0 truncate text-xs text-gray-600">{{ m.name }}</span>
            <div class="h-3 flex-1 overflow-hidden rounded-full bg-gray-100">
              <div class="h-full rounded-full bg-brand" :style="{ width: `${m.pct}%` }"></div>
            </div>
            <span class="w-6 shrink-0 text-right text-xs font-semibold text-gray-500">{{ m.count }}</span>
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>
