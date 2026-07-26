<script setup>
// Badge diagnostico della dashboard admin: collassato mostra un pallino e
// l'ambiente, espanso i dettagli. Vive solo nella dashboard admin, che è già
// riservata per ruolo: la protezione vera sta sulla rotta backend.
import { ref, computed, onMounted } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { collect, overallStatus } from '@/lib/diagnostics';

const auth = useAuthStore();
const data = ref(null);
const loading = ref(true);
const expanded = ref(false);

async function refresh() {
  loading.value = true;
  try {
    data.value = await collect(auth.role);
  } finally {
    loading.value = false;
  }
}

onMounted(refresh);

const status = computed(() => (data.value ? overallStatus(data.value) : null));

const dotClass = computed(() => ({
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  down: 'bg-red-500',
}[status.value] || 'bg-gray-300'));

const summary = computed(() => {
  if (!data.value) return 'Verifica in corso…';
  const env = data.value.environment.source === 'sim' ? 'Locale' : 'Cloud';
  const label = {
    ok: 'servizi ok',
    warn: 'da controllare',
    down: 'servizio non raggiungibile',
  }[status.value];
  return `${env} · ${label}`;
});

function fmtMs(ms) {
  return ms == null ? '—' : `${ms} ms`;
}

function fmtUptime(s) {
  if (s == null) return '—';
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
}

function fmtExpiry(date) {
  if (!date) return '—';
  return date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}
</script>

<template>
  <section class="rounded-2xl bg-white p-4 shadow-sm">
    <button
      type="button"
      class="flex w-full items-center gap-2 text-left"
      @click="expanded = !expanded"
    >
      <span class="h-2.5 w-2.5 shrink-0 rounded-full" :class="dotClass"></span>
      <span class="flex-1 text-sm font-medium text-gray-900">{{ summary }}</span>
      <span v-if="data" class="text-xs text-gray-400">v{{ data.environment.appVersion }}</span>
      <span class="text-xs text-gray-400">{{ expanded ? '⌃' : '⌄' }}</span>
    </button>

    <div v-if="expanded && data" class="mt-3 space-y-3 border-t border-gray-100 pt-3 text-xs">
      <!-- Backend -->
      <div>
        <div class="flex items-center justify-between">
          <span class="font-semibold text-gray-700">Backend</span>
          <span :class="data.backend.ok ? 'text-emerald-700' : 'text-red-700'">
            {{ data.backend.ok ? 'ok' : 'non raggiungibile' }} · {{ fmtMs(data.backend.latencyMs) }}
          </span>
        </div>
        <p class="text-gray-400">{{ data.backend.url }}</p>
        <p class="text-gray-500">
          versione {{ data.backend.version || '—' }} · attivo da {{ fmtUptime(data.backend.uptimeS) }}
        </p>
        <p v-if="data.backend.error" class="text-amber-700">⚠️ {{ data.backend.error }}</p>
      </div>

      <!-- Supabase -->
      <div>
        <div class="flex items-center justify-between">
          <span class="font-semibold text-gray-700">Supabase</span>
          <span :class="data.supabase.ok ? 'text-emerald-700' : 'text-red-700'">
            {{ data.supabase.ok ? 'ok' : 'non raggiungibile' }} · {{ fmtMs(data.supabase.latencyMs) }}
          </span>
        </div>
        <p class="text-gray-400">{{ data.supabase.url }}</p>
        <p v-if="data.supabase.error" class="text-red-700">{{ data.supabase.error }}</p>
      </div>

      <!-- Ambiente e sessione -->
      <div class="flex justify-between text-gray-500">
        <span>
          Ambiente
          {{ data.environment.source === 'sim' ? 'locale' : 'cloud' }}
          <template v-if="data.environment.isSimulator">(simulatore)</template>
        </span>
        <span>{{ data.session.role || '—' }} · scade {{ fmtExpiry(data.session.expiresAt) }}</span>
      </div>

      <button
        type="button"
        class="ml-auto block font-semibold text-brand active:scale-95"
        :disabled="loading"
        @click.stop="refresh"
      >
        {{ loading ? 'Verifico…' : 'Aggiorna' }}
      </button>
    </div>
  </section>
</template>
