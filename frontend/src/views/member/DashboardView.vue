<script setup>
// Dashboard del cliente (Member):
//  - stato abbonamento (attivo/scaduto)
//  - le mie prossime prenotazioni (dal backend Fastify)
//  - la mia scheda di allenamento (letta da Supabase, protetta da RLS)
import { ref, computed, onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import { useAuthStore } from '@/stores/auth';
import { supabase } from '@/lib/supabase';
import { api } from '@/lib/api';
import { exerciseImageUrl } from '@/lib/storage';
import Combobox from '@/components/Combobox.vue';
import ActivityStats from '@/components/ActivityStats.vue';

const auth = useAuthStore();
const { fullName, isSubscriptionActive, profile, user } = storeToRefs(auth);

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

// Formatta il recupero: 90 -> "1'30\"", 120 -> "2'"
function formatRest(seconds) {
  if (seconds == null) return '';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m ? m + "'" : ''}${s ? s + '"' : (m ? '' : '0"')}`;
}

function formatDate(iso) {
  return new Date(iso).toLocaleString('it-IT', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

onMounted(async () => {
  try {
    // Prenotazioni + sessioni: via backend
    [bookings.value, sessions.value] = await Promise.all([
      api.get('/api/bookings'),
      api.get('/api/sessions'),
    ]);

    // Schede: lettura diretta da Supabase (RLS: il member vede solo le proprie)
    // + catalogo esercizi per risolvere nome, immagine e descrizione
    const [{ data }, cat] = await Promise.all([
      supabase
        .from('workouts')
        .select('*')
        .eq('member_id', user.value.id)
        .order('created_at', { ascending: false }),
      supabase.from('exercises').select('id, name, muscle_group, image_path, description, video_url, load_type'),
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
    <p class="text-gray-600">Ciao, <span class="font-semibold">{{ fullName }}</span> 👋</p>

    <!-- Stato abbonamento -->
    <section
      class="rounded-2xl p-4 text-white shadow-sm"
      :class="isSubscriptionActive ? 'bg-emerald-500' : 'bg-rose-500'"
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

      <div v-if="currentScheda" class="space-y-4">
        <p v-if="currentScheda.title" class="font-semibold text-brand">{{ currentScheda.title }}</p>

        <!-- Giornate -->
        <div v-for="(day, di) in currentScheda.days_json" :key="di" class="space-y-2">
          <p class="text-sm font-semibold uppercase tracking-wide text-gray-500">
            {{ day.name || 'Giornata ' + (di + 1) }}
          </p>

          <div
            v-for="(ex, i) in day.exercises"
            :key="i"
            class="flex gap-3 rounded-xl bg-white p-3 shadow-sm"
          >
            <!-- Immagine esplicativa (condivisa per tipo) -->
            <div class="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-gray-100">
              <img
                v-if="catalogById[ex.exercise_id]?.image_path"
                :src="exerciseImageUrl(catalogById[ex.exercise_id].image_path)"
                :alt="catalogById[ex.exercise_id]?.name"
                class="h-full w-full object-cover"
              />
              <div v-else class="flex h-full items-center justify-center text-2xl">🏋️</div>
            </div>

            <div class="min-w-0 flex-1">
              <p class="font-medium text-gray-900">
                {{ catalogById[ex.exercise_id]?.name || 'Esercizio' }}
              </p>
              <p v-if="catalogById[ex.exercise_id]?.muscle_group" class="text-xs font-semibold text-brand">
                {{ catalogById[ex.exercise_id].muscle_group }}
              </p>
              <p class="text-sm text-gray-500">
                <template v-if="catalogById[ex.exercise_id]?.load_type === 'level'">
                  {{ ex.sets > 1 ? ex.sets + '×' : '' }}{{ ex.reps }} min · rec. {{ formatRest(ex.rest_seconds) }}
                </template>
                <template v-else>
                  {{ ex.sets }} serie × {{ ex.reps }} ripetizioni · rec. {{ formatRest(ex.rest_seconds) }}
                </template>
              </p>
              <p v-if="catalogById[ex.exercise_id]?.description" class="mt-1 text-xs text-gray-400">
                {{ catalogById[ex.exercise_id].description }}
              </p>
              <a
                v-if="catalogById[ex.exercise_id]?.video_url"
                :href="catalogById[ex.exercise_id].video_url"
                target="_blank" rel="noopener"
                class="mt-1 inline-block text-xs font-semibold text-brand"
              >
                ▶ Guarda il video
              </a>
            </div>
          </div>
        </div>

        <p v-if="currentScheda.notes" class="px-1 text-sm italic text-gray-500">
          {{ currentScheda.notes }}
        </p>
      </div>
      <p v-else class="rounded-xl bg-white p-4 text-sm text-gray-400 shadow-sm">
        Nessuna scheda assegnata dal tuo trainer.
      </p>
    </section>
  </div>
</template>
