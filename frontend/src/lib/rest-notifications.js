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

// Il plugin nativo gestisce UNA sola notifica alla volta (id costante): chi
// programma per ultimo sostituisce chi c'era prima, per design. Ma restEndsAt
// nella vista è per-riga: senza tener traccia lato JS di CHI possiede la
// notifica corrente, un cancel() invocato da una riga il cui recupero è nel
// frattempo scaduto cancellerebbe quella di un'altra riga che ha "vinto" nel
// frattempo (vedi CRITICAL 2 nella revisione). Questo stato vive qui e non
// nella vista perché è il modulo a conoscere e dover far rispettare
// l'invariante "una notifica sola" — che rispecchia l'id costante lato
// nativo — mentre SessionView tiene tutto il resto dello stato per-riga
// (restEndsAt) che non ha nulla a che vedere con la proprietà della
// notifica.
let owner = null; // chiave posizionale (`${indiceEsercizio}_${indiceSerie}`) della riga proprietaria, null = nessuna

/** Programma (sostituendola) l'unica notifica di fine recupero. */
export async function schedule({ seconds, body, sessionId, exerciseIndex, ownerKey }) {
  if (!isSupported()) return;
  // La proprietà passa a questa riga già ORA, prima di attendere l'esito:
  // lato nativo il pending precedente viene rimosso PRIMA di provare ad
  // aggiungere il nuovo (RestTimerPlugin.schedule), quindi anche se l'add
  // fallisse non resterebbe comunque nulla da proteggere per il vecchio
  // proprietario.
  owner = ownerKey;
  await RestTimer.schedule({
    seconds,
    title: 'Recupero terminato',
    body,
    sessionId,
    exerciseIndex,
  });
}

/**
 * Annulla la notifica pendente. Con `ownerKey` l'annullamento ha effetto solo
 * se corrisponde a chi possiede la notifica corrente (righe: chiudi il
 * recupero in anticipo / annulla la serie — non deve poter cancellare quella
 * di un'altra riga). Senza `ownerKey` (fine allenamento) annulla comunque:
 * a sessione conclusa nessuna notifica futura ha senso, chiunque l'abbia
 * programmata.
 */
export async function cancel(ownerKey) {
  if (!isSupported()) return;
  if (ownerKey !== undefined && ownerKey !== owner) return;
  owner = null;
  await RestTimer.cancel();
}

/** Tocco sulla notifica: handler({ sessionId, exerciseIndex }). */
export function onTap(handler) {
  if (!isSupported()) return;
  RestTimer.addListener('restTimerTapped', handler);
}
