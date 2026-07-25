<script setup>
// Intestazione delle dashboard: identità dell'utente loggato
// (foto, nome, email, ruolo). Legge direttamente lo store auth, così
// è riutilizzabile in tutte le dashboard senza passare props.
import { storeToRefs } from 'pinia';
import { useAuthStore } from '@/stores/auth';

const { fullName, role, user } = storeToRefs(useAuthStore());

const roleLabel = { admin: 'Amministratore', trainer: 'Istruttore', member: 'Cliente' };
</script>

<template>
  <section class="flex items-baseline gap-2 text-xs">
    <span class="shrink-0 font-semibold text-gray-900">{{ fullName }}</span>
    <span class="shrink-0 font-semibold text-brand">{{ roleLabel[role] || role }}</span>
    <span class="truncate text-gray-400">{{ user?.email }}</span>
  </section>
</template>
