<script setup>
// Admin: gestione palinsesto corsi — crea, modifica, elimina.
import { ref, onMounted, computed } from 'vue';
import { api } from '@/lib/api';
import Modal from '@/components/Modal.vue';
import Combobox from '@/components/Combobox.vue';

const classes = ref([]);
const trainers = ref([]);
const loading = ref(true);
const saving = ref(false);
const error = ref('');

// Stato del form (editId null = creazione), mostrato in un pop-up modale
const editId = ref(null);
const form = ref(emptyForm());
const formOpen = ref(false);

function emptyForm() {
  return { name: '', description: '', trainer_id: '', start_time: '', max_capacity: 10 };
}

const isEditing = computed(() => editId.value !== null);

// Opzioni per la combobox trainer (vuoto = nessun trainer, via "svuota")
const trainerOptions = computed(() =>
  trainers.value.map((t) => ({ value: t.id, label: t.full_name }))
);

// Conversioni tra ISO (API) e input datetime-local
function isoToLocalInput(iso) {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); // compensa il fuso per il campo
  return d.toISOString().slice(0, 16);
}
function formatDate(iso) {
  return new Date(iso).toLocaleString('it-IT', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}
function trainerName(id) {
  return trainers.value.find((t) => t.id === id)?.full_name || '—';
}

async function load() {
  loading.value = true;
  try {
    const [cls, users] = await Promise.all([
      api.get('/api/classes'),
      api.get('/api/users'),
    ]);
    classes.value = cls;
    trainers.value = users.filter((u) => u.role === 'trainer');
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  editId.value = null;
  form.value = emptyForm();
  error.value = '';
  formOpen.value = true;
}

function startEdit(c) {
  editId.value = c.id;
  form.value = {
    name: c.name,
    description: c.description || '',
    trainer_id: c.trainer_id || '',
    start_time: isoToLocalInput(c.start_time),
    max_capacity: c.max_capacity,
  };
  error.value = '';
  formOpen.value = true;
}

function closeForm() {
  formOpen.value = false;
  editId.value = null;
  form.value = emptyForm();
}

async function submit() {
  error.value = '';
  saving.value = true;
  try {
    const payload = {
      name: form.value.name,
      description: form.value.description || null,
      trainer_id: form.value.trainer_id || null,
      start_time: new Date(form.value.start_time).toISOString(),
      max_capacity: Number(form.value.max_capacity),
    };
    if (isEditing.value) {
      await api.patch(`/api/classes/${editId.value}`, payload);
    } else {
      await api.post('/api/classes', payload);
    }
    closeForm();
    await load();
  } catch (e) {
    error.value = e.message;
  } finally {
    saving.value = false;
  }
}

async function remove(id) {
  if (!confirm('Eliminare questo corso? Le prenotazioni collegate verranno rimosse.')) return;
  error.value = '';
  try {
    await api.del(`/api/classes/${id}`);
    if (editId.value === id) closeForm();
    await load();
  } catch (e) {
    error.value = e.message;
  }
}

onMounted(load);
</script>

<template>
  <div class="space-y-5">
    <p v-if="error && !formOpen" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{{ error }}</p>

    <!-- Toolbar: titolo e azione sulla stessa riga, come in Modelli -->
    <div class="flex items-center justify-between">
      <h1 class="text-lg font-bold text-gray-900">Corsi</h1>
      <button
        class="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white active:scale-95"
        @click="openCreate"
      >
        + Nuovo corso
      </button>
    </div>

    <!-- Form crea/modifica in pop-up -->
    <Modal
      :open="formOpen"
      :title="isEditing ? 'Modifica corso' : 'Nuovo corso'"
      @close="closeForm"
    >
      <p v-if="error" class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{{ error }}</p>
      <form class="space-y-3" @submit.prevent="submit">
        <div>
          <label class="mb-1 block text-xs font-medium text-gray-500">Nome corso</label>
          <input
            v-model="form.name"
            required placeholder="Es. Spinning"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
          />
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-gray-500">Descrizione</label>
          <input
            v-model="form.description"
            placeholder="Opzionale"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
          />
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-gray-500">Trainer</label>
          <Combobox
            v-model="form.trainer_id"
            :options="trainerOptions"
            dense
            placeholder="Nessun trainer — cerca…"
            empty-text="Nessun trainer trovato"
          />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="mb-1 block text-xs font-medium text-gray-500">Data e ora</label>
            <input
              v-model="form.start_time"
              type="datetime-local" required
              class="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm focus:border-brand focus:outline-none"
            />
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-gray-500">Capienza</label>
            <input
              v-model.number="form.max_capacity"
              type="number" min="1" required
              class="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm focus:border-brand focus:outline-none"
            />
          </div>
        </div>

        <div class="flex gap-2">
          <button
            type="button"
            class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-600"
            @click="closeForm"
          >
            Annulla
          </button>
          <button
            type="submit" :disabled="saving"
            class="flex-1 rounded-lg bg-brand py-2 text-sm font-semibold text-white active:scale-95 disabled:opacity-60"
          >
            {{ saving ? 'Salvataggio…' : isEditing ? 'Aggiorna' : 'Crea corso' }}
          </button>
        </div>
      </form>
    </Modal>

    <!-- Lista corsi -->
    <section>
      <h2 class="mb-2 font-semibold text-gray-900">Corsi in programma</h2>
      <p v-if="loading" class="text-sm text-gray-400">Caricamento…</p>
      <p v-else-if="!classes.length" class="rounded-xl bg-white p-4 text-sm text-gray-400 shadow-sm">
        Nessun corso. Usa “+ Nuovo corso” per crearne uno.
      </p>
      <ul v-else class="space-y-2">
        <li v-for="c in classes" :key="c.id" class="rounded-xl bg-white p-4 shadow-sm">
          <div class="flex items-start justify-between gap-2">
            <div>
              <p class="font-medium text-gray-900">{{ c.name }}</p>
              <p class="text-sm text-gray-500">{{ formatDate(c.start_time) }}</p>
              <p class="text-xs text-gray-400">
                Trainer: {{ trainerName(c.trainer_id) }} · max {{ c.max_capacity }}
              </p>
            </div>
            <div class="flex shrink-0 gap-1">
              <button
                class="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-700"
                @click="startEdit(c)"
              >
                Modifica
              </button>
              <button
                class="rounded-lg bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-600"
                @click="remove(c.id)"
              >
                Elimina
              </button>
            </div>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>
