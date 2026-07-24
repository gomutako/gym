// =====================================================
// Seed dati demo per lo sviluppo locale.
// Crea le 3 utenze dei ruoli, alcuni corsi, un catalogo di 50 esercizi/macchine
// comuni (con immagine segnaposto) e una scheda di esempio per il member.
// Idempotente: se utenti/esercizi esistono già, li riusa/aggiorna.
//   Esecuzione:  npm run seed   (di norma dopo `npm run db:reset`)
// =====================================================
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

// --- Scelta del target: LOCALE (default) o CLOUD (--cloud / SEED_TARGET=cloud) ---
// Il seeder usa l'API HTTPS di Supabase (non la connessione Postgres diretta),
// quindi funziona anche contro il Cloud (nessun problema IPv6 come `db push`).
const useCloud = process.argv.includes('--cloud') || process.env.SEED_TARGET === 'cloud';
const envFile = useCloud ? '../backend/.env.production' : '../backend/.env';

// Le variabili già esportate nell'ambiente hanno la precedenza (dotenv non le
// sovrascrive): puoi quindi anche fare
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed.mjs --yes
dotenv.config({ path: fileURLToPath(new URL(envFile, import.meta.url)) });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(`❌ Mancano SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (cercati in ${envFile} o nell'ambiente).`);
  process.exit(1);
}

