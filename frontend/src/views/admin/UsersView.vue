<script setup>
// Admin: gestione utenti — tabella con ricerca e ordinamento; la modifica
// (ruolo, email, abbonamenti) avviene in un pannello dedicato per utente.
import { ref, computed, watch, onMounted } from 'vue';
import { api } from '@/lib/api';
import { subStatus, SUB_STATUS_LABEL, formatDate } from '@/lib/subscriptions';
import Modal from '@/components/Modal.vue';
import Combobox from '@/components/Combobox.vue';

const users = ref([]);
const loading = ref(true);
const savingId = ref(null);
const error = ref('');

const roleLabel = { admin: 'Admin', trainer: 'Trainer', member: 'Member' };
const roleOptions = Object.entries(roleLabel).map(([value, label]) => ({ value, label }));
const roleRank = { admin: 0, trainer: 1, member: 2 };

// Forma canonica delle chip: fondo -100, testo -700 (prima "expired" stava a
// 50/600, la stessa idea detta con tonalità diverse dalle altre viste).
const badgeClass = {
  active: 'bg-emerald-100 text-emerald-700',
  expired: 'bg-red-100 text-red-700',
  scheduled: 'bg-amber-100 text-amber-700',
};

// Chip del ruolo. Tinte fuori dalla scala verde/ambra/rossa degli stati: nella
// stessa riga convivono due chip, e riusare quei colori farebbe leggere il ruolo
// come uno stato. Il celeste del trainer sostituisce l'indigo, che era il colore
// del vecchio brand ed era rimasto orfano. Il testo dell'admin è al passo 700 e
// non al primario: sul fondo rosa tenue il 600 darebbe 4,24:1, sotto soglia.
const roleBadgeClass = {
  admin: 'bg-brand-100 text-brand-700',
  trainer: 'bg-sky-100 text-sky-700',
  member: 'bg-gray-100 text-gray-600',
};

function isActive(u) {
  const end = u.subscription_end_date;
  return end && end >= new Date().toISOString().slice(0, 10);
}

async function load() {
  loading.value = true;
  try {
    const list = await api.get('/api/users');
    users.value = list.map((u) => ({
      ...u,
      _origEmail: u.email,
      _subs: null,
      _subsLoading: false,
      _newStart: '',
      _newEnd: '',
    }));
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

// --- Ricerca / ordinamento / paginazione ---
const search = ref('');
const sortKey = ref('full_name'); // 'full_name' | 'role' | 'subscription'
const sortDir = ref('asc');
const page = ref(1);
const PAGE_SIZE = 10;

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

// --- Filtri ruolo e abbonamento ---
const roleFilter = ref('');
const subFilter = ref('');

// Niente voce "Tutti" nelle opzioni: come negli altri filtri del progetto è il
// placeholder a dirlo, e si azzera con la ✕ del Combobox (clearable).
const roleFilterOptions = roleOptions;
const subFilterOptions = [
  { value: 'active', label: 'Attivo' },
  { value: 'expired', label: 'Scaduto' },
  { value: 'none', label: 'Senza abbonamento' },
];

// Stato dell'abbonamento a livello di UTENTE: la lista espone solo la data di
// fine di quello più recente, mentre subStatus() ragiona sul singolo
// abbonamento. Chi non ne ha mai avuto uno è 'none', così non finisce né tra
// gli attivi né tra gli scaduti — dove sarebbe fuorviante.
function userSubState(u) {
  const end = u.subscription_end_date;
  if (!end) return 'none';
  return end >= new Date().toISOString().slice(0, 10) ? 'active' : 'expired';
}

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return users.value.filter((u) => {
    if (roleFilter.value && u.role !== roleFilter.value) return false;
    if (subFilter.value && userSubState(u) !== subFilter.value) return false;
    if (!q) return true;
    return [u.full_name, u.email, roleLabel[u.role]]
      .filter(Boolean)
      .some((v) => v.toLowerCase().includes(q));
  });
});

function sortValue(u, key) {
  if (key === 'role') return roleRank[u.role] ?? 9;
  if (key === 'subscription') return u.subscription_end_date || ''; // vuoto in fondo
  return (u.full_name || '').toLowerCase();
}
const sorted = computed(() => {
  const dir = sortDir.value === 'asc' ? 1 : -1;
  return [...filtered.value].sort((a, b) => {
    const va = sortValue(a, sortKey.value);
    const vb = sortValue(b, sortKey.value);
    // i valori vuoti (nessun abbonamento) restano in fondo a prescindere dalla direzione
    if (va === '' && vb !== '') return 1;
    if (vb === '' && va !== '') return -1;
    let cmp = va < vb ? -1 : va > vb ? 1 : 0;
    if (cmp === 0) cmp = (a.full_name || '').localeCompare(b.full_name || '', 'it');
    return cmp * dir;
  });
});

