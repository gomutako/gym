<script setup>
// Dashboard Admin: statistiche sintetiche + report presenze per corso.
import { ref, onMounted } from 'vue';
import { api } from '@/lib/api';
import IdentityCard from '@/components/IdentityCard.vue';

const report = ref(null);
const loading = ref(true);
const error = ref('');

function formatDate(iso) {
  return new Date(iso).toLocaleString('it-IT', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

onMounted(async () => {
  try {
    report.value = await api.get('/api/reports/attendance');
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="space-y-5">
    <IdentityCard />

    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{{ error }}</p>
    <p v-if="loading" class="text-sm text-gray-400">Caricamento report…</p>

    <template v-else-if="report">
      <!-- Statistiche -->
      <section class="grid grid-cols-3 gap-3">
        <div class="rounded-2xl bg-white p-4 text-center shadow-sm">
          <p class="text-2xl font-bold text-brand">{{ report.totals.classes }}</p>
          <p class="text-xs text-gray-500">Corsi</p>
        </div>
        <div class="rounded-2xl bg-white p-4 text-center shadow-sm">
          <p class="text-2xl font-bold text-brand">{{ report.totals.bookings }}</p>
          <p class="text-xs text-gray-500">Prenotazioni</p>
        </div>
        <div class="rounded-2xl bg-white p-4 text-center shadow-sm">
          <p class="text-2xl font-bold text-brand">{{ report.totals.avgFillRate }}%</p>
          <p class="text-xs text-gray-500">Riempimento</p>
        </div>
      </section>

      <!-- Report per corso -->
      <section>
        <h2 class="mb-2 font-semibold text-gray-900">Presenze per corso</h2>
        <p v-if="!report.rows.length" class="rounded-xl bg-white p-4 text-sm text-gray-400 shadow-sm">
          Nessun corso in programma.
        </p>
        <ul v-else class="space-y-2">
          <li v-for="r in report.rows" :key="r.id" class="rounded-xl bg-white p-4 shadow-sm">
            <div class="flex items-center justify-between">
              <div>
                <p class="font-medium text-gray-900">{{ r.name }}</p>
                <p class="text-sm text-gray-500">{{ formatDate(r.start_time) }}</p>
              </div>
              <p class="text-sm font-semibold text-gray-700">
                {{ r.booked }}/{{ r.max_capacity }}
              </p>
            </div>
            <!-- Barra di riempimento -->
            <div class="mt-2 h-2 overflow-hidden rounded-full bg-gray-100">
              <div
                class="h-full rounded-full"
                :class="r.fillRate >= 100 ? 'bg-rose-500' : 'bg-emerald-500'"
                :style="{ width: Math.min(r.fillRate, 100) + '%' }"
              ></div>
            </div>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
