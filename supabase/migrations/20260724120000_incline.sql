-- =====================================================
-- MIGRATION — Pendenza (%) per esercizi tipo tapis roulant.
-- Alcuni esercizi (es. tapis roulant) registrano per ogni serie un
-- TERZO parametro oltre a reps e carico/livello: la pendenza in %.
-- has_incline abilita la colonna "pendenza" durante l'allenamento;
-- il valore effettivo per serie sta in workout_sessions.exercises_log
-- (sets_log[].incline), come già avviene per il carico.
-- =====================================================
alter table public.exercises
  add column has_incline boolean not null default false;