const pageCount = computed(() => Math.max(1, Math.ceil(sorted.value.length / PAGE_SIZE)));
const paged = computed(() => sorted.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));
const rangeFrom = computed(() => (sorted.value.length ? (page.value - 1) * PAGE_SIZE + 1 : 0));
const rangeTo = computed(() => Math.min(page.value * PAGE_SIZE, sorted.value.length));

watch([search, roleFilter, subFilter, sortKey, sortDir], () => { page.value = 1; });
watch(pageCount, (n) => { if (page.value > n) page.value = n; });

// --- Modifica utente (pannello) ---
const editUser = ref(null); // riferimento all'oggetto della lista

function openEdit(u) {
  error.value = '';
  editUser.value = u;
  if (u._subs === null && u.role === 'member') loadSubs(u);
}

async function save(u) {
  error.value = '';
  savingId.value = u.id;
  try {
    const payload = { role: u.role };
    if (u.email && u.email !== u._origEmail) payload.email = u.email.trim();
    await api.patch(`/api/members/${u.id}`, payload);
    u._origEmail = u.email;
    u._saved = true;
    setTimeout(() => (u._saved = false), 1500);
  } catch (e) {
    error.value = e.message;
  } finally {
    savingId.value = null;
  }
}

// --- Abbonamenti (periodi) ---
async function loadSubs(u) {
  u._subsLoading = true;
  try {
    u._subs = await api.get(`/api/subscriptions/member/${u.id}`);
  } catch (e) {
    error.value = e.message;
  } finally {
    u._subsLoading = false;
  }
}

async function addSub(u) {
  error.value = '';
  if (!u._newStart || !u._newEnd) return;
  if (u._newEnd < u._newStart) {
    error.value = 'La data di fine precede quella di inizio';
    return;
  }
  try {
    await api.post('/api/subscriptions', { member_id: u.id, start_date: u._newStart, end_date: u._newEnd });
    u._newStart = '';
    u._newEnd = '';
    await loadSubs(u);
    refreshEnd(u);
  } catch (e) {
    error.value = e.message;
  }
}

async function removeSub(u, sub) {
  if (!confirm('Eliminare questo periodo di abbonamento?')) return;
  try {
    await api.del(`/api/subscriptions/${sub.id}`);
    await loadSubs(u);
    refreshEnd(u);
  } catch (e) {
    error.value = e.message;
  }
}

// Riallinea il riepilogo (subscription_end_date è derivata dal trigger DB)
function refreshEnd(u) {
  u.subscription_end_date = (u._subs || []).reduce((max, s) => (s.end_date > max ? s.end_date : max), '') || null;
}

