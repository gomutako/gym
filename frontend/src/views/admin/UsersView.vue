<script setup>
// Admin: gestione utenti — modifica ruolo e data di scadenza abbonamento.
import { ref, onMounted } from 'vue';
import { api } from '@/lib/api';

const users = ref([]);
const loading = ref(true);
const savingId = ref(null);
const error = ref('');

const roleLabel = { admin: 'Admin', trainer: 'Trainer', member: 'Member' };

async function load() {
  loading.value = true;
  try {
    users.value = await api.get('/api/users');
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function save(u) {
  error.value = '';
  savingId.value = u.id;
  try {
    await api.patch(`/api/members/${u.id}`, {
      role: u.role,
      subscription_end_date: u.subscription_end_date || null,
    });
    u._saved = true;
    setTimeout(() => (u._saved = false), 1500);
  } catch (e) {
    error.value = e.message;
  } finally {
    savingId.value = null;
  }
}

onMounted(load);
</script>

<template>
  <div class="space-y-3">
    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{{ error }}</p>
    <p v-if="loading" class="text-sm text-gray-400">Caricamento utenti…</p>

    <ul v-else class="space-y-3">
      <li v-for="u in users" :key="u.id" class="rounded-2xl bg-white p-4 shadow-sm">
        <div class="mb-3">
          <p class="font-semibold text-gray-900">{{ u.full_name || 'Senza nome' }}</p>
          <p class="text-sm text-gray-500">{{ u.email }}</p>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="mb-1 block text-xs font-medium text-gray-500">Ruolo</label>
            <select
              v-model="u.role"
              class="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm focus:border-brand focus:outline-none"
            >
              <option v-for="(label, value) in roleLabel" :key="value" :value="value">
                {{ label }}
              </option>
            </select>
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-gray-500">Abbonamento fino al</label>
            <input
              v-model="u.subscription_end_date"
              type="date"
              class="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm focus:border-brand focus:outline-none"
            />
          </div>
        </div>

        <button
          :disabled="savingId === u.id"
          class="mt-3 w-full rounded-lg py-2 text-sm font-semibold text-white active:scale-95 disabled:opacity-60"
          :class="u._saved ? 'bg-emerald-500' : 'bg-brand'"
          @click="save(u)"
        >
          {{ savingId === u.id ? 'Salvataggio…' : u._saved ? 'Salvato ✔' : 'Salva' }}
        </button>
      </li>
    </ul>
  </div>
</template>
