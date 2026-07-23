<script setup>
// Login e registrazione (toggle). Mobile-first, centrato.
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const router = useRouter();
const auth = useAuthStore();

const mode = ref('login'); // 'login' | 'register'
const email = ref('');
const password = ref('');
const fullName = ref('');
const error = ref('');
const loading = ref(false);

async function submit() {
  error.value = '';
  loading.value = true;
  try {
    if (mode.value === 'login') {
      await auth.login(email.value, password.value);
    } else {
      await auth.register(email.value, password.value, fullName.value);
    }
    router.push({ name: 'dashboard' });
  } catch (e) {
    error.value = e.message || 'Si è verificato un errore';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-gray-50 px-6">
    <div class="w-full max-w-sm">
      <div class="mb-8 text-center">
        <div class="text-4xl">🏋️</div>
        <h1 class="mt-2 text-2xl font-bold text-gray-900">Gym Manager</h1>
        <p class="text-sm text-gray-500">
          {{ mode === 'login' ? 'Accedi al tuo account' : 'Crea un nuovo account' }}
        </p>
      </div>

      <form class="space-y-4" @submit.prevent="submit">
        <div v-if="mode === 'register'">
          <label class="mb-1 block text-sm font-medium text-gray-700">Nome completo</label>
          <input
            v-model="fullName"
            type="text"
            required
            class="w-full rounded-xl border border-gray-300 px-4 py-3 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium text-gray-700">Email</label>
          <input
            v-model="email"
            type="email"
            required
            autocomplete="email"
            class="w-full rounded-xl border border-gray-300 px-4 py-3 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium text-gray-700">Password</label>
          <input
            v-model="password"
            type="password"
            required
            minlength="6"
            autocomplete="current-password"
            class="w-full rounded-xl border border-gray-300 px-4 py-3 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
        </div>

        <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {{ error }}
        </p>

        <button
          type="submit"
          :disabled="loading"
          class="w-full rounded-xl bg-brand py-3 font-semibold text-white transition active:scale-95 disabled:opacity-60"
        >
          {{ loading ? 'Attendere…' : mode === 'login' ? 'Accedi' : 'Registrati' }}
        </button>
      </form>

      <p class="mt-6 text-center text-sm text-gray-500">
        {{ mode === 'login' ? 'Non hai un account?' : 'Hai già un account?' }}
        <button
          class="font-semibold text-brand"
          @click="mode = mode === 'login' ? 'register' : 'login'; error = ''"
        >
          {{ mode === 'login' ? 'Registrati' : 'Accedi' }}
        </button>
      </p>
    </div>
  </div>
</template>
