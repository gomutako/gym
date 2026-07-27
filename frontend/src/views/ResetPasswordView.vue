<script setup>
// Reset password: raggiunta dal link nell'email di recupero.
//
// Flusso attuale — il template dell'email costruisce il link come
//   {{ .SiteURL }}/reset-password?token_hash=…&type=recovery
// e qui il token viene scambiato per una sessione di recovery con verifyOtp().
// Serve perché il vecchio flusso (ConfirmationURL + redirectTo) rimbalzava
// sull'origine del client: dentro l'app iOS è `capacitor://localhost`, che
// nessun client di posta su iOS sa aprire → utente bloccato.
//
// Flusso legacy — mantenuto come ripiego: se il link non porta un token_hash
// (email inviate prima del cambio di template, o link con la sessione nel
// fragment), vale ancora detectSessionInUrl + evento PASSWORD_RECOVERY.
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth';

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();

const ready = ref(false);       // sessione di recovery presente → form abilitato
const checking = ref(true);
const password = ref('');
const confirm = ref('');
const showPassword = ref(false);
const saving = ref(false);
const error = ref('');
const done = ref(false);

let sub = null;

onMounted(async () => {
  // --- Flusso attuale: token_hash nella query ---
  const tokenHash = route.query.token_hash;
  if (typeof tokenHash === 'string' && tokenHash) {
    const { error: verifyError } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: 'recovery',
    });
    checking.value = false;
    if (!verifyError) {
      ready.value = true;
      // Il token è monouso: fuori dall'URL, così non resta nella cronologia
      // né viene rigiocato da un ricaricamento della pagina.
      router.replace({ name: 'reset-password', query: {} });
    }
    // in caso di errore resta ready=false → la vista mostra "link non valido"
    return;
  }

  // --- Flusso legacy: sessione già stabilita o in arrivo via evento ---
  const { data } = await supabase.auth.getSession();
  if (data.session) ready.value = true;

  sub = supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY' || session) ready.value = true;
  }).data.subscription;

  // Dopo un attimo, se non c'è sessione il link è scaduto/non valido
  setTimeout(() => { checking.value = false; }, 1500);
});

onBeforeUnmount(() => sub?.unsubscribe());

async function submit() {
  error.value = '';
  if (password.value.length < 6) {
    error.value = 'La password deve avere almeno 6 caratteri';
    return;
  }
  if (password.value !== confirm.value) {
    error.value = 'Le due password non coincidono';
    return;
  }
  saving.value = true;
  try {
    await auth.updatePassword(password.value);
    done.value = true;
    // Dopo il reset l'utente è loggato; lo mandiamo alla dashboard
    setTimeout(() => router.push({ name: 'dashboard' }), 1200);
  } catch (e) {
    error.value = e.message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-gray-50 px-6">
    <div class="w-full max-w-sm">
      <div class="mb-8 text-center">
        <div class="text-4xl">🔒</div>
        <h1 class="mt-2 text-2xl font-bold text-gray-900">Nuova password</h1>
        <p class="text-sm text-gray-500">Scegli una nuova password per il tuo account</p>
      </div>

      <p v-if="done" class="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
        Password aggiornata ✔ Reindirizzamento…
      </p>

      <p v-else-if="!ready && !checking" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
        Link non valido o scaduto. Richiedi un nuovo reset dalla pagina di accesso.
      </p>

      <form v-else class="space-y-4" @submit.prevent="submit">
        <div>
          <label class="mb-1 block text-sm font-medium text-gray-700">Nuova password</label>
          <div class="relative">
            <input
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              required minlength="6" autocomplete="new-password"
              class="w-full rounded-xl border border-gray-300 px-4 py-3 pr-12 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
            <button
              type="button"
              class="absolute inset-y-0 right-2 flex items-center rounded p-1 text-gray-400 active:scale-90"
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
                <path d="M3 3l18 18" /><path d="M10.6 10.6a3 3 0 0 0 4.2 4.2" />
                <path d="M9.9 5.1A9.8 9.8 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.3 4.1" />
                <path d="M6.1 6.1A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 3.9-.8" />
              </svg>
            </button>
          </div>
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium text-gray-700">Conferma password</label>
          <input
            v-model="confirm"
            :type="showPassword ? 'text' : 'password'"
            required minlength="6" autocomplete="new-password"
            class="w-full rounded-xl border border-gray-300 px-4 py-3 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
        </div>

        <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</p>

        <button
          type="submit" :disabled="saving || !ready"
          class="w-full rounded-xl bg-brand py-3 font-semibold text-white transition active:scale-95 disabled:opacity-60"
        >
          {{ saving ? 'Salvataggio…' : 'Imposta password' }}
        </button>
      </form>

      <p class="mt-6 text-center text-sm text-gray-500">
        <RouterLink :to="{ name: 'login' }" class="font-semibold text-brand">Torna all'accesso</RouterLink>
      </p>
    </div>
  </div>
</template>
