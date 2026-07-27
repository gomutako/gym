// =====================================================
// Livello dati — profili e anagrafica.
// Sostituisce le rotte backend:
//   GET   /api/profile              -> getOwnProfile()
//   PATCH /api/profile              -> updateOwnProfile()
//   GET   /api/members              -> listMembers()
//   GET   /api/users                -> listUsers()
//   PATCH /api/members/:id (ruolo)  -> updateUserRole()
//
// Le rotte /api/members e /api/users esistevano solo per unire l'email da
// auth.users: ora `profiles.email` è mantenuta dai trigger (migration
// 20260727130000), quindi sono letture RLS dirette.
//
// Chi vede cosa lo decide la RLS, non questo modulo: `profiles_select` dà al
// member la propria riga e a trainer/admin tutte. Un member che chiamasse
// listMembers() otterrebbe al massimo se stesso.
// =====================================================
// Import con estensione esplicita: Vite la accetta, Node la RICHIEDE — ed è ciò
// che permette agli e2e usa-e-getta di importare questo file così com'è.
import { db, unwrap } from './client.js';

// Campi anagrafici che il MEMBER può scrivere sulla propria riga. `role`,
// `subscription_end_date` ed `email` sono esclusi di proposito: li rifiuta il
// guard trigger sul database, qui evitiamo di inviarli del tutto.
const OWN_EDITABLE = [
  'first_name', 'last_name', 'phone', 'avatar_path',
  'gender', 'birth_date', 'height_cm', 'weight_kg', 'notes',
];

// Colonne dell'anagrafica cliente usata da trainer/admin
const MEMBER_FIELDS =
  'id, full_name, first_name, last_name, email, phone, avatar_path, gender, birth_date, height_cm, weight_kg, notes, subscription_end_date';

/** Profilo dell'utente corrente. */
export async function getOwnProfile(userId) {
  return unwrap(
    await db().from('profiles').select('*').eq('id', userId).single()
  );
}

/**
 * Aggiorna il PROPRIO profilo. `full_name` è una colonna generata da
 * first_name/last_name: si scrivono quelli, mai full_name.
 */
export async function updateOwnProfile(userId, fields) {
  const patch = {};
  for (const key of OWN_EDITABLE) {
    if (fields[key] !== undefined) patch[key] = fields[key];
  }
  if (Object.keys(patch).length === 0) {
    throw new Error('Nessun campo da aggiornare');
  }
  return unwrap(
    await db().from('profiles').update(patch).eq('id', userId).select().single()
  );
}

/** Elenco dei soli member (per assegnare schede, anagrafica clienti). */
export async function listMembers() {
  return unwrap(
    await db()
      .from('profiles')
      .select(MEMBER_FIELDS)
      .eq('role', 'member')
      .order('full_name', { ascending: true })
  );
}

/** Elenco completo degli utenti di ogni ruolo (vista admin). */
export async function listUsers() {
  return unwrap(
    await db()
      .from('profiles')
      .select('id, full_name, first_name, last_name, email, role, subscription_end_date')
      .order('role', { ascending: true })
  );
}

/** Cambia il ruolo di un utente (solo admin: lo impone la RLS + il guard). */
export async function updateUserRole(userId, role) {
  return unwrap(
    await db().from('profiles').update({ role }).eq('id', userId).select().single()
  );
}

/** Aggiorna nome/cognome di un utente qualsiasi (admin). */
export async function updateUserName(userId, { first_name, last_name }) {
  return unwrap(
    await db()
      .from('profiles')
      .update({ first_name, last_name })
      .eq('id', userId)
      .select()
      .single()
  );
}
