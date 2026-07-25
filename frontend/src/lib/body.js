// Utility per i dati fisici del profilo (usate in ProfileView e ClientsView).
// Il BMI non è memorizzato: si calcola sempre da altezza (cm) e peso (kg).

// BMI = kg / m^2, arrotondato a 1 decimale. null se dati incompleti/non validi.
export function computeBmi(heightCm, weightKg) {
  const h = Number(heightCm);
  const w = Number(weightKg);
  if (!h || !w) return null;
  const m = h / 100;
  const bmi = w / (m * m);
  if (!isFinite(bmi) || bmi <= 0) return null;
  return Math.round(bmi * 10) / 10;
}

// Categoria OMS del BMI (etichetta breve in italiano)
export function bmiCategory(bmi) {
  if (bmi == null) return '';
  if (bmi < 18.5) return 'sottopeso';
  if (bmi < 25) return 'normopeso';
  if (bmi < 30) return 'sovrappeso';
  return 'obesità';
}

// Età in anni interi da una data di nascita ('YYYY-MM-DD'). null se assente.
export function computeAge(birthDate) {
  if (!birthDate) return null;
  const b = new Date(birthDate);
  if (isNaN(b)) return null;
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age >= 0 && age < 150 ? age : null;
}

export const GENDER_LABEL = { uomo: 'Uomo', donna: 'Donna', altro: 'Altro' };
