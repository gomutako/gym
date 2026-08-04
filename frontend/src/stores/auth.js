// =====================================================
// Store di autenticazione (Pinia, Composition API).
// Gestisce sessione Supabase, profilo utente e ruolo.
// =====================================================
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { supabase } from '@/lib/supabase';
import { updateOwnProfile } from '@/lib/data/profiles';
import * as watchLink from '@/lib/watch';

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null); // utente Supabase (auth)
  const profile = ref(null); // riga della tabella profiles
  const loading = ref(true); // true finché non abbiamo ripristinato la sessione

  const isLoggedIn = computed(() => !!user.value);
  const role = computed(() => profile.value?.role ?? null);
  const fullName = computed(() => profile.value?.full_name || user.value?.email || '');
  const firstName = computed(() => profile.value?.first_name || '');
  const lastName = computed(() => profile.value?.last_name || '');
  const phone = computed(() => profile.value?.phone || '');
  const avatarPath = computed(() => profile.value?.avatar_path || null);
  // Dati anagrafici/fisici
  const gender = computed(() => profile.value?.gender || '');
  const birthDate = computed(() => profile.value?.birth_date || '');
  const heightCm = computed(() => profile.value?.height_cm ?? null);
  const weightKg = computed(() => profile.value?.weight_kg ?? null);
  const notes = computed(() => profile.value?.notes || '');

  // Abbonamento attivo se la data di fine è oggi o futura
  const isSubscriptionActive = computed(() => {
    const end = profile.value?.subscription_end_date;
    if (!end) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return new Date(end) >= today;
  });

  // Carica il profilo dell'utente corrente (RLS: ognuno vede il proprio)
  async function fetchProfile() {
    if (!user.value) {
      profile.value = null;
      return;
    }
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.value.id)
      .single();
    profile.value = data;
  }

  // Ripristina la sessione all'avvio dell'app + ascolta i cambi di stato
  async function init() {
    const { data } = await supabase.auth.getSession();
    user.value = data.session?.user ?? null;
    await fetchProfile();
    loading.value = false;

    supabase.auth.onAuthStateChange((_event, session) => {
      // Guard su una TRANSIZIONE (c'era un utente, ora non c'è più), non su
      // un livello: onAuthStateChange spara anche sul refresh del token e
      // sul ripristino della sessione iniziale (l'evento che arriva subito
      // dopo questa sottoscrizione, con lo stesso stato appena letto da
      // getSession() sopra) — casi in cui l'utente resta loggato, e
      // cancellare lì butterebbe via uno stato adottabile valido sotto i
      // piedi di una sessione ancora attiva.
      //
      // Solo hadUser -> !user.value è un logout IMPLICITO: un refresh token
      // revocato o scaduto (device inattivo a lungo, password cambiata
      // altrove, "esci ovunque") fa sì che supabase-js chiami signOut() DA
      // SÉ e qui arrivi SIGNED_OUT senza che il codice applicativo abbia
      // mai chiamato logout() — quindi senza questo guard la pulizia di
      // watchlink-state.json introdotta lì (vedi logout() sotto) non
      // scatterebbe affatto per questo caso, che è più comune di un logout
      // esplicito o di una cancellazione account.
      const hadUser = !!user.value;
      user.value = session?.user ?? null;
      fetchProfile();
      if (hadUser && !user.value) {
        // Fire-and-forget come ovunque: un fallimento o una lentezza qui
        // non deve MAI poter impedire o rallentare l'uscita dell'utente,
        // che qui non è nemmeno un'azione dell'utente ma un evento
        // asincrono di supabase-js.
        watchLink.setSessionState(null).catch(() => {});
      }
    });
  }

  async function login(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    const { data } = await supabase.auth.getSession();
    user.value = data.session?.user ?? null;
    await fetchProfile();
  }

  // In locale la conferma email è disabilitata: la registrazione crea già la sessione.
  async function register(email, password, firstNameValue, lastNameValue) {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      // finiscono in raw_user_meta_data -> trigger handle_new_user
      options: { data: { first_name: firstNameValue, last_name: lastNameValue } },
    });
    if (error) throw error;
    const { data } = await supabase.auth.getSession();
    user.value = data.session?.user ?? null;
    await fetchProfile();
  }

  // Aggiorna il PROPRIO profilo (nome/telefono/avatar/dati fisici) e riallinea
  // lo stato locale con la riga restituita. I campi ammessi li filtra
  // updateOwnProfile; role, abbonamento ed email li rifiuta il database.
  async function updateProfile(fields) {
    const updated = await updateOwnProfile(user.value.id, fields);
    profile.value = updated;
    return updated;
  }

  // Invia l'email di recupero password. Il link riporta l'utente su
  // /reset-password con una sessione di recovery. Non fa errore se l'email
  // non esiste (evita l'enumerazione degli account).
  // NESSUN redirectTo di proposito: il link nell'email viene costruito dal
  // template lato Supabase con {{ .SiteURL }} (= https://pallade.it in
  // produzione), quindi punta sempre al dominio web. Passare
  // `${window.location.origin}/reset-password` — come si faceva prima —
  // produceva `capacitor://localhost/reset-password` quando la richiesta
  // partiva dall'app iOS: un link che nessun client di posta su iOS apre.
  async function sendPasswordReset(email) {
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) throw error;
  }

  // Imposta una nuova password per l'utente della sessione corrente
  // (usata dalla vista di reset dopo il link email).
  async function updatePassword(newPassword) {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
  }

  async function logout() {
    await supabase.auth.signOut();
    // Invariante: la copia nativa (watchlink-state.json, vedi watch.js) non
    // deve sopravvivere né alla riga che descrive né alla SESSIONE
    // dell'utente a cui appartiene. Il plugin nativo risponde a
    // `state_request` solo dal disco, senza sapere chi è loggato: su un
    // device condiviso o rivenduto, senza questa chiamata il prossimo
    // utente che apre l'app Watch si vedrebbe offrire "Riprendi" per un
    // allenamento di un altro account — nome giornata ed esercizi compresi,
    // non solo un id ormai orfano. Qui e non nelle viste: `logout()` è
    // l'UNICO punto da cui esce ogni sessione utente (diretto o dentro
    // ProfileView.confirmDelete), quindi è dove l'invariante va imposto una
    // volta sola invece che ad ogni chiamante.
    watchLink.setSessionState(null).catch(() => {});
    user.value = null;
    profile.value = null;
  }

  return {
    user, profile, loading,
    isLoggedIn, role, fullName, firstName, lastName, phone, avatarPath, isSubscriptionActive,
    gender, birthDate, heightCm, weightKg, notes,
    init, fetchProfile, login, register, logout, updateProfile,
    sendPasswordReset, updatePassword,
  };
});