onMounted(load);
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-lg font-bold text-gray-900">Utenti</h1>
    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</p>

    <input
      v-model="search" type="search" placeholder="Cerca nome, email, ruolo…"
      class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-brand focus:outline-none"
    />

    <!-- Filtri -->
    <div class="grid grid-cols-2 gap-2">
      <Combobox v-model="roleFilter" :options="roleFilterOptions" dense placeholder="Tutti i ruoli" empty-text="Nessun ruolo" />
      <Combobox v-model="subFilter" :options="subFilterOptions" dense placeholder="Tutti gli abbonamenti" empty-text="Nessuno stato" />
    </div>

    <p v-if="!loading && (roleFilter || subFilter || search)" class="text-xs text-gray-400">
      {{ sorted.length }}
      {{ sorted.length === 1 ? 'utente trovato' : 'utenti trovati' }}
      <button
        v-if="roleFilter || subFilter || search"
        type="button"
        class="ml-1 font-semibold text-brand active:scale-95"
        @click="search = ''; roleFilter = ''; subFilter = ''"
      >
        Azzera filtri
      </button>
    </p>

    <p v-if="loading" class="text-sm text-gray-400">Caricamento utenti…</p>
    <p v-else-if="!sorted.length" class="rounded-xl bg-white p-4 text-sm text-gray-400 shadow-sm">
      {{ search ? 'Nessun risultato.' : 'Nessun utente.' }}
    </p>

    <template v-else>
      <div class="overflow-hidden rounded-2xl bg-white shadow-sm">
        <table class="w-full table-fixed text-left text-sm">
          <thead class="border-b border-gray-100 text-xs uppercase text-gray-400">
            <tr>
              <th class="px-3 py-2">
                <button class="font-semibold uppercase" @click="toggleSort('full_name')">
                  Utente <span class="text-gray-300">{{ sortIcon('full_name') }}</span>
                </button>
              </th>
              <th class="w-20 px-2 py-2">
                <button class="font-semibold uppercase" @click="toggleSort('role')">
                  Ruolo <span class="text-gray-300">{{ sortIcon('role') }}</span>
                </button>
              </th>
              <th class="w-24 px-2 py-2">
                <button class="font-semibold uppercase" @click="toggleSort('subscription')">
                  Abb. <span class="text-gray-300">{{ sortIcon('subscription') }}</span>
                </button>
              </th>
              <th class="w-10 px-2 py-2"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-50">
            <tr v-for="u in paged" :key="u.id">
              <td class="px-3 py-2">
                <p class="truncate font-medium text-gray-900">{{ u.full_name || 'Senza nome' }}</p>
                <p class="truncate text-xs text-gray-400">{{ u.email }}</p>
              </td>
              <td class="px-2 py-2">
                <span
                  class="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold"
                  :class="roleBadgeClass[u.role] || 'bg-gray-100 text-gray-600'"
                >
                  {{ roleLabel[u.role] }}
                </span>
              </td>
              <td class="px-2 py-2">
                <span
                  v-if="u.role === 'member'"
                  class="inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold"
                  :class="isActive(u) ? badgeClass.active : badgeClass.expired"
                >
                  {{ isActive(u) ? 'Attivo' : 'Scaduto' }}
                </span>
                <span v-else class="text-xs text-gray-300">—</span>
              </td>
              <td class="px-2 py-2 text-right">
                <button
                  class="rounded-lg p-1.5 text-brand active:scale-90"
                  title="Modifica" aria-label="Modifica" @click="openEdit(u)"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                       stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5">
                    <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                </button>
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

    <!-- Pannello modifica utente -->
    <Modal :open="!!editUser" :title="editUser?.full_name || 'Utente'" @close="editUser = null">
      <div v-if="editUser" class="space-y-3">

        <div>
          <label class="mb-1 block text-xs font-medium text-gray-500">Email</label>
          <input
            v-model="editUser.email" type="email"
            class="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm focus:border-brand focus:outline-none"
          />
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-gray-500">Ruolo</label>
          <Combobox
            v-model="editUser.role"
            :options="roleOptions"
            :clearable="false"
            dense
            placeholder="Cerca ruolo…"
            empty-text="Nessun ruolo"
          />
        </div>

        <button
          :disabled="savingId === editUser.id"
          class="w-full rounded-lg py-2 text-sm font-semibold text-white active:scale-95 disabled:opacity-60"
          :class="editUser._saved ? 'bg-emerald-500' : 'bg-brand'"
          @click="save(editUser)"
        >
          {{ savingId === editUser.id ? 'Salvataggio…' : editUser._saved ? 'Salvato ✔' : 'Salva' }}
        </button>

        <!-- Abbonamenti -->
        <div v-if="editUser.role === 'member'" class="border-t border-gray-100 pt-3">
          <p class="mb-2 text-sm font-medium text-gray-700">Abbonamenti</p>
          <p v-if="editUser._subsLoading" class="text-xs text-gray-400">Caricamento…</p>
          <p v-else-if="!editUser._subs?.length" class="text-xs text-gray-400">Nessun periodo.</p>
          <ul v-else class="space-y-1">
            <li
              v-for="s in editUser._subs"
              :key="s.id"
              class="flex items-center justify-between rounded-lg bg-gray-50 px-2 py-1.5 text-xs"
            >
              <span class="text-gray-700">{{ formatDate(s.start_date) }} → {{ formatDate(s.end_date) }}</span>
              <span class="flex items-center gap-2">
                <span class="rounded-full px-1.5 py-0.5 text-[10px] font-semibold" :class="badgeClass[subStatus(s)]">
                  {{ SUB_STATUS_LABEL[subStatus(s)] }}
                </span>
                <button class="rounded p-1 text-red-500 active:scale-90" title="Elimina" @click="removeSub(editUser, s)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                       stroke-linecap="round" class="h-4 w-4"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              </span>
            </li>
          </ul>

          <div class="mt-2 flex items-end gap-2">
            <div class="flex-1">
              <label class="mb-0.5 block text-[11px] font-medium text-gray-500">Inizio</label>
              <input v-model="editUser._newStart" type="date"
                class="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-xs focus:border-brand focus:outline-none" />
            </div>
            <div class="flex-1">
              <label class="mb-0.5 block text-[11px] font-medium text-gray-500">Fine</label>
              <input v-model="editUser._newEnd" type="date"
                class="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-xs focus:border-brand focus:outline-none" />
            </div>
            <button
              :disabled="!editUser._newStart || !editUser._newEnd"
              class="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white active:scale-95 disabled:opacity-50"
              @click="addSub(editUser)"
            >
              Aggiungi
            </button>
          </div>
        </div>
      </div>
    </Modal>
  </div>
</template>
