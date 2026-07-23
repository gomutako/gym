<script setup>
// Profilo utente: dati principali + logout.
import { useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import { useAuthStore } from '@/stores/auth';

const router = useRouter();
const auth = useAuthStore();
const { fullName, role, user, isSubscriptionActive } = storeToRefs(auth);

const roleLabel = { admin: 'Amministratore', trainer: 'Istruttore', member: 'Cliente' };

async function logout() {
  await auth.logout();
  router.push({ name: 'login' });
}
</script>

<template>
  <div class="space-y-5">
    <div class="flex flex-col items-center rounded-2xl bg-white p-6 shadow-sm">
      <div class="flex h-20 w-20 items-center justify-center rounded-full bg-brand/10 text-3xl">
        👤
      </div>
      <p class="mt-3 text-lg font-bold text-gray-900">{{ fullName }}</p>
      <p class="text-sm text-gray-500">{{ user?.email }}</p>
      <span class="mt-2 rounded-full bg-brand/10 px-3 py-1 text-xs font-semibold text-brand">
        {{ roleLabel[role] || role }}
      </span>
    </div>

    <div class="rounded-2xl bg-white p-4 shadow-sm">
      <div class="flex items-center justify-between py-2">
        <span class="text-gray-600">Abbonamento</span>
        <span
          class="font-semibold"
          :class="isSubscriptionActive ? 'text-emerald-600' : 'text-rose-600'"
        >
          {{ isSubscriptionActive ? 'Attivo' : 'Scaduto' }}
        </span>
      </div>
    </div>

    <button
      class="w-full rounded-xl border border-rose-200 bg-rose-50 py-3 font-semibold text-rose-600 active:scale-95"
      @click="logout"
    >
      Esci
    </button>
  </div>
</template>
