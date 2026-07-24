<script setup>
// Profilo utente: dati modificabili (nome, telefono, foto), impostazioni
// (tema chiaro/scuro/automatico), stato abbonamento e logout.
import { ref, computed, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import { useAuthStore } from '@/stores/auth';
import { useThemeStore } from '@/stores/theme';
import { api } from '@/lib/api';
import { avatarUrl, uploadAvatar } from '@/lib/storage';
import { subStatus, SUB_STATUS_LABEL, SUB_STATUS_RANK, formatDate } from '@/lib/subscriptions';

const router = useRouter();
const auth = useAuthStore();
const theme = useThemeStore();
const { fullName, firstName, lastName, phone, avatarPath, role, user } = storeToRefs(auth);
const { mode } = storeToRefs(theme);

const roleLabel = { admin: 'Amministratore', trainer: 'Istruttore', member: 'Cliente' };

// --- Form dati personali ---
const editing = ref(false);
const form = ref({ first_name: '', last_name: '', phone: '' });
const file = ref(null);
const preview = ref(null);
const saving = ref(false);
const error = ref('');
const message = ref('');

// Avatar mostrato: anteprima locale > avatar salvato
const shownAvatar = computed(() => preview.value || avatarUrl(avatarPath.value));

function startEdit() {
  form.value = { first_name: firstName.value, last_name: lastName.value, phone: phone.value };
  file.value = null;
  preview.value = null;
  error.value = '';
  message.value = '';
  editing.value = true;
}

function onFile(e) {
  file.value = e.target.files[0] || null;
  preview.value = file.value ? URL.createObjectURL(file.value) : null;
}

async function save() {
  error.value = '';
  saving.value = true;
  try {
    const fields = {};
    if (form.value.first_name.trim()) fields.first_name = form.value.first_name.trim();
    // cognome/telefono: stringa vuota => null (svuota il campo)
    fields.last_name = form.value.last_name.trim() || null;
    fields.phone = form.value.phone.trim() || null;
    if (file.value) fields.avatar_path = await uploadAvatar(user.value.id, file.value);

    await auth.updateProfile(fields);
    editing.value = false;
    message.value = 'Profilo aggiornato ✔';
  } catch (e) {
    error.value = e.message;
  } finally {
    saving.value = false;
  }
}

// --- Storico abbonamenti (tabella ordinabile) ---
const subs = ref([]);
const subsLoading = ref(true);
const subSortKey = ref('end_date'); // 'start_date' | 'end_date' | 'status'
const subSortDir = ref('desc');

const badgeClass = {
  active: 'bg-emerald-100 text-emerald-700',
  expired: 'bg-rose-50 text-rose-600',
  scheduled: 'bg-amber-100 text-amber-700',
};

function subSortValue(s, key) {
  if (key === 'status') return SUB_STATUS_RANK[subStatus(s)];
  return s[key]; // date 'YYYY-MM-DD' → confronto lessicografico = cronologico
}
function toggleSubSort(key) {
  if (subSortKey.value === key) {
    subSortDir.value = subSortDir.value === 'asc' ? 'desc' : 'asc';
  } else {
    subSortKey.value = key;
    subSortDir.value = 'asc';
  }
}
function subSortIcon(key) {
  if (subSortKey.value !== key) return '↕';
  return subSortDir.value === 'asc' ? '↑' : '↓';
}
const sortedSubs = computed(() => {
  const dir = subSortDir.value === 'asc' ? 1 : -1;
  return [...subs.value].sort((a, b) => {
    const va = subSortValue(a, subSortKey.value);
    const vb = subSortValue(b, subSortKey.value);
    let cmp = va < vb ? -1 : va > vb ? 1 : 0;
    if (cmp === 0) cmp = a.end_date < b.end_date ? -1 : a.end_date > b.end_date ? 1 : 0;
    return cmp * dir;
  });
});

// Paginazione abbonamenti
const PAGE_SIZE = 10;
const subsPage = ref(1);
const subsPageCount = computed(() => Math.max(1, Math.ceil(sortedSubs.value.length / PAGE_SIZE)));
const pagedSubs = computed(() => sortedSubs.value.slice((subsPage.value - 1) * PAGE_SIZE, subsPage.value * PAGE_SIZE));
const subsFrom = computed(() => (sortedSubs.value.length ? (subsPage.value - 1) * PAGE_SIZE + 1 : 0));
const subsTo = computed(() => Math.min(subsPage.value * PAGE_SIZE, sortedSubs.value.length));
watch([subSortKey, subSortDir], () => { subsPage.value = 1; });
watch(subsPageCount, (n) => { if (subsPage.value > n) subsPage.value = n; });

async function loadSubs() {
  subsLoading.value = true;
  try {
    subs.value = await api.get(`/api/subscriptions/member/${user.value.id}`);
  } catch (e) {
    error.value = e.message;
  } finally {
    subsLoading.value = false;
  }
}

// --- Le mie schede (tabella ordinabile con ricerca + gestione stato) ---
const schede = ref([]);
const schedeLoading = ref(true);
const schedeSearch = ref('');
const schedeSortKey = ref('updated_at'); // 'title' | 'days' | 'updated_at'
const schedeSortDir = ref('desc');

function schedaVal(s, key) {
  if (key === 'title') return (s.title || '').toLowerCase();
  if (key === 'days') return (s.days_json || []).length;
  return s[key] || ''; // updated_at (ISO)
}
function toggleSchedaSort(key) {
  if (schedeSortKey.value === key) {
    schedeSortDir.value = schedeSortDir.value === 'asc' ? 'desc' : 'asc';
  } else {
    schedeSortKey.value = key;
    schedeSortDir.value = key === 'title' ? 'asc' : 'desc';
  }
}
function schedaSortIcon(key) {
  if (schedeSortKey.value !== key) return '↕';
  return schedeSortDir.value === 'asc' ? '↑' : '↓';
}
const filteredSchede = computed(() => {
  const q = schedeSearch.value.trim().toLowerCase();
  if (!q) return schede.value;
  return schede.value.filter((s) => (s.title || '').toLowerCase().includes(q));
});
const sortedSchede = computed(() => {
  const dir = schedeSortDir.value === 'asc' ? 1 : -1;
  return [...filteredSchede.value].sort((a, b) => {
    const va = schedaVal(a, schedeSortKey.value);
    const vb = schedaVal(b, schedeSortKey.value);
    let cmp = va < vb ? -1 : va > vb ? 1 : 0;
    if (cmp === 0) cmp = (a.updated_at || '') < (b.updated_at || '') ? -1 : 1;
    return cmp * dir;
  });
});

// Imposta "in uso" (esclusiva; riporta fuori dall'archivio se serve)
async function toggleActive(s) {
  error.value = '';
  const next = !s.is_active;
  try {
    await api.patch(`/api/workouts/${s.id}/active`, { is_active: next });
    for (const w of schede.value) w.is_active = next && w.id === s.id;
    if (next) s.archived = false;
  } catch (e) {
    error.value = e.message;
  }
}

// Archivia/ripristina (nasconde dalle combobox di selezione)
async function toggleArchived(s) {
  error.value = '';
  const next = !s.archived;
  try {
    await api.patch(`/api/workouts/${s.id}/archived`, { archived: next });
    s.archived = next;
    if (next) s.is_active = false; // archiviata ⇒ non più in uso
  } catch (e) {
    error.value = e.message;
  }
}

// Paginazione schede
const schedePage = ref(1);
const schedePageCount = computed(() => Math.max(1, Math.ceil(sortedSchede.value.length / PAGE_SIZE)));
const pagedSchede = computed(() => sortedSchede.value.slice((schedePage.value - 1) * PAGE_SIZE, schedePage.value * PAGE_SIZE));
const schedeFrom = computed(() => (sortedSchede.value.length ? (schedePage.value - 1) * PAGE_SIZE + 1 : 0));
const schedeTo = computed(() => Math.min(schedePage.value * PAGE_SIZE, sortedSchede.value.length));
watch([schedeSearch, schedeSortKey, schedeSortDir], () => { schedePage.value = 1; });
watch(schedePageCount, (n) => { if (schedePage.value > n) schedePage.value = n; });

async function loadSchede() {
  schedeLoading.value = true;
  try {
    schede.value = await api.get(`/api/workouts/member/${user.value.id}`);
  } catch (e) {
    error.value = e.message;
  } finally {
    schedeLoading.value = false;
  }
}

onMounted(() => {
  loadSubs();
  loadSchede();
});

const themeOptions = [
  { value: 'light', label: 'Chiaro', icon: 'sun' },
  { value: 'dark', label: 'Scuro', icon: 'moon' },
  { value: 'auto', label: 'Auto', icon: 'auto' },
];

async function logout() {
  await auth.logout();
  router.push({ name: 'login' });
}
</script>

<template>
  <div class="space-y-5">
    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{{ error }}</p>
    <p v-if="message" class="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-600">{{ message }}</p>

    <!-- Intestazione profilo -->
    <div class="flex flex-col items-center rounded-2xl bg-white p-6 shadow-sm">
      <div class="relative">
        <div class="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-brand/10 text-3xl">
          <img v-if="shownAvatar" :src="shownAvatar" alt="" class="h-full w-full object-cover" />
          <template v-else>👤</template>
        </div>
      </div>
      <p class="mt-3 text-lg font-bold text-gray-900">{{ fullName }}</p>
      <p class="text-sm text-gray-500">{{ user?.email }}</p>
      <p v-if="phone" class="text-sm text-gray-500">{{ phone }}</p>
      <span class="mt-2 rounded-full bg-brand/10 px-3 py-1 text-xs font-semibold text-brand">
        {{ roleLabel[role] || role }}
      </span>

      <button
        v-if="!editing"
        class="mt-4 flex items-center gap-1.5 rounded-lg border border-brand px-4 py-2 text-sm font-semibold text-brand active:scale-95"
        @click="startEdit"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
             stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4">
          <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
        Modifica profilo
      </button>
    </div>

    <!-- Form modifica dati -->
    <section v-if="editing" class="rounded-2xl bg-white p-4 shadow-sm">
      <h2 class="mb-3 font-semibold text-gray-900">Dati personali</h2>
      <form class="space-y-3" @submit.prevent="save">
        <div class="flex items-center gap-3">
          <div class="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand/10 text-2xl">
            <img v-if="shownAvatar" :src="shownAvatar" alt="" class="h-full w-full object-cover" />
            <template v-else>👤</template>
          </div>
          <label class="cursor-pointer rounded-lg border border-dashed border-gray-300 px-4 py-2 text-sm text-gray-500">
            📎 Cambia foto
            <input type="file" accept="image/*" class="hidden" @change="onFile" />
          </label>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="mb-1 block text-xs font-medium text-gray-500">Nome</label>
            <input
              v-model="form.first_name" placeholder="Nome"
              class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand focus:outline-none"
            />
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-gray-500">Cognome</label>
            <input
              v-model="form.last_name" placeholder="Cognome"
              class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand focus:outline-none"
            />
          </div>
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-gray-500">Telefono</label>
          <input
            v-model="form.phone" type="tel" placeholder="Es. +39 333 1234567"
            class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand focus:outline-none"
          />
        </div>

        <div class="flex gap-2">
          <button
            type="button"
            class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-600"
            @click="editing = false"
          >
            Annulla
          </button>
          <button
            type="submit" :disabled="saving"
            class="flex-1 rounded-lg bg-brand py-2 text-sm font-semibold text-white active:scale-95 disabled:opacity-60"
          >
            {{ saving ? 'Salvataggio…' : 'Salva' }}
          </button>
        </div>
      </form>
    </section>

    <!-- Impostazioni -->
    <section class="rounded-2xl bg-white p-4 shadow-sm">
      <h2 class="mb-3 font-semibold text-gray-900">Impostazioni</h2>

      <label class="mb-1.5 block text-xs font-medium text-gray-500">Tema</label>
      <div class="grid grid-cols-3 gap-2">
        <button
          v-for="opt in themeOptions"
          :key="opt.value"
          class="flex flex-col items-center gap-1 rounded-xl border py-3 text-xs font-semibold active:scale-95"
          :class="mode === opt.value
            ? 'border-brand bg-brand/10 text-brand'
            : 'border-gray-300 text-gray-600'"
          @click="theme.setMode(opt.value)"
        >
          <svg v-if="opt.icon === 'sun'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </svg>
          <svg v-else-if="opt.icon === 'moon'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5">
            <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5">
            <circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 0 0 18Z" fill="currentColor" stroke="none" />
          </svg>
          {{ opt.label }}
        </button>
      </div>
    </section>

    <!-- Storico abbonamenti -->
    <section>
      <h2 class="mb-2 font-semibold text-gray-900">I miei abbonamenti</h2>
      <p v-if="subsLoading" class="text-sm text-gray-400">Caricamento…</p>
      <p v-else-if="!subs.length" class="rounded-xl bg-white p-4 text-sm text-gray-400 shadow-sm">
        Nessun abbonamento registrato.
      </p>
      <div v-else class="overflow-hidden rounded-2xl bg-white shadow-sm">
        <table class="w-full table-fixed text-left text-sm">
          <thead class="border-b border-gray-100 text-xs uppercase text-gray-400">
            <tr>
              <th class="px-3 py-2">
                <button class="font-semibold uppercase" @click="toggleSubSort('start_date')">
                  Inizio <span class="text-gray-300">{{ subSortIcon('start_date') }}</span>
                </button>
              </th>
              <th class="px-3 py-2">
                <button class="font-semibold uppercase" @click="toggleSubSort('end_date')">
                  Fine <span class="text-gray-300">{{ subSortIcon('end_date') }}</span>
                </button>
              </th>
              <th class="w-28 px-3 py-2">
                <button class="font-semibold uppercase" @click="toggleSubSort('status')">
                  Stato <span class="text-gray-300">{{ subSortIcon('status') }}</span>
                </button>
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-50">
            <tr v-for="s in pagedSubs" :key="s.id">
              <td class="px-3 py-2 text-gray-700">{{ formatDate(s.start_date) }}</td>
              <td class="px-3 py-2 text-gray-700">{{ formatDate(s.end_date) }}</td>
              <td class="px-3 py-2">
                <span
                  class="inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold"
                  :class="badgeClass[subStatus(s)]"
                >
                  {{ SUB_STATUS_LABEL[subStatus(s)] }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="subs.length" class="mt-3 flex items-center justify-between text-xs text-gray-500">
        <span>{{ subsFrom }}–{{ subsTo }} di {{ sortedSubs.length }}</span>
        <div class="flex items-center gap-2">
          <button :disabled="subsPage === 1" class="rounded-lg border border-gray-300 px-3 py-1 font-semibold disabled:opacity-40" @click="subsPage--">‹</button>
          <span>{{ subsPage }} / {{ subsPageCount }}</span>
          <button :disabled="subsPage === subsPageCount" class="rounded-lg border border-gray-300 px-3 py-1 font-semibold disabled:opacity-40" @click="subsPage++">›</button>
        </div>
      </div>
    </section>

    <!-- Le mie schede -->
    <section v-if="role === 'member'">
      <h2 class="mb-2 font-semibold text-gray-900">Le mie schede</h2>
      <p v-if="schedeLoading" class="text-sm text-gray-400">Caricamento…</p>
      <p v-else-if="!schede.length" class="rounded-xl bg-white p-4 text-sm text-gray-400 shadow-sm">
        Nessuna scheda assegnata.
      </p>

      <template v-else>
        <input
          v-model="schedeSearch" type="search" placeholder="Cerca scheda per titolo…"
          class="mb-3 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-brand focus:outline-none"
        />

        <p v-if="!sortedSchede.length" class="rounded-xl bg-white p-4 text-sm text-gray-400 shadow-sm">
          Nessun risultato per “{{ schedeSearch }}”.
        </p>

        <template v-else>
          <div class="overflow-hidden rounded-2xl bg-white shadow-sm">
            <table class="w-full table-fixed text-left text-sm">
              <thead class="border-b border-gray-100 text-xs uppercase text-gray-400">
                <tr>
                  <th class="w-8 px-2 py-2"></th>
                  <th class="px-2 py-2">
                    <button class="font-semibold uppercase" @click="toggleSchedaSort('title')">
                      Titolo <span class="text-gray-300">{{ schedaSortIcon('title') }}</span>
                    </button>
                  </th>
                  <th class="w-12 px-1 py-2 text-center">
                    <button class="font-semibold uppercase" @click="toggleSchedaSort('days')">
                      Gg <span class="text-gray-300">{{ schedaSortIcon('days') }}</span>
                    </button>
                  </th>
                  <th class="w-10 px-1 py-2"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-50">
                <tr v-for="s in pagedSchede" :key="s.id" :class="s.archived && 'opacity-50'">
                  <td class="px-2 py-2">
                    <!-- stella: imposta "in uso" (disabilitata se archiviata) -->
                    <button
                      class="active:scale-90"
                      :class="s.is_active ? 'text-amber-500' : 'text-gray-300'"
                      :disabled="s.archived"
                      :title="s.is_active ? 'In uso — clicca per togliere' : 'Imposta come in uso'"
                      :aria-label="s.is_active ? 'In uso' : 'Imposta come in uso'"
                      @click="toggleActive(s)"
                    >
                      <svg viewBox="0 0 24 24" :fill="s.is_active ? 'currentColor' : 'none'"
                           stroke="currentColor" stroke-width="1.6" stroke-linecap="round"
                           stroke-linejoin="round" class="h-5 w-5">
                        <path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 18.9 6.1 21l1.2-6.5L2.5 9.9l6.6-.9z" />
                      </svg>
                    </button>
                  </td>
                  <td class="px-2 py-2">
                    <p class="truncate font-medium text-gray-900">
                      {{ s.title || 'Senza titolo' }}
                      <span v-if="s.archived" class="ml-1 rounded bg-gray-100 px-1 py-0.5 text-[10px] font-semibold text-gray-500">Disattivata</span>
                    </p>
                    <p class="text-xs text-gray-400">Agg. {{ formatDate(s.updated_at) }}</p>
                  </td>
                  <td class="px-1 py-2 text-center text-gray-600">{{ (s.days_json || []).length }}</td>
                  <td class="px-1 py-2">
                    <!-- archivia / ripristina -->
                    <button
                      class="rounded-lg p-1.5 text-gray-500 active:scale-90"
                      :title="s.archived ? 'Ripristina' : 'Disattiva (nascondi dalle selezioni)'"
                      :aria-label="s.archived ? 'Ripristina' : 'Disattiva'"
                      @click="toggleArchived(s)"
                    >
                      <svg v-if="!s.archived" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                           stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5">
                        <rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4" />
                      </svg>
                      <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                           stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5">
                        <path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" />
                      </svg>
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="mt-3 flex items-center justify-between text-xs text-gray-500">
            <span>{{ schedeFrom }}–{{ schedeTo }} di {{ sortedSchede.length }}</span>
            <div class="flex items-center gap-2">
              <button :disabled="schedePage === 1" class="rounded-lg border border-gray-300 px-3 py-1 font-semibold disabled:opacity-40" @click="schedePage--">‹</button>
              <span>{{ schedePage }} / {{ schedePageCount }}</span>
              <button :disabled="schedePage === schedePageCount" class="rounded-lg border border-gray-300 px-3 py-1 font-semibold disabled:opacity-40" @click="schedePage++">›</button>
            </div>
          </div>
        </template>
      </template>
    </section>

    <button
      class="w-full rounded-xl border border-rose-200 bg-rose-50 py-3 font-semibold text-rose-600 active:scale-95"
      @click="logout"
    >
      Esci
    </button>
  </div>
</template>
