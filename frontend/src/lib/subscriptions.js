// Helper condivisi per gli abbonamenti (periodi inizio→fine).
// Stato di un periodo rispetto a oggi.

function todayKey() {
  return new Date().toISOString().slice(0, 10); // confronto lessicografico su 'YYYY-MM-DD'
}

// 'active' | 'expired' | 'scheduled'
export function subStatus(sub, today = todayKey()) {
  if (sub.end_date < today) return 'expired';
  if (sub.start_date > today) return 'scheduled';
  return 'active';
}

export const SUB_STATUS_LABEL = {
  active: 'Attivo',
  expired: 'Scaduto',
  scheduled: 'Programmato',
};

// Ordine per l'ordinamento "per stato": attivo, programmato, scaduto
export const SUB_STATUS_RANK = { active: 0, scheduled: 1, expired: 2 };

export function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
}
