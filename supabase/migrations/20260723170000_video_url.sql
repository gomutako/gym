-- =====================================================
-- MIGRATION — Video di esecuzione (opzionale) per esercizio.
-- URL/link (es. YouTube), condiviso per tipo di esercizio.
-- =====================================================
alter table public.exercises
  add column video_url text;
