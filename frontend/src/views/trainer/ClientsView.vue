<script setup>
// Trainer/Admin: elenco clienti (member) in tabella, ordinabile e ricercabile.
// Azioni per riga: anagrafica in modale, oppure vai alle sue schede.
import { ref, computed, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/lib/api';
import { avatarUrl } from '@/lib/storage';
import { computeBmi, bmiCategory, computeAge, GENDER_LABEL } from '@/lib/body';
import Modal from '@/components/Modal.vue';

const router = useRouter();

const members = ref([]);
const loading = ref(true);
const error = ref('');

// Stato abbonamento dal solo subscription_end_date del profilo
function subStatus(m) {
  const end = m.subscription_end_date;
  if (!end) return 'nessuno';
  return end >= new Date().toISOString().slice(0, 10) ? 'attivo' : 'scaduto';
}
const statusLabel = { attivo: 'Attivo', scaduto: 'Scaduto', nessuno: '—' };
const statusClass = {
  attivo: 'bg-emerald-100 text-emerald-700',
  scaduto: 'bg-red-100 text-red-700',
  nessuno: 'bg-gray-100 text-gray-500',
};
function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
}

async function load() {
  loading.value = true;
  try {
    members.value = await api.get('/api/members');
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

// --- Ricerca / ordinamento / paginazione ---
const search = ref('');
const sortKey = ref('full_name'); // 'full_name' | 'status'
const sortDir = ref('asc');
const page = ref(1);
const PAGE_SIZE = 15;

function toggleSort(key) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
  } else {
    sortKey.value = key;
    sortDir.value = 'asc';
  }
}
function sortIcon(key) {
  if (sortKey.value !== key) return '↕';
  return sortDir.value === 'asc' ? '↑' : '↓';
}

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return members.value;
  return members.value.filter((m) =>
    [m.full_name, m.email, m.phone].filter(Boolean).some((v) => v.toLowerCase().includes(q))
  );
});
const sorted = computed(() =>
  [...filtered.value].sort((a, b) => {
    const va = (sortKey.value === 'status' ? subStatus(a) : a.full_name || '').toString().toLowerCase();
    const vb = (sortKey.value === 'status' ? subStatus(b) : b.full_name || '').toString().toLowerCase();
    const cmp = va.localeCompare(vb, 'it');
    return sortDir.value === 'asc' ? cmp : -cmp;
  })
);
const pageCount = computed(() => Math.max(1, Math.ceil(sorted.value.length / PAGE_SIZE)));
const paged = computed(() => sorted.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));
const rangeFrom = computed(() => (sorted.value.length ? (page.value - 1) * PAGE_SIZE + 1 : 0));
const rangeTo = computed(() => Math.min(page.value * PAGE_SIZE, sorted.value.length));

watch([search, sortKey, sortDir], () => { page.value = 1; });
watch(pageCount, (n) => { if (page.value > n) page.value = n; });

// --- Anagrafica (modale) ---
const detailOpen = ref(false);
const detail = ref(null);
function openDetail(m) {
  detail.value = m;
  detailOpen.value = true;
}

function goToWorkouts(m) {
  router.push({ name: 'client-workouts', params: { memberId: m.id } });
}

onMounted(load);
</script>

