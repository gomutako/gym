// =====================================================
// Store di autenticazione (Pinia, Composition API).
// Gestisce sessione Supabase, profilo utente e ruolo.
// =====================================================
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { supabase } from '@/lib/supabase';

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null); // utente Supabase (auth)
  const profile = ref(null); // riga della tabella profiles
  const loading = ref(true); // true finché non abbiamo ripristinato la sessione

  const isLoggedIn = computed(() => !!user.value);
  const role = computed(() => profile.value?.role ?? null);
  const fullName = computed(() => profile.value?.full_name || user.value?.email || '');

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
  async function register(email, password, fullNameValue) {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullNameValue } }, // finisce in raw_user_meta_data -> trigger
    });
    if (error) throw error;
    const { data } = await supabase.auth.getSession();
    user.value = data.session?.user ?? null;
    await fetchProfile();
  }

  async function logout() {
    await supabase.auth.signOut();
    user.value = null;
    profile.value = null;
  }

  return {
    user, profile, loading,
    isLoggedIn, role, fullName, isSubscriptionActive,
    init, fetchProfile, login, register, logout,
  };
});
