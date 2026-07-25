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

// Crea (o recupera) un utente con ruolo, restituisce l'id.
// Nome e cognome finiscono nei metadati: il trigger handle_new_user crea la
// riga profiles con first_name/last_name (full_name è generata).
async function ensureUser(email, role, first_name, last_name) {
  const { data: list } = await admin.auth.admin.listUsers();
  const existing = list.users.find((u) => u.email === email);
  if (existing) return existing.id;

  const { data, error } = await admin.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true,
    user_metadata: { role, first_name, last_name },
  });
  if (error) throw error;
  return data.user.id;
}

// Utenze + corsi: solo nel reset completo (saltati con --exercises-only)
let trainerId = null;
let memberId = null;
if (!exercisesOnly) {
  await ensureUser('admin@gym.local', 'admin', 'Alice', 'Admin');
  trainerId = await ensureUser('trainer@gym.local', 'trainer', 'Toni', 'Trainer');
  memberId = await ensureUser('member@gym.local', 'member', 'Marco', 'Member');

  // Abbonamento: storico di periodi. Uno passato (scaduto) + uno attivo
  // (+30 giorni). profiles.subscription_end_date è mantenuta dal trigger.
  const day = (offset) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  await admin.from('subscriptions').delete().eq('member_id', memberId);
  await admin.from('subscriptions').insert([
    { member_id: memberId, start_date: day(-120), end_date: day(-30) }, // scaduto
    { member_id: memberId, start_date: day(-15), end_date: day(30) },   // attivo
  ]);

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
// Catalogo esercizi — importato PER INTERO da free-exercise-db (public domain,
// ~873 voci). I NOMI restano in inglese (fonte); i metadati (gruppo muscolare,
// attrezzatura, categoria, livello, meccanica, sforzo, muscoli secondari) sono
// tradotti in italiano. Ogni esercizio porta le istruzioni (passi) e TUTTE le
// immagini disponibili (per il carousel).
//   load_type: 'weight' (peso kg) | 'level' (macchine cardio)
// Fonte: https://github.com/yuhonas/free-exercise-db (Unlicense)
// =====================================================

// Colore del segnaposto per muscolo primario (fallback grigio)
const groupColor = {
  quadricipiti: '#4f46e5', femorali: '#4338ca', glutei: '#6366f1', polpacci: '#818cf8',
  petto: '#059669', dorsali: '#dc2626', 'schiena centrale': '#ea580c', lombari: '#f97316',
  trapezio: '#b45309', spalle: '#d97706', bicipiti: '#7c3aed', tricipiti: '#9333ea',
  avambracci: '#65a30d', addominali: '#0d9488', collo: '#0f766e',
  abduttori: '#0891b2', adduttori: '#0e7490',
};

// SVG "esplicativo" col nome dell'esercizio (segnaposto se manca la foto reale).
function placeholderSvg(label, color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">
    <rect width="400" height="300" fill="${color}"/>
    <text x="200" y="155" font-family="sans-serif" font-size="22" fill="#fff"
      text-anchor="middle">${label}</text>
  </svg>`;
}

// Slug ASCII per il nome file nel bucket
function slug(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

const FEDB_BASE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises';
const FEDB_INDEX_URL = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json';

// --- Traduzioni EN -> IT (coerenti con la UI e i CHECK delle migration) ---
const EQUIP_IT = {
  barbell: 'Bilanciere', dumbbell: 'Manubri', cable: 'Cavi', machine: 'Macchina',
  'body only': 'Corpo libero', kettlebells: 'Kettlebell', bands: 'Elastici',
  'medicine ball': 'Palla medica', 'exercise ball': 'Fitball', 'e-z curl bar': 'Bilanciere EZ',
  'foam roll': 'Foam roller', other: 'Altro',
};
const LEVEL_IT = { beginner: 'principiante', intermediate: 'intermedio', expert: 'avanzato' };
const MECH_IT = { compound: 'composto', isolation: 'isolamento' };
const FORCE_IT = { push: 'spinta', pull: 'trazione', static: 'statico' };
const CAT_IT = {
  strength: 'forza', cardio: 'cardio', stretching: 'stretching', plyometrics: 'pliometria',
  powerlifting: 'powerlifting', 'olympic weightlifting': 'weightlifting', strongman: 'strongman',
};
const MUSCLE_IT = {
  abdominals: 'addominali', abductors: 'abduttori', adductors: 'adduttori', biceps: 'bicipiti',
  calves: 'polpacci', chest: 'petto', forearms: 'avambracci', glutes: 'glutei',
  hamstrings: 'femorali', lats: 'dorsali', 'lower back': 'lombari', 'middle back': 'schiena centrale',
  neck: 'collo', quadriceps: 'quadricipiti', shoulders: 'spalle', traps: 'trapezio', triceps: 'tricipiti',
};

// Video diretti curati (chiave = id free-exercise-db, verificati). Gli altri:
// link di ricerca YouTube (sempre valido).
const videoById = {
  'Barbell_Squat': 'https://www.youtube.com/watch?v=aclHkVaku9U',
  'Barbell_Bench_Press_-_Medium_Grip': 'https://www.youtube.com/watch?v=3CgfAV84cfM',
  'Barbell_Deadlift': 'https://www.youtube.com/watch?v=b4NI-OkEnW0',
  'Standing_Military_Press': 'https://www.youtube.com/watch?v=mywEUpC1oyM',
  'Full_Range-Of-Motion_Lat_Pulldown': 'https://www.youtube.com/watch?v=P8QKoy5sjv8',
  'Bent_Over_Barbell_Row': 'https://www.youtube.com/watch?v=cDZh_hx3YgU',
  'Pullups': 'https://www.youtube.com/watch?v=m2cauCtWj8E',
  'Leg_Press': 'https://www.youtube.com/watch?v=LMTyPl_oo38',
  'Barbell_Curl': 'https://www.youtube.com/watch?v=mhrv92jvtc4',
  'Triceps_Pushdown': 'https://www.youtube.com/watch?v=8NMnKwaOtB8',
  'Romanian_Deadlift': 'https://www.youtube.com/watch?v=Rki1bVYxHok',
  'Dumbbell_Lunges': 'https://www.youtube.com/watch?v=Jezpb-6fuQ0',
  'Side_Lateral_Raise': 'https://www.youtube.com/watch?v=6sT8LVeGVoc',
  'Plank': 'https://www.youtube.com/watch?v=Is-7PPaBcsM',
  'Dips_-_Chest_Version': 'https://www.youtube.com/watch?v=SLVwguvd6io',
  'Incline_Dumbbell_Press': 'https://www.youtube.com/watch?v=AH4zcrU9P5A',
  'Front_Barbell_Squat': 'https://www.youtube.com/watch?v=npVgCT7NznU',
  'Stiff-Legged_Barbell_Deadlift': 'https://www.youtube.com/watch?v=RpwTdghpl0Y',
  'Barbell_Glute_Bridge': 'https://www.youtube.com/watch?v=wPM8icPu6H8',
  'Seated_Leg_Curl': 'https://www.youtube.com/watch?v=t9sTSr-JYSs',
  'Barbell_Incline_Bench_Press_-_Medium_Grip': 'https://www.youtube.com/watch?v=SrqOu55lrYU',
  'Dumbbell_Flyes': 'https://www.youtube.com/watch?v=LzFvciCdoW0',
  'Close-Grip_Barbell_Bench_Press': 'https://www.youtube.com/watch?v=UYJsFzqdgK4',
  'Lying_T-Bar_Row': 'https://www.youtube.com/watch?v=SbZycT7Eq58',
  'Chin-Up': 'https://www.youtube.com/watch?v=e1YSApl-QcM',
  'Good_Morning': 'https://www.youtube.com/watch?v=0Syp9iyINZ4',
  'Upright_Barbell_Row': 'https://www.youtube.com/watch?v=v7nsz05s9oM',
  'Dumbbell_Shrug': 'https://www.youtube.com/watch?v=qvvJUKq7_sU',
  'Concentration_Curls': 'https://www.youtube.com/watch?v=Jvj2wV0vOYU',
  'Triceps_Pushdown_-_Rope_Attachment': 'https://www.youtube.com/watch?v=vPeQu_L-1n0',
  'Cable_Seated_Lateral_Raise': 'https://www.youtube.com/watch?v=qitQHqNZbeM',
  'Hanging_Leg_Raise': 'https://www.youtube.com/watch?v=rbOJSK07AGA',
  'Sit-Up': 'https://www.youtube.com/watch?v=iL06z9PWYs8',
  'Mountain_Climbers': 'https://www.youtube.com/watch?v=Q_olQdxEPF4',
  'Rope_Jumping': 'https://www.youtube.com/watch?v=_UTR1VWg8WY',
  'Farmers_Walk': 'https://www.youtube.com/watch?v=NH7Xv-7NQNQ',
  'One-Arm_Kettlebell_Swings': 'https://www.youtube.com/watch?v=sSESeQAir2M',
  'Barbell_Walking_Lunge': 'https://www.youtube.com/watch?v=I34ysEkPK7w',
};

const youtubeSearch = (name) =>
  `https://www.youtube.com/results?search_query=${encodeURIComponent('how to ' + name)}`;

// --- Indice completo della fonte (obbligatorio per l'import di massa) ---
console.log("Scarico l'indice esercizi dalla fonte…");
let index = [];
try {
  const res = await fetch(FEDB_INDEX_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  index = await res.json();
} catch (e) {
  console.error("❌ Impossibile scaricare l'indice esercizi:", e.message);
  process.exit(1);
}

// Scarica e carica UNA immagine della fonte; ritorna il path nel bucket o null.
async function uploadOne(id, rel, i) {
  try {
    const url = `${FEDB_BASE}/${rel.split('/').map(encodeURIComponent).join('/')}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const path = `seed/${slug(id)}-${i}.jpg`;
    await admin.storage.from('exercise-images').upload(path, buf, { contentType: 'image/jpeg', upsert: true });
    return path;
  } catch {
    return null; // singola immagine fallita: si prosegue con le altre
  }
}

// Carica TUTTE le immagini dell'esercizio; se nessuna, segnaposto SVG.
async function uploadImages(e) {
  const paths = [];
  const rels = e.images || [];
  for (let i = 0; i < rels.length; i++) {
    const p = await uploadOne(e.id, rels[i], i);
    if (p) paths.push(p);
  }
  if (paths.length) return paths;
  const path = `seed/${slug(e.id)}.svg`;
  const color = groupColor[MUSCLE_IT[e.primaryMuscles?.[0]]] || '#64748b';
  await admin.storage.from('exercise-images').upload(
    path, Buffer.from(placeholderSvg(e.name, color)), { contentType: 'image/svg+xml', upsert: true }
  );
  return [path];
}

// Costruisce la riga esercizio (tradotta) da un record della fonte.
function toRow(e, image_paths) {
  const secondary = (e.secondaryMuscles || []).map((x) => MUSCLE_IT[x] || x).filter(Boolean);
  return {
    name: e.name, // inglese (fonte)
    muscle_group: MUSCLE_IT[e.primaryMuscles?.[0]] || null,
    description: (e.instructions || []).join(' ') || null,
    instructions: e.instructions || [],
    load_type: e.category === 'cardio' ? 'level' : 'weight',
    has_incline: false,
    video_url: videoById[e.id] || youtubeSearch(e.name),
    image_path: image_paths[0], // copertina
    image_paths, // tutte, per il carousel
    equipment: EQUIP_IT[e.equipment] || null,
    category: CAT_IT[e.category] || null,
    force: FORCE_IT[e.force] || null,
    level: LEVEL_IT[e.level] || null,
    mechanic: MECH_IT[e.mechanic] || null,
    secondary_muscles: secondary,
  };
}

// --- Popolamento con pool a concorrenza limitata (873×2 immagini) ---
console.log(`Popolo il catalogo (${index.length} esercizi dalla fonte, scarico le immagini)…`);
const exerciseIdByName = {};
let done = 0, realImgs = 0, totImgs = 0;

async function processOne(e) {
  const image_paths = await uploadImages(e);
  if (image_paths.some((p) => p.endsWith('.jpg'))) realImgs++;
  totImgs += image_paths.filter((p) => p.endsWith('.jpg')).length;
  const { data, error } = await admin
    .from('exercises')
    .upsert(toRow(e, image_paths), { onConflict: 'name' })
    .select('id, name')
    .single();
  if (error) throw new Error(`Upsert "${e.name}" fallito: ${error.message}`);
  exerciseIdByName[e.name] = data.id;
  if (++done % 50 === 0 || done === index.length) console.log(`  ${done}/${index.length}…`);
}

// Esegue fn su tutti gli item con al più `n` in volo contemporaneamente.
async function runPool(items, n, fn) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (queue.length) await fn(queue.shift());
    })
  );
}

await runPool(index, 8, processOne);
console.log(`  esercizi caricati: ${done}/${index.length} · immagini reali: ${totImgs} · con immagine: ${realImgs}`);

// =====================================================
// Schede preconfezionate (libreria) — programmi noti che referenziano il
// catalogo per nome inglese. Trainer/admin le assegnano a un cliente.
// =====================================================
const tday = (name, items) => ({
  name,
  exercises: items
    .map(([exName, sets, reps, rest]) => ({
      exercise_id: exerciseIdByName[exName],
      sets, reps, rest_seconds: rest,
    }))
    .filter((x) => x.exercise_id), // scarta esercizi non presenti nel catalogo
});

const templates = [
  {
    title: 'Full Body 3x', goal: 'ipertrofia', level: 'principiante',
    description: 'Total body 3 volte a settimana (A/B/C). Ideale per iniziare.',
    days_json: [
      tday('Giorno A', [
        ['Barbell Squat', 3, 10, 120], ['Barbell Bench Press - Medium Grip', 3, 10, 120],
        ['Bent Over Barbell Row', 3, 10, 120], ['Standing Military Press', 3, 10, 90], ['Plank', 3, 45, 60],
      ]),
      tday('Giorno B', [
        ['Barbell Deadlift', 3, 8, 150], ['Incline Dumbbell Press', 3, 10, 120],
        ['Wide-Grip Lat Pulldown', 3, 10, 90], ['Dumbbell Lunges', 3, 12, 90], ['Crunches', 3, 15, 45],
      ]),
      tday('Giorno C', [
        ['Leg Press', 3, 12, 90], ['Dumbbell Bench Press', 3, 10, 90],
        ['Seated Cable Rows', 3, 10, 90], ['Side Lateral Raise', 3, 12, 60], ['Hanging Leg Raise', 3, 12, 60],
      ]),
    ],
  },
  {
    title: 'Push Pull Legs', goal: 'ipertrofia', level: 'intermedio',
    description: 'Split PPL: spinta / tirata / gambe. Ripetibile 6 giorni a settimana.',
    days_json: [
      tday('Push', [
        ['Barbell Bench Press - Medium Grip', 4, 8, 120], ['Incline Dumbbell Press', 3, 10, 90],
        ['Standing Military Press', 3, 10, 90], ['Side Lateral Raise', 3, 15, 60], ['Triceps Pushdown', 3, 12, 60],
      ]),
      tday('Pull', [
        ['Barbell Deadlift', 3, 6, 150], ['Pullups', 4, 8, 120], ['Bent Over Barbell Row', 3, 10, 90],
        ['Face Pull', 3, 15, 60], ['Barbell Curl', 3, 12, 60],
      ]),
      tday('Legs', [
        ['Barbell Squat', 4, 8, 150], ['Romanian Deadlift', 3, 10, 120], ['Leg Press', 3, 12, 90],
        ['Lying Leg Curls', 3, 12, 60], ['Standing Calf Raises', 4, 15, 45],
      ]),
    ],
  },
  {
    title: 'Upper / Lower', goal: 'ipertrofia', level: 'intermedio',
    description: 'Split superiore/inferiore su 4 giorni.',
    days_json: [
      tday('Upper', [
        ['Barbell Bench Press - Medium Grip', 4, 8, 120], ['Bent Over Barbell Row', 4, 8, 120],
        ['Standing Military Press', 3, 10, 90], ['Pullups', 3, 8, 90], ['Barbell Curl', 3, 12, 60],
        ['Triceps Pushdown', 3, 12, 60],
      ]),
      tday('Lower', [
        ['Barbell Squat', 4, 8, 150], ['Romanian Deadlift', 3, 10, 120], ['Leg Press', 3, 12, 90],
        ['Lying Leg Curls', 3, 12, 60], ['Standing Calf Raises', 4, 15, 45],
      ]),
    ],
  },
  {
    title: 'StrongLifts 5x5', goal: 'forza', level: 'principiante',
    description: 'Forza base 5x5, allenamenti A/B a giorni alterni.',
    days_json: [
      tday('Workout A', [
        ['Barbell Squat', 5, 5, 180], ['Barbell Bench Press - Medium Grip', 5, 5, 180],
        ['Bent Over Barbell Row', 5, 5, 180],
      ]),
      tday('Workout B', [
        ['Barbell Squat', 5, 5, 180], ['Standing Military Press', 5, 5, 180], ['Barbell Deadlift', 1, 5, 180],
      ]),
    ],
  },
  {
    title: 'Bro Split 5 giorni', goal: 'ipertrofia', level: 'intermedio',
    description: 'Un gruppo muscolare al giorno, 5 sedute.',
    days_json: [
      tday('Petto', [
        ['Barbell Bench Press - Medium Grip', 4, 8, 120], ['Incline Dumbbell Press', 3, 10, 90],
        ['Dumbbell Flyes', 3, 12, 60], ['Dips - Chest Version', 3, 10, 90],
      ]),
      tday('Schiena', [
        ['Barbell Deadlift', 3, 6, 150], ['Pullups', 4, 8, 120], ['Bent Over Barbell Row', 4, 10, 90],
        ['Seated Cable Rows', 3, 12, 60],
      ]),
      tday('Spalle', [
        ['Standing Military Press', 4, 8, 120], ['Side Lateral Raise', 4, 15, 60],
        ['Upright Barbell Row', 3, 12, 60], ['Dumbbell Shrug', 4, 15, 60],
      ]),
      tday('Gambe', [
        ['Barbell Squat', 4, 8, 150], ['Leg Press', 4, 12, 90], ['Lying Leg Curls', 3, 12, 60],
        ['Standing Calf Raises', 4, 20, 45],
      ]),
      tday('Braccia', [
        ['Barbell Curl', 4, 10, 60], ['Hammer Curls', 3, 12, 60], ['Triceps Pushdown', 4, 12, 60],
        ['Close-Grip Barbell Bench Press', 3, 10, 90],
      ]),
    ],
  },
  {
    title: 'Arnold Split', goal: 'ipertrofia', level: 'avanzato',
    description: 'Petto&Schiena / Spalle&Braccia / Gambe, alto volume.',
    days_json: [
      tday('Petto & Schiena', [
        ['Barbell Bench Press - Medium Grip', 4, 10, 90], ['Incline Dumbbell Press', 3, 10, 90],
        ['Pullups', 4, 10, 90], ['Bent Over Barbell Row', 4, 10, 90],
      ]),
      tday('Spalle & Braccia', [
        ['Standing Military Press', 4, 10, 90], ['Side Lateral Raise', 3, 15, 60],
        ['Barbell Curl', 4, 10, 60], ['Close-Grip Barbell Bench Press', 4, 10, 90],
      ]),
      tday('Gambe', [
        ['Barbell Squat', 5, 10, 150], ['Romanian Deadlift', 4, 10, 120], ['Leg Press', 4, 15, 90],
        ['Standing Calf Raises', 5, 20, 45],
      ]),
    ],
  },
  {
    title: 'Full Body con manubri', goal: 'ipertrofia', level: 'principiante',
    description: 'Solo manubri: perfetta per casa. 3 sedute a settimana.',
    days_json: [
      tday('Total Body', [
        ['Dumbbell Bench Press', 3, 12, 90], ['Dumbbell Lunges', 3, 12, 90],
        ['Incline Dumbbell Press', 3, 12, 90], ['Side Lateral Raise', 3, 15, 60],
        ['Hammer Curls', 3, 12, 60], ['Concentration Curls', 3, 12, 60],
      ]),
    ],
  },
  {
    title: 'A corpo libero', goal: 'dimagrimento', level: 'principiante',
    description: 'Senza attrezzi (serve solo una sbarra per le trazioni).',
    days_json: [
      tday('Full Body', [
        ['Pushups', 4, 15, 60], ['Bodyweight Squat', 4, 20, 60], ['Chin-Up', 4, 8, 90],
        ['Plank', 3, 45, 60], ['Mountain Climbers', 3, 40, 45], ['Crunches', 3, 20, 45],
      ]),
    ],
  },
];

await admin.from('workout_templates').delete().neq('id', '00000000-0000-0000-0000-000000000000');
await admin.from('workout_templates').insert(
  templates.map((t) => ({ ...t, source: 'curated' }))
);
console.log(`  schede preconfezionate: ${templates.length}`);

// =====================================================
// Scheda di esempio per il member: solo nel reset completo
// =====================================================
if (!exercisesOnly) {
  await admin.from('workouts').delete().eq('member_id', memberId);
  await admin.from('workouts').insert({
    member_id: memberId,
    trainer_id: trainerId,
    title: 'Full Body 3x',
    notes: 'Scheda demo assegnata dal trainer.',
    goal: templates[0].goal,
    level: templates[0].level,
    is_active: true,
    days_json: templates[0].days_json, // riusa il programma Full Body 3x
  });
}

if (exercisesOnly) {
  console.log('✅ Seed completato (solo esercizi + schede preconfezionate).');
  console.log('   Catalogo: %d esercizi · %d schede preconfezionate (utenze/corsi non toccati).', index.length, templates.length);
} else {
  console.log('✅ Seed completato (reset completo).');
  console.log('   Utenze (password: %s): admin@gym.local | trainer@gym.local | member@gym.local', PASSWORD);
  console.log('   Catalogo: %d esercizi · 3 corsi · %d schede preconfezionate · 1 scheda demo', index.length, templates.length);
}
