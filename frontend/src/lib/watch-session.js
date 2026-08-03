// =====================================================
// Consuma i messaggi accumulati dal Watch e li riversa su Supabase.
//
// Perché esiste come modulo a sé: la materializzazione può avvenire in due
// posti diversi (la lista allenamenti o la sessione aperta) e in momenti
// imprevedibili — l'app iPhone può essere stata chiusa per tutto
// l'allenamento. La logica è una sola e non appartiene a nessuna vista.
// =====================================================
import * as watch from '@/lib/watch';
import { mergeSetDone } from '@/lib/session-merge';
import { db } from '@/lib/data/client';
import {
  createSessionFromSnapshot, getSession, updateSession,
} from '@/lib/data/sessions';

/**
 * Traduce la chiave che il Watch usa per una sessione nell'id della riga.
 *
 * La chiave ha due origini: per una sessione nata al polso è il
 * `client_session_id` generato lì; per una sessione nata sull'iPhone e poi
 * adottata dal Watch è l'**id della riga**, perché quando l'iPhone l'ha aperta
 * nessun `client_session_id` esisteva. Senza questa risoluzione le serie
 * chiuse al polso su una sessione adottata verrebbero scartate in silenzio.
 */
async function resolveSessionId(key, memberId, cache) {
  if (cache[key] !== undefined) return cache[key];

  const { data } = await db()
    .from('workout_sessions')
    .select('id')
    .eq('member_id', memberId)
    .or(`id.eq.${key},client_session_id.eq.${key}`)
    .limit(1)
    .maybeSingle();

  cache[key] = data?.id ?? null;
  return cache[key];
}

/**
 * Svuota il buffer nativo e applica tutto in ordine.
 *
 * ⚠️ `watch.getState()` SVUOTA il buffer: se questa funzione fallisce a metà,
 * i messaggi già estratti sono persi. Per questo la sessione viene creata al
 * primo evento utile e ogni `set_done` viene persistito subito, invece di
 * accumulare e salvare alla fine.
 *
 * @returns {{ sessionId: string|null }} la sessione toccata, se ce n'è una.
 */
export async function drainWatchMessages(memberId) {
  if (!watch.isSupported()) return { sessionId: null };

  const state = await watch.getState();
  const pending = state.pending || [];
  if (!pending.length) return { sessionId: null };

  const cache = {};   // chiave del Watch -> id Supabase (null = introvabile)
  let touched = null;

  for (const msg of pending) {
    try {
      if (msg.type === 'session_started') {
        const session = await createSessionFromSnapshot({
          client_session_id: msg.client_session_id,
          workout_id: msg.workout_id,
          workout_title: msg.workout_title,
          day_index: msg.day_index,
          day_name: msg.day_name,
          started_at: msg.started_at,
          exercises_log: msg.exercises_log,
        }, memberId);
        cache[msg.client_session_id] = session.id;
        touched = session.id;
      } else if (msg.type === 'set_done') {
        const id = await resolveSessionId(msg.client_session_id, memberId, cache);
        if (!id) continue;
        const session = await getSession(id);
        const { log, changed } = mergeSetDone(session.exercises_log, {
          uid: msg.uid, reps: msg.reps, load: msg.load,
          ...(msg.incline !== undefined ? { incline: msg.incline } : {}),
          done_at: msg.done_at,
        });
        if (changed) await updateSession(id, { exercises_log: log });
        touched = id;
      } else if (msg.type === 'session_closed') {
        const id = await resolveSessionId(msg.client_session_id, memberId, cache);
        if (!id) continue;
        await updateSession(id, { completed_at: msg.completed_at });
        touched = id;
      }
    } catch {
      // Un messaggio che non si riesce ad applicare non deve bloccare gli
      // altri: perdere una serie è meglio che perdere l'allenamento.
    }
  }

  return { sessionId: touched };
}
