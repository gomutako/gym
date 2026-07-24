// =====================================================
// Helper per le immagini degli esercizi (Supabase Storage).
// =====================================================
import { supabase } from './supabase';

export const EXERCISE_BUCKET = 'exercise-images';

// URL pubblico da un path del bucket (bucket pubblico in lettura)
export function exerciseImageUrl(path) {
  if (!path) return null;
  return supabase.storage.from(EXERCISE_BUCKET).getPublicUrl(path).data.publicUrl;
}

// Carica un file nel bucket e restituisce il path salvato.
// Le policy Storage consentono l'upload solo a trainer/admin.
export async function uploadExerciseImage(file) {
  const ext = file.name.includes('.') ? file.name.split('.').pop() : 'bin';
  const path = `uploads/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from(EXERCISE_BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type });
  if (error) throw error;
  return path;
}

// --- Avatar utente (bucket 'avatars', pubblico in lettura) ---
export const AVATAR_BUCKET = 'avatars';

export function avatarUrl(path) {
  if (!path) return null;
  return supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path).data.publicUrl;
}

// Il path è sotto la "cartella" <uid>/ come richiesto dalle policy Storage.
export async function uploadAvatar(userId, file) {
  const ext = file.name.includes('.') ? file.name.split('.').pop() : 'bin';
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type });
  if (error) throw error;
  return path;
}
