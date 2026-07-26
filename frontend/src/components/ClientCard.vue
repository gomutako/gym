<script setup>
// Card con i dati di un cliente (member): avatar, contatti, abbonamento e
// dati fisici sintetici. Usata in testa alle schede del cliente (trainer).
import { computed } from 'vue';
import { avatarUrl } from '@/lib/storage';
import { computeBmi, bmiCategory, computeAge, GENDER_LABEL } from '@/lib/body';

const props = defineProps({
  member: { type: Object, required: true },
});

const avatar = computed(() => avatarUrl(props.member.avatar_path));
const age = computed(() => computeAge(props.member.birth_date));
const bmi = computed(() => computeBmi(props.member.height_cm, props.member.weight_kg));

const subStatus = computed(() => {
  const end = props.member.subscription_end_date;
  if (!end) return 'nessuno';
  return end >= new Date().toISOString().slice(0, 10) ? 'attivo' : 'scaduto';
});
const statusLabel = { attivo: 'Attivo', scaduto: 'Scaduto', nessuno: 'Nessun abbonamento' };
const statusClass = {
  attivo: 'bg-emerald-100 text-emerald-700',
  scaduto: 'bg-red-100 text-red-700',
  nessuno: 'bg-gray-100 text-gray-500',
};

const hasPhysical = computed(() =>
  !!(props.member.gender || age.value != null || props.member.height_cm || props.member.weight_kg)
);
</script>

<template>
  <section class="rounded-2xl bg-white p-4 shadow-sm">
    <div class="flex items-center gap-3">
      <div class="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand/10 text-2xl">
        <img v-if="avatar" :src="avatar" alt="" class="h-full w-full object-cover" />
        <template v-else>👤</template>
      </div>
      <div class="min-w-0 flex-1">
        <p class="truncate text-lg font-bold text-gray-900">{{ member.full_name || 'Cliente' }}</p>
        <p v-if="member.email" class="truncate text-sm text-gray-500">{{ member.email }}</p>
        <p v-if="member.phone" class="truncate text-sm text-gray-500">{{ member.phone }}</p>
      </div>
      <span class="shrink-0 self-start rounded-full px-2 py-0.5 text-[10px] font-semibold" :class="statusClass[subStatus]">
        {{ statusLabel[subStatus] }}
      </span>
    </div>

    <!-- Dati fisici sintetici -->
    <div v-if="hasPhysical" class="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-gray-100 pt-3 text-xs text-gray-500">
      <span v-if="member.gender"><span class="text-gray-400">Genere:</span> {{ GENDER_LABEL[member.gender] || member.gender }}</span>
      <span v-if="age != null"><span class="text-gray-400">Età:</span> {{ age }} anni</span>
      <span v-if="member.height_cm"><span class="text-gray-400">Altezza:</span> {{ member.height_cm }} cm</span>
      <span v-if="member.weight_kg"><span class="text-gray-400">Peso:</span> {{ member.weight_kg }} kg</span>
      <span v-if="bmi != null"><span class="text-gray-400">BMI:</span> {{ bmi }} ({{ bmiCategory(bmi) }})</span>
    </div>
  </section>
</template>
