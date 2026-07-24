// =====================================================
// Store di autenticazione (Pinia, Composition API).
// Gestisce sessione Supabase, profilo utente e ruolo.
// =====================================================
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { supabase } from '@/lib/supabase';
import { api } from '@/lib/api';

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
      user.value = session?.user ?? null;
      fetchProfile();
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

  // Aggiorna il PROPRIO profilo (nome/telefono/avatar) via backend e
  // riallinea lo stato locale con la riga restituita.
  async function updateProfile(fields) {
    const updated = await api.patch('/api/profile', fields);
    profile.value = updated;
    return updated;
  }

  // Invia l'email di recupero password. Il link riporta l'utente su
  // /reset-password con una sessione di recovery. Non fa errore se l'email
  // non esiste (evita l'enumerazione degli account).
  async function sendPasswordReset(email) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
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
    user.value = null;
    profile.value = null;
  }

  return {
    user, profile, loading,
    isLoggedIn, role, fullName, firstName, lastName, phone, avatarPath, isSubscriptionActive,
    init, fetchProfile, login, register, logout, updateProfile,
    sendPasswordReset, updatePassword,
  };
});
