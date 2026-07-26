<script setup>
// Login e registrazione (toggle). Mobile-first, centrato.
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const router = useRouter();
const auth = useAuthStore();

const mode = ref('login'); // 'login' | 'register' | 'forgot'
const resetSent = ref(false);
const email = ref('');
const password = ref('');
const showPassword = ref(false);
const firstName = ref('');
const lastName = ref('');
const error = ref('');
const loading = ref(false);

async function submit() {
  error.value = '';
  loading.value = true;
  try {
    if (mode.value === 'forgot') {
      await auth.sendPasswordReset(email.value);
      resetSent.value = true; // messaggio neutro: non riveliamo se l'email esiste
      return;
    }
    if (mode.value === 'login') {
      await auth.login(email.value, password.value);
    } else {
      await auth.register(email.value, password.value, firstName.value, lastName.value);
    }
    router.push({ name: 'dashboard' });
  } catch (e) {
    error.value = authErrorMessage(e);
  } finally {
    loading.value = false;
  }
}

// Traduce gli errori di Supabase Auth in messaggi leggibili.
// Necessario perché su errori di rete/gateway supabase-js incapsula l'errore
// con un message inutile (es. la stringa "{}"), che altrimenti finisce a schermo.
function authErrorMessage(e) {
  // Errori di rete/gateway (server irraggiungibile, 5xx, fetch fallito)
  if (e?.name === 'AuthRetryableFetchError' || e?.status >= 500 || e instanceof TypeError) {
    return 'Impossibile contattare il server. Controlla la connessione e riprova.';
  }

  const byCode = {
    invalid_credentials: 'Email o password non corretti.',
    email_not_confirmed: 'Email non ancora confermata. Controlla la tua casella.',
    user_already_exists: 'Esiste già un account con questa email.',
    email_exists: 'Esiste già un account con questa email.',
    weak_password: 'Password troppo debole: usa almeno 6 caratteri.',
    over_email_send_rate_limit: 'Troppi tentativi. Attendi qualche minuto e riprova.',
    validation_failed: 'Dati non validi. Controlla email e password.',
  };
  if (e?.code && byCode[e.code]) return byCode[e.code];

  // message valido? (non vuoto e non un oggetto serializzato tipo "{}")
  const msg = typeof e?.message === 'string' ? e.message.trim() : '';
  if (msg && msg !== '{}' && msg !== '[object Object]') return msg;

  return 'Si è verificato un errore. Riprova.';
}

function setMode(next) {
  mode.value = next;
  error.value = '';
  resetSent.value = false;
}
</script>

<template>
  <div class="relative flex min-h-screen items-center justify-center overflow-hidden bg-gray-50 px-6 py-10">
    <!-- Decorazioni sfocate (aurora) -->
    <div class="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-brand/30 blur-3xl"></div>
    <div class="pointer-events-none absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-brand-300/30 blur-3xl"></div>

    <div class="relative w-full max-w-sm">
      <!-- Logo + titolo -->
      <div class="mb-6 text-center">
        <div class="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-brand-400 shadow-lg shadow-brand/30">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
               stroke-linecap="round" stroke-linejoin="round" class="h-8 w-8 text-white">
            <path d="M4 9v6M7 7v10M17 7v10M20 9v6M7 12h10" />
          </svg>
        </div>
        <h1 class="mt-4 text-2xl font-bold tracking-tight text-gray-900">Gym Manager</h1>
        <p class="text-sm text-gray-500">
          {{ mode === 'login' ? 'Accedi al tuo account' : mode === 'register' ? 'Crea un nuovo account' : 'Recupera la password' }}
        </p>
      </div>

      <!-- Card form -->
      <div class="rounded-3xl bg-white p-6 shadow-xl shadow-gray-900/5 ring-1 ring-gray-100">
      <p v-if="mode === 'forgot' && resetSent" class="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
        Se l'email è registrata, riceverai un link per reimpostare la password. Controlla anche lo spam.
      </p>

      <form v-if="!(mode === 'forgot' && resetSent)" class="space-y-4" @submit.prevent="submit">
        <div v-if="mode === 'register'" class="grid grid-cols-2 gap-3">
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-700">Nome</label>
            <input
              v-model="firstName"
              type="text"
              required
              class="w-full rounded-xl border border-gray-300 px-4 py-3 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-700">Cognome</label>
            <input
              v-model="lastName"
              type="text"
              required
              class="w-full rounded-xl border border-gray-300 px-4 py-3 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>
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

        <div v-if="mode !== 'forgot'">
          <div class="mb-1 flex items-center justify-between">
            <label class="block text-sm font-medium text-gray-700">Password</label>
            <button
              v-if="mode === 'login'"
              type="button" class="text-xs font-semibold text-brand"
              @click="setMode('forgot')"
            >
              Password dimenticata?
            </button>
          </div>
          <div class="relative">
            <input
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              required
              minlength="6"
              autocomplete="current-password"
              class="w-full rounded-xl border border-gray-300 px-4 py-3 pr-12 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
            <button
              type="button"
              class="absolute inset-y-0 right-2 flex items-center rounded p-1 text-gray-400 active:scale-90"
              :title="showPassword ? 'Nascondi password' : 'Mostra password'"
              :aria-label="showPassword ? 'Nascondi password' : 'Mostra password'"
              :aria-pressed="showPassword"
              @click="showPassword = !showPassword"
            >
              <svg v-if="!showPassword" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                   stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" />
              </svg>
              <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                   stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5">
                <path d="M3 3l18 18" />
                <path d="M10.6 10.6a3 3 0 0 0 4.2 4.2" />
                <path d="M9.9 5.1A9.8 9.8 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.3 4.1" />
                <path d="M6.1 6.1A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 3.9-.8" />
              </svg>
            </button>
          </div>
        </div>

        <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {{ error }}
        </p>

        <button
          type="submit"
          :disabled="loading"
          class="w-full rounded-xl bg-gradient-to-r from-brand to-brand-400 py-3 font-semibold text-white shadow-lg shadow-brand/25 transition hover:brightness-105 active:scale-95 disabled:opacity-60"
        >
          {{ loading ? 'Attendere…' : mode === 'login' ? 'Accedi' : mode === 'register' ? 'Registrati' : 'Invia link di recupero' }}
        </button>
      </form>

      <p v-if="mode === 'forgot'" class="mt-6 text-center text-sm text-gray-500">
        <button class="font-semibold text-brand" @click="setMode('login')">‹ Torna all'accesso</button>
      </p>
      <p v-else class="mt-6 text-center text-sm text-gray-500">
        {{ mode === 'login' ? 'Non hai un account?' : 'Hai già un account?' }}
        <button
          class="font-semibold text-brand"
          @click="setMode(mode === 'login' ? 'register' : 'login')"
        >
          {{ mode === 'login' ? 'Registrati' : 'Accedi' }}
        </button>
      </p>
      </div>
    </div>
  </div>
</template>