// Guardia anti-incidente: su un DB REMOTO si procede solo con conferma esplicita.
const isLocal = /127\.0\.0\.1|localhost/.test(SUPABASE_URL);
if (!isLocal) {
  console.log(`⚠️  Target REMOTO: ${SUPABASE_URL}`);
  if (!(process.argv.includes('--yes') || process.env.SEED_CONFIRM === 'yes')) {
    console.error('   Rifiuto di procedere senza conferma esplicita.');
    console.error('   Rilancia con --yes (o SEED_CONFIRM=yes) se sei sicuro.');
    console.error('   NB: sovrascrive gli esercizi con lo stesso nome e ricrea corsi/scheda delle utenze demo.');
    process.exit(1);
  }
  console.log('   Conferma ricevuta, procedo.');
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// --- Modalità ---
//   default            : reset completo (utenze + corsi + esercizi + scheda demo)
//   --exercises-only   : inserisce/aggiorna SOLO il catalogo esercizi
const exercisesOnly = process.argv.includes('--exercises-only') || process.argv.includes('--only-exercises');

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

// Utenze + corsi: solo nel reset completo (saltati con --exercises-only)
let trainerId = null;
let memberId = null;
if (!exercisesOnly) {
  await ensureUser('admin@gym.local', 'admin', 'Alice Admin');
  trainerId = await ensureUser('trainer@gym.local', 'trainer', 'Toni Trainer');
  memberId = await ensureUser('member@gym.local', 'member', 'Marco Member');

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
}

// =====================================================
// Catalogo esercizi/macchine (50 voci comuni).
//   load_type: 'weight' -> si registra il peso in kg
//              'level'   -> si registra il livello di difficoltà (macchine cardio)
//   has_incline: true    -> si registra anche la pendenza % (es. tapis roulant)
// Fonti (esercizi/macchine comuni): guide gym equipment & exercise di
//   fitnesspremierclubs.com, gymshark.com, truefitness.com.
// =====================================================
const catalog = [
  // ---- Gambe / polpacci ----
  { name: 'Squat con bilanciere', muscle_group: 'Gambe', load_type: 'weight',
    video_url: 'https://www.youtube.com/watch?v=aclHkVaku9U',
    description: 'Bilanciere sulle spalle, piedi larghezza spalle. Scendi spingendo i fianchi indietro fino a coscia parallela, poi risali spingendo sui talloni.' },
  { name: 'Leg press', muscle_group: 'Gambe', load_type: 'weight',
    description: 'Seduto alla pressa, piedi a metà pedana. Spingi la piattaforma estendendo le gambe senza bloccare le ginocchia, poi rientra controllato.' },
  { name: 'Leg extension', muscle_group: 'Gambe', load_type: 'weight',
    description: 'Seduto alla macchina, caviglie sotto il rullo. Estendi le ginocchia fino a gambe tese, contrai il quadricipite e scendi lentamente.' },
  { name: 'Leg curl sdraiato', muscle_group: 'Gambe', load_type: 'weight',
    description: 'Sdraiato prono, talloni sotto il rullo. Fletti le ginocchia portando i talloni verso i glutei, poi torna controllato.' },
  { name: 'Affondi con manubri', muscle_group: 'Gambe', load_type: 'weight',
    description: 'Manubri lungo i fianchi. Fai un passo avanti e scendi fino a 90°, poi spingi sul tallone anteriore per risalire.' },
  { name: 'Hack squat', muscle_group: 'Gambe', load_type: 'weight',
    description: 'Spalle e schiena contro lo schienale della macchina. Scendi in accosciata controllata e risali spingendo sui talloni.' },
  { name: 'Goblet squat', muscle_group: 'Gambe', load_type: 'weight',
    description: 'Un manubrio tenuto al petto. Squat profondo mantenendo il busto eretto e i gomiti tra le ginocchia.' },
  { name: 'Stacco rumeno', muscle_group: 'Gambe', load_type: 'weight',
    description: 'Bilanciere/manubri davanti alle cosce. Spingi i fianchi indietro scendendo a schiena dritta, senti l\'allungamento dei femorali, poi risali.' },
  { name: 'Adductor machine', muscle_group: 'Gambe', load_type: 'weight',
    description: 'Seduto, cuscinetti all\'interno delle cosce. Chiudi le gambe contro la resistenza, poi apri controllato.' },
  { name: 'Abductor machine', muscle_group: 'Gambe', load_type: 'weight',
    description: 'Seduto, cuscinetti all\'esterno delle cosce. Apri le gambe spingendo verso l\'esterno, poi rientra lentamente.' },
  { name: 'Bulgarian split squat', muscle_group: 'Gambe', load_type: 'weight',
    description: 'Piede posteriore su una panca. Scendi con la gamba anteriore fino a 90°, poi risali spingendo sul tallone.' },
  { name: 'Calf raise', muscle_group: 'Polpacci', load_type: 'weight',
    description: 'In piedi o alla pressa, avampiede sul supporto. Sali sulle punte contraendo i polpacci, poi scendi sotto il livello per allungare.' },

  // ---- Petto ----
  { name: 'Panca piana con bilanciere', muscle_group: 'Petto', load_type: 'weight',
    video_url: 'https://www.youtube.com/watch?v=rT7DgCr-3pg',
    description: 'Scapole retratte, piedi a terra. Scendi il bilanciere al petto controllato, poi spingi verso l\'alto senza staccare i glutei.' },
  { name: 'Panca inclinata con manubri', muscle_group: 'Petto', load_type: 'weight',
    description: 'Schienale a 30-45°. Spingi i manubri verso l\'alto sopra il petto alto, poi scendi controllato ampliando il movimento.' },
  { name: 'Chest press', muscle_group: 'Petto', load_type: 'weight',
    description: 'Seduto alla macchina, impugnature all\'altezza del petto. Spingi in avanti fino a quasi estendere le braccia, poi rientra.' },
  { name: 'Pec deck', muscle_group: 'Petto', load_type: 'weight',
    description: 'Seduto, avambracci sui cuscinetti. Chiudi le braccia davanti al petto contraendo i pettorali, poi apri controllato.' },
  { name: 'Croci ai cavi', muscle_group: 'Petto', load_type: 'weight',
    description: 'In piedi tra due cavi alti. Con gomiti leggermente flessi porta le maniglie davanti al petto, poi apri lentamente.' },
  { name: 'Piegamenti sulle braccia', muscle_group: 'Petto', load_type: 'weight',
    description: 'Mani poco più larghe delle spalle, corpo in linea. Scendi fino a sfiorare il pavimento col petto, poi spingi su.' },
  { name: 'Dip alle parallele', muscle_group: 'Petto', load_type: 'weight',
    description: 'Sospeso alle parallele, busto leggermente inclinato avanti. Scendi flettendo i gomiti, poi risali estendendo le braccia.' },

  // ---- Schiena / dorsali ----
  { name: 'Stacco da terra', muscle_group: 'Schiena', load_type: 'weight',
    description: 'Bilanciere vicino alle tibie, schiena dritta. Estendi anche e ginocchia insieme mantenendo il core contratto.' },
  { name: 'Lat machine', muscle_group: 'Dorsali', load_type: 'weight',
    description: 'Presa prona più larga delle spalle. Tira la barra verso il petto alto abbassando le scapole, poi risali controllato.' },
  { name: 'Pulley basso', muscle_group: 'Schiena', load_type: 'weight',
    description: 'Seduto, schiena dritta. Tira la maniglia all\'addome portando i gomiti indietro, stringi le scapole, poi allunga.' },
  { name: 'Rematore con bilanciere', muscle_group: 'Schiena', load_type: 'weight',
    description: 'Busto inclinato a ~45°, schiena neutra. Tira il bilanciere verso l\'ombelico, poi scendi controllato.' },
  { name: 'Rematore con manubrio', muscle_group: 'Schiena', load_type: 'weight',
    description: 'Un ginocchio e una mano sulla panca. Tira il manubrio al fianco portando il gomito indietro, poi scendi.' },
  { name: 'Trazioni alla sbarra', muscle_group: 'Dorsali', load_type: 'weight',
    description: 'Presa prona poco più larga delle spalle. Tira i gomiti verso il basso portando il mento sopra la sbarra, controlla la discesa.' },
  { name: 'Pullover con manubrio', muscle_group: 'Schiena', load_type: 'weight',
    description: 'Sdraiato, manubrio sopra il petto. Porta le braccia dietro la testa allungando i dorsali, poi riporta sopra il petto.' },
  { name: 'Seated row machine', muscle_group: 'Schiena', load_type: 'weight',
    description: 'Seduto col petto contro il pad. Tira le impugnature verso di te stringendo le scapole, poi rilascia controllato.' },

  // ---- Spalle ----
  { name: 'Military press', muscle_group: 'Spalle', load_type: 'weight',
    description: 'In piedi, bilanciere all\'altezza delle clavicole. Spingi sopra la testa fino a braccia tese, poi scendi controllato.' },
  { name: 'Shoulder press machine', muscle_group: 'Spalle', load_type: 'weight',
    description: 'Seduto, impugnature all\'altezza delle spalle. Spingi verso l\'alto senza bloccare i gomiti, poi rientra.' },
  { name: 'Alzate laterali', muscle_group: 'Spalle', load_type: 'weight',
    description: 'Manubri ai fianchi, gomiti leggermente flessi. Solleva le braccia fino all\'altezza delle spalle, poi scendi lentamente.' },
  { name: 'Alzate frontali', muscle_group: 'Spalle', load_type: 'weight',
    description: 'Manubri davanti alle cosce. Solleva le braccia davanti fino all\'altezza delle spalle, poi scendi controllato.' },
  { name: 'Arnold press', muscle_group: 'Spalle', load_type: 'weight',
    description: 'Manubri davanti al viso, palmi verso di te. Ruota ed estendi sopra la testa, poi torna invertendo il movimento.' },
  { name: 'Face pull ai cavi', muscle_group: 'Spalle', load_type: 'weight',
    description: 'Cavo all\'altezza del viso, presa a corda. Tira verso la fronte aprendo i gomiti, contrai i deltoidi posteriori.' },

  // ---- Braccia ----
  { name: 'Curl con bilanciere', muscle_group: 'Bicipiti', load_type: 'weight',
    description: 'In piedi, presa supina. Fletti i gomiti portando il bilanciere alle spalle senza dondolare, poi scendi controllato.' },
  { name: 'Curl con manubri', muscle_group: 'Bicipiti', load_type: 'weight',
    description: 'Manubri ai fianchi, palmi in avanti. Fletti alternando o insieme, contrai i bicipiti in alto, poi scendi.' },
  { name: 'Curl a martello', muscle_group: 'Bicipiti', load_type: 'weight',
    description: 'Manubri con presa neutra (palmi verso il corpo). Fletti i gomiti mantenendo i polsi fermi, poi scendi.' },
  { name: 'Panca Scott', muscle_group: 'Bicipiti', load_type: 'weight',
    description: 'Braccia appoggiate sul leggio. Fletti i gomiti sollevando il peso, poi scendi senza estendere del tutto.' },
  { name: 'Curl ai cavi', muscle_group: 'Bicipiti', load_type: 'weight',
    description: 'In piedi al cavo basso. Fletti i gomiti tenendoli fermi ai fianchi, contrai in alto, poi scendi controllato.' },
  { name: 'French press', muscle_group: 'Tricipiti', load_type: 'weight',
    description: 'Sdraiato o seduto, bilanciere sopra la fronte. Fletti i gomiti abbassando il peso, poi estendi le braccia.' },
  { name: 'Pushdown ai cavi', muscle_group: 'Tricipiti', load_type: 'weight',
    description: 'In piedi al cavo alto, presa a barra/corda. Estendi i gomiti spingendo verso il basso, poi risali controllato.' },
  { name: 'Dip per tricipiti', muscle_group: 'Tricipiti', load_type: 'weight',
    description: 'Alle parallele con busto verticale. Scendi flettendo i gomiti vicini al corpo, poi estendi per risalire.' },

  // ---- Addome / core ----
  { name: 'Crunch', muscle_group: 'Addominali', load_type: 'weight',
    description: 'Sdraiato, ginocchia piegate. Solleva le scapole avvicinando le costole al bacino, poi scendi controllato.' },
  { name: 'Crunch alla macchina', muscle_group: 'Addominali', load_type: 'weight',
    description: 'Seduto, presa sulle impugnature. Fletti il busto in avanti contraendo gli addominali, poi torna controllato.' },
  { name: 'Russian twist', muscle_group: 'Addominali', load_type: 'weight',
    description: 'Seduto, busto inclinato indietro e piedi sollevati. Ruota il tronco portando le mani/peso da un lato all\'altro.' },
  { name: 'Plank', muscle_group: 'Core', load_type: 'weight',
    description: 'Appoggio su avambracci e punte, corpo in linea. Mantieni la posizione contraendo core e glutei (registra i secondi come reps).' },

  // ---- Cardio (livello di difficoltà) ----
  { name: 'Tapis roulant', muscle_group: 'Cardio', load_type: 'level', has_incline: true,
    description: 'Camminata/corsa a ritmo costante. Imposta il livello (velocità) e la pendenza indicati dalla scheda.' },
  { name: 'Cyclette', muscle_group: 'Cardio', load_type: 'level',
    description: 'Pedalata a resistenza costante. Regola il livello di difficoltà e mantieni una cadenza regolare.' },
  { name: 'Ellittica', muscle_group: 'Cardio', load_type: 'level',
    description: 'Movimento fluido di gambe e braccia. Imposta il livello di resistenza e mantieni un ritmo costante.' },
  { name: 'Vogatore', muscle_group: 'Cardio', load_type: 'level',
    description: 'Spingi con le gambe, poi tira con schiena e braccia. Regola il livello e mantieni colpi controllati.' },
  { name: 'Stair climber', muscle_group: 'Cardio', load_type: 'level',
    description: 'Salita continua di gradini. Imposta il livello e mantieni una postura eretta senza appoggiarti troppo.' },
];

// Colore dell'immagine segnaposto per gruppo muscolare
const groupColor = {
  Gambe: '#4f46e5', Polpacci: '#6366f1', Petto: '#059669', Schiena: '#dc2626',
  Dorsali: '#ea580c', Spalle: '#d97706', Bicipiti: '#7c3aed', Tricipiti: '#9333ea',
  Addominali: '#0d9488', Core: '#0f766e', Cardio: '#0891b2',
};

// Immagine SVG "esplicativa" con il nome dell'esercizio (segnaposto per la demo).
function placeholderSvg(label, color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">
    <rect width="400" height="300" fill="${color}"/>
    <text x="200" y="155" font-family="sans-serif" font-size="26" fill="#fff"
      text-anchor="middle">${label}</text>
  </svg>`;
}

// Slug ASCII per il nome file nel bucket (rimuove accenti e caratteri speciali)
function slug(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

const exerciseIdByName = {};
for (const ex of catalog) {
  const path = `seed/${slug(ex.name)}.svg`;
  await admin.storage.from('exercise-images').upload(
    path,
    Buffer.from(placeholderSvg(ex.name, groupColor[ex.muscle_group] || '#64748b')),
    { contentType: 'image/svg+xml', upsert: true }
  );
  const { data, error } = await admin
    .from('exercises')
    .upsert(
      {
        name: ex.name,
        muscle_group: ex.muscle_group,
        description: ex.description,
        load_type: ex.load_type,
        has_incline: ex.has_incline ?? false,
        video_url: ex.video_url ?? null,
        image_path: path,
      },
      { onConflict: 'name' }
    )
    .select()
    .single();
  if (error) throw new Error(`Upsert esercizio "${ex.name}" fallito: ${error.message}`);
  exerciseIdByName[ex.name] = data.id;
}

// Scheda di esempio per il member: solo nel reset completo
if (!exercisesOnly) {
  const day = (name, items) => ({
    name,
    exercises: items.map(([exName, sets, reps, rest_seconds]) => ({
      exercise_id: exerciseIdByName[exName],
      sets, reps, rest_seconds,
    })),
  });

  await admin.from('workouts').delete().eq('member_id', memberId);
  await admin.from('workouts').insert({
    member_id: memberId,
    trainer_id: trainerId,
    title: 'Full Body - Fase 1',
    notes: 'Progressione su 4 settimane, 3 sedute a settimana.',
    days_json: [
      day('Giorno A — Spinta', [
        ['Squat con bilanciere', 4, 10, 120],
        ['Panca piana con bilanciere', 4, 8, 90],
        ['Leg press', 3, 12, 90],
      ]),
      day('Giorno B — Tirata', [
        ['Stacco da terra', 3, 6, 150],
        ['Lat machine', 4, 10, 90],
        ['Rematore con bilanciere', 3, 10, 90],
      ]),
      day('Giorno C — Cardio & Core', [
        ['Tapis roulant', 1, 20, 60],
        ['Plank', 3, 45, 60],
        ['Crunch', 3, 15, 45],
      ]),
    ],
  });
}

if (exercisesOnly) {
  console.log('✅ Seed completato (solo esercizi).');
  console.log('   Catalogo: %d esercizi/macchine (utenze/corsi/scheda non toccati).', catalog.length);
} else {
  console.log('✅ Seed completato (reset completo).');
  console.log('   Utenze (password: %s): admin@gym.local | trainer@gym.local | member@gym.local', PASSWORD);
  console.log('   Catalogo: %d esercizi/macchine · 3 corsi · 1 scheda demo (3 giornate)', catalog.length);
}
