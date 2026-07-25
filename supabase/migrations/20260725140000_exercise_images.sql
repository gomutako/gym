-- =====================================================
-- MIGRATION — Più immagini per esercizio (carousel).
-- La fonte del seed (free-exercise-db) fornisce 2 immagini per esercizio
-- (inizio/fine del movimento). image_path resta la COPERTINA (prima immagine,
-- usata nelle thumbnail); image_paths le contiene tutte, in ordine, per il
-- carousel nella scheda esercizio.
-- =====================================================
alter table public.exercises
  add column image_paths text[] not null default '{}';