<template>
  <div class="space-y-4">
    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</p>

    <h1 class="text-lg font-bold text-gray-900">Clienti</h1>

    <input
      v-model="search" type="search" placeholder="Cerca per nome, email, telefono…"
      class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-brand focus:outline-none"
    />

    <p v-if="loading" class="text-sm text-gray-400">Caricamento…</p>
    <p v-else-if="!members.length" class="rounded-xl bg-white p-4 text-sm text-gray-400 shadow-sm">
      Nessun cliente.
    </p>
    <p v-else-if="!sorted.length" class="rounded-xl bg-white p-4 text-sm text-gray-400 shadow-sm">
      Nessun risultato per “{{ search }}”.
    </p>

    <template v-else>
      <div class="overflow-hidden rounded-2xl bg-white shadow-sm">
        <table class="w-full table-fixed text-left text-sm">
          <thead class="border-b border-gray-100 text-xs uppercase text-gray-400">
            <tr>
              <th class="px-3 py-2">
                <button class="font-semibold uppercase" @click="toggleSort('full_name')">
                  Nome <span class="text-gray-300">{{ sortIcon('full_name') }}</span>
                </button>
              </th>
              <th class="w-24 px-2 py-2">
                <button class="font-semibold uppercase" @click="toggleSort('status')">
                  Abb. <span class="text-gray-300">{{ sortIcon('status') }}</span>
                </button>
              </th>
              <th class="w-24 px-2 py-2 text-right">Azioni</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-50">
            <tr v-for="m in paged" :key="m.id" class="align-middle">
              <td class="px-3 py-2">
                <div class="flex items-center gap-2">
                  <div class="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand/10 text-sm">
                    <img v-if="avatarUrl(m.avatar_path)" :src="avatarUrl(m.avatar_path)" alt="" class="h-full w-full object-cover" />
                    <template v-else>👤</template>
                  </div>
                  <div class="min-w-0">
                    <p class="truncate font-medium text-gray-900">{{ m.full_name || 'Senza nome' }}</p>
                    <p v-if="m.email" class="truncate text-xs text-gray-400">{{ m.email }}</p>
                  </div>
                </div>
              </td>
              <td class="px-2 py-2">
                <span class="rounded-full px-2 py-0.5 text-[10px] font-semibold" :class="statusClass[subStatus(m)]">
                  {{ statusLabel[subStatus(m)] }}
                </span>
              </td>
              <td class="whitespace-nowrap px-2 py-2">
                <div class="flex justify-end gap-1">
                  <button
                    class="rounded-lg p-2 text-gray-500 active:scale-90"
                    title="Anagrafica" aria-label="Anagrafica" @click="openDetail(m)"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                         stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5">
                      <circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" />
                    </svg>
                  </button>
                  <button
                    class="rounded-lg p-2 text-brand active:scale-90"
                    title="Schede" aria-label="Schede" @click="goToWorkouts(m)"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                         stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5">
                      <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
                      <path d="M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 12h6M9 16h4" />
                    </svg>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="flex items-center justify-between text-xs text-gray-500">
        <span>{{ rangeFrom }}–{{ rangeTo }} di {{ sorted.length }}</span>
        <div class="flex items-center gap-2">
          <button :disabled="page === 1" class="rounded-lg border border-gray-300 px-3 py-1 font-semibold disabled:opacity-40" @click="page--">‹</button>
          <span>{{ page }} / {{ pageCount }}</span>
          <button :disabled="page === pageCount" class="rounded-lg border border-gray-300 px-3 py-1 font-semibold disabled:opacity-40" @click="page++">›</button>
        </div>
      </div>
    </template>

    <!-- Modale anagrafica -->
    <Modal :open="detailOpen" :title="detail?.full_name || 'Cliente'" @close="detailOpen = false">
      <div v-if="detail" class="mb-3 flex items-center gap-3">
        <div class="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand/10 text-2xl">
          <img v-if="avatarUrl(detail.avatar_path)" :src="avatarUrl(detail.avatar_path)" alt="" class="h-full w-full object-cover" />
          <template v-else>👤</template>
        </div>
        <p class="min-w-0 truncate text-lg font-bold text-gray-900">{{ detail.full_name || 'Cliente' }}</p>
      </div>
      <dl v-if="detail" class="space-y-2 text-sm">
        <div class="flex justify-between gap-3">
          <dt class="text-gray-500">Email</dt>
          <dd class="min-w-0 truncate text-right text-gray-900">{{ detail.email || '—' }}</dd>
        </div>
        <div class="flex justify-between gap-3">
          <dt class="text-gray-500">Telefono</dt>
          <dd class="text-right text-gray-900">{{ detail.phone || '—' }}</dd>
        </div>
        <div class="flex justify-between gap-3">
          <dt class="text-gray-500">Genere</dt>
          <dd class="text-right text-gray-900">{{ GENDER_LABEL[detail.gender] || '—' }}</dd>
        </div>
        <div class="flex justify-between gap-3">
          <dt class="text-gray-500">Età</dt>
          <dd class="text-right text-gray-900">
            {{ computeAge(detail.birth_date) != null ? computeAge(detail.birth_date) + ' anni' : '—' }}
          </dd>
        </div>
        <div class="flex justify-between gap-3">
          <dt class="text-gray-500">Altezza</dt>
          <dd class="text-right text-gray-900">{{ detail.height_cm ? detail.height_cm + ' cm' : '—' }}</dd>
        </div>
        <div class="flex justify-between gap-3">
          <dt class="text-gray-500">Peso</dt>
          <dd class="text-right text-gray-900">{{ detail.weight_kg ? detail.weight_kg + ' kg' : '—' }}</dd>
        </div>
        <div class="flex justify-between gap-3">
          <dt class="text-gray-500">BMI</dt>
          <dd class="text-right text-gray-900">
            <template v-if="computeBmi(detail.height_cm, detail.weight_kg) != null">
              {{ computeBmi(detail.height_cm, detail.weight_kg) }}
              <span class="text-xs text-gray-400">({{ bmiCategory(computeBmi(detail.height_cm, detail.weight_kg)) }})</span>
            </template>
            <template v-else>—</template>
          </dd>
        </div>
        <div class="flex justify-between gap-3">
          <dt class="text-gray-500">Abbonamento</dt>
          <dd class="text-right">
            <span class="rounded-full px-2 py-0.5 text-[10px] font-semibold" :class="statusClass[subStatus(detail)]">
              {{ statusLabel[subStatus(detail)] }}
            </span>
          </dd>
        </div>
        <div class="flex justify-between gap-3">
          <dt class="text-gray-500">Scadenza</dt>
          <dd class="text-right text-gray-900">{{ fmtDate(detail.subscription_end_date) }}</dd>
        </div>
      </dl>
      <div v-if="detail?.notes" class="mt-3 border-t border-gray-100 pt-3">
        <p class="mb-1 text-xs font-medium text-gray-500">Note</p>
        <p class="text-sm text-gray-700">{{ detail.notes }}</p>
      </div>
      <button
        class="mt-4 w-full rounded-lg bg-brand py-2 text-sm font-semibold text-white active:scale-95"
        @click="detailOpen = false; goToWorkouts(detail)"
      >
        Vai alle schede
      </button>
    </Modal>
  </div>
</template>
