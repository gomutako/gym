// =====================================================
// Notifica di fine recupero fra le serie (solo app iOS).
// Sul web ogni funzione è un no-op: è lo stesso schema di lib/healthkit.js e
// lib/native-tabbar.js, così le viste non devono sapere dove stanno girando.
//
// Sotto NON c'è @capacitor/local-notifications: la versione compatibile con
// Capacitor 6 non espone interruptionLevel, quindi la notifica non potrebbe
// essere Time Sensitive e una Full Immersion la silenzierebbe — cioè
// fallirebbe proprio nel caso che motiva la feature. Si passa da RestTimer,
// plugin Swift del progetto.
// =====================================================
import { Capacitor, registerPlugin } from '@capacitor/core';

const RestTimer = registerPlugin('RestTimer');

/** Vero solo nell'app iOS. */
export function isSupported() {
  return Capacitor.getPlatform() === 'ios';
}

/** Corpo della notifica: «Panca piana · serie 3 di 4». */
export function restBody(exerciseName, setNumber, setCount) {
  const nome = (exerciseName || 'Esercizio').trim();
  return `${nome} · serie ${setNumber} di ${setCount}`;
}

/**
 * Indice esercizio che arriva dalla query `?ex=`: viene da fuori, quindi va
 * ricondotto a un valore valido invece di fidarsene.
 */
export function clampExerciseIndex(raw, count) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || count <= 0) return 0;
  return Math.min(Math.max(n, 0), count - 1);
}

// Il permesso si chiede una volta sola: se l'utente nega, iOS non ripropone il
// dialogo e per decisione di progetto non gli si mostra alcun messaggio.
let permission = null; // null = mai chiesto, true/false = esito

export async function ensurePermission() {
  if (!isSupported()) return false;
  if (permission !== null) return permission;
  try {
    const { granted } = await RestTimer.requestPermission();
    permission = !!granted;
  } catch {
    permission = false;
  }
  return permission;
}

/** Programma (sostituendola) l'unica notifica di fine recupero. */
export async function schedule({ seconds, body, sessionId, exerciseIndex }) {
  if (!isSupported()) return;
  await RestTimer.schedule({
    seconds,
    title: 'Recupero terminato',
    body,
    sessionId,
    exerciseIndex,
  });
}

export async function cancel() {
  if (!isSupported()) return;
  await RestTimer.cancel();
}

/** Tocco sulla notifica: handler({ sessionId, exerciseIndex }). */
export function onTap(handler) {
  if (!isSupported()) return;
  RestTimer.addListener('restTimerTapped', handler);
}
