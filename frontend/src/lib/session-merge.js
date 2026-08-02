// =====================================================
// Fusione dello stato di una sessione fra iPhone e Watch.
//
// Una serie completata è un FATTO con un timestamp, quindi la fusione è
// l'unione delle serie fatte, non una sovrascrittura. Tre regole:
//
//  1. `done` vince su non-`done` — rifare la stessa serie non significa nulla.
//  2. Se entrambi la riportano fatta, vince il `done_at` PIÙ VECCHIO con i
//     suoi valori: è il momento in cui la serie è realmente stata eseguita.
//  3. L'annullamento (`done: false`) è un'operazione SOLO iPhone e non passa
//     mai di qui, così non esiste un caso in cui i due lati si contraddicono
//     su un fatto già accaduto.
//
// Il timer di recupero NON è uno stato da fondere: è la scadenza derivata
// `done_at + rest_seconds`, che i due dispositivi calcolano identica.
//
// ⚠️ Queste tre regole sono replicate in Swift nel SessionStore del Watch.
// Modificandole qui vanno modificate anche lì, e i casi di prova sono gli
// stessi da entrambe le parti.
// =====================================================

/**
 * Applica un evento "serie completata" al log, senza mutare l'ingresso.
 *
 * @param {Array} exercisesLog  il log della sessione
 * @param {{uid: string, reps: number|null, load: number|null,
 *          incline?: number|null, done_at: string}} event
 * @returns {{ log: Array, changed: boolean }} `changed` false significa che
 *   l'evento non ha aggiunto nulla: il chiamante non deve persistere né
 *   ritrasmettere, altrimenti due dispositivi si rimbalzano lo stesso fatto
 *   all'infinito.
 */
export function mergeSetDone(exercisesLog, event) {
  const eventTime = event?.done_at ? Date.parse(event.done_at) : NaN;
  // Un `done_at` mancante o non parsabile viene scartato qui: se passasse,
  // finirebbe scritto in una riga come fatto compiuto e nessun evento
  // successivo potrebbe più correggerlo (la riga "done" vincerebbe sempre
  // il confronto sottostante, valori corrotti compresi).
  if (!Array.isArray(exercisesLog) || !event?.uid || Number.isNaN(eventTime)) {
    return { log: exercisesLog, changed: false };
  }

  let changed = false;
  const log = exercisesLog.map((ex) => {
    const sets = ex.sets_log || [];
    const i = sets.findIndex((r) => r.uid === event.uid);
    if (i < 0) return ex;

    const row = sets[i];
    if (row.done) {
      const rowTime = Date.parse(row.done_at);
      // Regola 2: chi è arrivato prima nel tempo REALE vince, non chi ha
      // parlato per ultimo. L'evento qui è già garantito valido dalla
      // guardia d'ingresso sopra. Una riga "done" con `done_at` mancante o
      // non parsabile (`rowTime` NaN) non ha invece nessuna pretesa
      // difendibile di vincere: se la lasciassimo vincere per il solito
      // "confronto con NaN è falso", una riga corrotta resterebbe bloccata
      // per sempre. Un evento valido la corregge sempre.
      if (!Number.isNaN(rowTime) && !(eventTime < rowTime)) {
        return ex;
      }
    }

    changed = true;
    const merged = {
      ...row,
      reps: event.reps ?? null,
      load: event.load ?? null,
      done: true,
      done_at: event.done_at,
    };
    // `incline` esiste solo per gli esercizi che la prevedono: non va
    // introdotta dove non c'era, o la riga cambia forma a metà sessione.
    if (event.incline !== undefined) merged.incline = event.incline;

    const sets_log = [...sets];
    sets_log[i] = merged;
    return { ...ex, sets_log };
  });

  return changed ? { log, changed: true } : { log: exercisesLog, changed: false };
}
