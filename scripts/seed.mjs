// =====================================================
// Seed dati demo per lo sviluppo locale.
// Crea utenti dei 3 ruoli, alcuni corsi e una scheda.
// Idempotente: se gli utenti esistono già, li riusa.
//   Esecuzione:  npm run seed
// =====================================================
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: fileURLToPath(new URL('../backend/.env', import.meta.url)) });

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const PASSWORD = 'password123';

// Crea (o recupera) un utente con ruolo, restituisce l'id
async function ensureUser(email, role, full_name) {
  const { data: list } = await admin.auth.admin.listUsers();
  const existing = list.users.find((u) => u.email === email);
  if (existing) return existing.id;

  const { data, error } = await admin.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true,
    user_metadata: { role, full_name },
  });
  if (error) throw error;
  return data.user.id;
}

const adminId = await ensureUser('admin@gym.local', 'admin', 'Alice Admin');
const trainerId = await ensureUser('trainer@gym.local', 'trainer', 'Toni Trainer');
const memberId = await ensureUser('member@gym.local', 'member', 'Marco Member');

// Abbonamento attivo per il member (+30 giorni)
const end = new Date();
end.setDate(end.getDate() + 30);
await admin
  .from('profiles')
  .update({ subscription_end_date: end.toISOString().slice(0, 10) })
  .eq('id', memberId);

// Corsi (reset di quelli demo per rendere lo script rieseguibile senza duplicati)
await admin.from('classes').delete().eq('trainer_id', trainerId);
const now = new Date();
const at = (days, hour) => {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};
await admin.from('classes').insert([
  { name: 'Spinning', description: 'Cardio ad alta intensità', trainer_id: trainerId, start_time: at(1, 18), max_capacity: 15 },
  { name: 'Yoga', description: 'Flessibilità e respirazione', trainer_id: trainerId, start_time: at(2, 10), max_capacity: 12 },
  { name: 'CrossFit', description: 'Forza e resistenza', trainer_id: trainerId, start_time: at(3, 19), max_capacity: 8 },
]);

// --- Catalogo esercizi + immagini segnaposto su Storage ---
// Genera una semplice immagine SVG "esplicativa" con il nome dell'esercizio
// e la carica nel bucket (in demo sostituisce una vera foto/animazione).
function placeholderSvg(label, color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">
    <rect width="400" height="300" fill="${color}"/>
    <text x="200" y="155" font-family="sans-serif" font-size="30" fill="#fff"
      text-anchor="middle">${label}</text>
  </svg>`;
}

const catalog = [
  { name: 'Squat', muscle_group: 'Gambe', color: '#4f46e5', load_type: 'weight',
    video_url: 'https://www.youtube.com/watch?v=aclHkVaku9U',
    description: 'Piedi larghezza spalle, schiena neutra. Scendi spingendo i fianchi indietro fino a coscia parallela, poi risali spingendo sui talloni.' },
  { name: 'Panca piana', muscle_group: 'Petto', color: '#059669', load_type: 'weight',
    video_url: 'https://www.youtube.com/watch?v=rT7DgCr-3pg',
    description: 'Scapole retratte, piedi a terra. Scendi il bilanciere al petto controllato, poi spingi verso l\'alto senza staccare i glutei.' },
  { name: 'Stacco da terra', muscle_group: 'Schiena', color: '#dc2626', load_type: 'weight',
    description: 'Bilanciere vicino alle tibie, schiena dritta. Estendi anche e ginocchia insieme mantenendo il core contratto.' },
  { name: 'Trazioni', muscle_group: 'Dorsali', color: '#d97706', load_type: 'weight',
    description: 'Presa prona poco più larga delle spalle. Tira i gomiti verso il basso portando il mento sopra la sbarra, controlla la discesa.' },
  { name: 'Tapis roulant', muscle_group: 'Cardio', color: '#0891b2', load_type: 'level', has_incline: true,
    description: 'Corsa a ritmo costante. Imposta il livello di difficoltà (velocità) e la pendenza indicati dalla scheda.' },
];

const exerciseIdByName = {};
for (const ex of catalog) {
  const path = `seed/${ex.name.toLowerCase().replace(/\s+/g, '-')}.svg`;
  // Upload immagine (upsert per rendere lo script rieseguibile)
  await admin.storage.from('exercise-images').upload(
    path,
    Buffer.from(placeholderSvg(ex.name, ex.color)),
    { contentType: 'image/svg+xml', upsert: true }
  );
  // Upsert voce catalogo per nome
  const { data } = await admin
    .from('exercises')
    .upsert(
      { name: ex.name, muscle_group: ex.muscle_group, description: ex.description, load_type: ex.load_type, has_incline: ex.has_incline ?? false, video_url: ex.video_url ?? null, image_path: path },
      { onConflict: 'name' }
    )
    .select()
    .single();
  exerciseIdByName[ex.name] = data.id;
}

// Scheda per il member: entità con titolo e GIORNATE
await admin.from('workouts').delete().eq('member_id', memberId);
await admin.from('workouts').insert({
  member_id: memberId,
  trainer_id: trainerId,
  title: 'Ipertrofia - Fase 1',
  notes: 'Progressione su 4 settimane, 2 sedute a settimana.',
  days_json: [
    {
      name: 'Giorno A — Spinta',
      exercises: [
        { exercise_id: exerciseIdByName['Squat'], sets: 4, reps: 10, rest_seconds: 120 },
        { exercise_id: exerciseIdByName['Panca piana'], sets: 4, reps: 8, rest_seconds: 90 },
      ],
    },
    {
      name: 'Giorno B — Tirata',
      exercises: [
        { exercise_id: exerciseIdByName['Stacco da terra'], sets: 3, reps: 6, rest_seconds: 150 },
        { exercise_id: exerciseIdByName['Trazioni'], sets: 3, reps: 8, rest_seconds: 90 },
        { exercise_id: exerciseIdByName['Tapis roulant'], sets: 1, reps: 20, rest_seconds: 60 },
      ],
    },
  ],
});

console.log('✅ Seed completato. Credenziali (password: %s):', PASSWORD);
console.log('   admin@gym.local | trainer@gym.local | member@gym.local');
