-- =====================================================
-- MIGRATION — Istruzioni di esecuzione strutturate.
-- La fonte (free-exercise-db) fornisce le istruzioni come elenco ordinato di
-- passi. Le conserviamo come array (più ricche del singolo campo description,
-- che resta per compatibilità / inserimento manuale).
-- =====================================================
alter table public.exercises
  add column instructions text[] not null default '{}';
