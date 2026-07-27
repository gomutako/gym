<script setup>
// Dashboard del cliente (Member):
//  - stato abbonamento (attivo/scaduto)
//  - le mie prossime prenotazioni (dal backend Fastify)
//  - la mia scheda di allenamento (letta da Supabase, protetta da RLS)
import { ref, computed, onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import { useAuthStore } from '@/stores/auth';
import { supabase } from '@/lib/supabase';
import { listOwnBookings } from '@/lib/data/bookings';
import { listOwnSessions } from '@/lib/data/sessions';
import WorkoutDays from '@/components/WorkoutDays.vue';
import Combobox from '@/components/Combobox.vue';
import IdentityCard from '@/components/IdentityCard.vue';
import ActivityStats from '@/components/ActivityStats.vue';

const auth = useAuthStore();
const { isSubscriptionActive, profile, user } = storeToRefs(auth);

const bookings = ref([]);
const sessions = ref([]);
const schede = ref([]);
const selectedSchedaId = ref('');
const catalog = ref([]);
const loading = ref(true);

// Mappa catalogo id -> esercizio, per risolvere nome/immagine/descrizione
const catalogById = computed(() =>
  Object.fromEntries(catalog.value.map((e) => [e.id, e]))
);

// Scheda attualmente mostrata (default: quella in uso, altrimenti la più recente)
const currentScheda = computed(
  () => schede.value.find((s) => s.id === selectedSchedaId.value) || null
);

// data breve per le sottoetichette (es. "24 lug 2026")
function shortDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Opzioni del combobox: schede dalla più recente (l'ordine arriva già desc dal
// backend); ★ marca quella in uso; sottoetichetta con date di creazione/modifica
const schedaOptions = computed(() =>
  schede.value.filter((s) => !s.archived).map((s) => {
    const updated = s.updated_at && s.updated_at !== s.created_at;
    return {
      value: s.id,
      label: `${s.is_active ? '★ ' : ''}${s.title || 'Senza titolo'} · ${(s.days_json || []).length} giornate`,
      sublabel: updated
        ? `Creata ${shortDate(s.created_at)} · agg. ${shortDate(s.updated_at)}`
        : `Creata ${shortDate(s.created_at)}`,
    };
  })
);

function formatDate(iso) {
  return new Date(iso).toLocaleString('it-IT', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

onMounted(async () => {
  try {
    // Prenotazioni + sessioni: lettura diretta da Supabase (RLS)
    [bookings.value, sessions.value] = await Promise.all([
      listOwnBookings(user.value.id),
      listOwnSessions(user.value.id),
    ]);

    // Schede: lettura diretta da Supabase (RLS: il member vede solo le proprie)
    // + catalogo esercizi per risolvere nome, immagine e descrizione
    const [{ data }, cat] = await Promise.all([
      supabase
        .from('workouts')
        .select('*')
        .eq('member_id', user.value.id)
        .order('created_at', { ascending: false }),
      supabase.from('exercises').select('id, name, muscle_group, image_path, description, video_url, load_type, equipment, level, mechanic, force, category, secondary_muscles'),
    ]);
    schede.value = data || [];
    // Default: la scheda in uso; in mancanza, la più recente non archiviata
    const active = schede.value.find((s) => s.is_active);
    const firstUsable = active || schede.value.find((s) => !s.archived);
    if (firstUsable) selectedSchedaId.value = firstUsable.id;
    catalog.value = cat.data || [];
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="space-y-5">
    <IdentityCard />

    <!-- Stato abbonamento -->
    <section
      class="rounded-2xl p-4 text-white shadow-sm"
      :class="isSubscriptionActive ? 'bg-emerald-500' : 'bg-red-500'"
    >
      <p class="text-sm opacity-90">Abbonamento</p>
      <p class="text-2xl font-bold">
        {{ isSubscriptionActive ? 'Attivo' : 'Scaduto' }}
      </p>
      <p v-if="profile?.subscription_end_date" class="mt-1 text-sm opacity-90">
        {{ isSubscriptionActive ? 'Valido fino al' : 'Scaduto il' }}
        {{ new Date(profile.subscription_end_date).toLocaleDateString('it-IT') }}
      </p>
      <p v-else class="mt-1 text-sm opacity-90">Nessun abbonamento attivo</p>
    </section>

    <!-- Prossime prenotazioni -->
    <section>
      <h2 class="mb-2 font-semibold text-gray-900">Le mie prenotazioni</h2>
      <p v-if="loading" class="text-sm text-gray-400">Caricamento…</p>
      <p v-else-if="!bookings.length" class="rounded-xl bg-white p-4 text-sm text-gray-400 shadow-sm">
        Nessuna prenotazione. Vai su <RouterLink :to="{ name: 'bookings' }" class="text-brand">Corsi</RouterLink> per prenotare.
      </p>
      <ul v-else class="space-y-2">
        <li
          v-for="b in bookings"
          :key="b.id"
          class="rounded-xl bg-white p-4 shadow-sm"
        >
          <p class="font-medium text-gray-900">{{ b.classes?.name }}</p>
          <p class="text-sm text-gray-500">{{ formatDate(b.classes?.start_time) }}</p>
        </li>
      </ul>
    </section>

    <!-- Statistiche attività -->
    <ActivityStats v-if="!loading" :sessions="sessions" :catalog="catalog" />

    <!-- Scheda di allenamento -->
    <section>
      <h2 class="mb-2 font-semibold text-gray-900">La mia scheda</h2>
      <!-- Selettore se ci sono più schede -->
      <div v-if="schede.length > 1" class="mb-3">
        <Combobox
          v-model="selectedSchedaId"
          :options="schedaOptions"
          :clearable="false"
          placeholder="Cerca scheda…"
          empty-text="Nessuna scheda trovata"
        />
      </div>

      <WorkoutDays
        v-if="currentScheda"
        :days="currentScheda.days_json"
        :catalog-by-id="catalogById"
        :title="currentScheda.title"
        :notes="currentScheda.notes"
      />
      <p v-else class="rounded-xl bg-white p-4 text-sm text-gray-400 shadow-sm">
        Nessuna scheda assegnata dal tuo trainer.
      </p>
    </section>
  </div>
</template>
