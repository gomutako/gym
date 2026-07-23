<script setup>
// Mostra la dashboard corretta in base al ruolo dell'utente.
// (La dashboard Admin arriverà nella fase successiva.)
import { useAuthStore } from '@/stores/auth';
import MemberDashboard from '@/views/member/DashboardView.vue';
import TrainerDashboard from '@/views/trainer/DashboardView.vue';
import AdminDashboard from '@/views/admin/DashboardView.vue';

const auth = useAuthStore();
</script>

<template>
  <AdminDashboard v-if="auth.role === 'admin'" />
  <TrainerDashboard v-else-if="auth.role === 'trainer'" />
  <MemberDashboard v-else />
</template>
