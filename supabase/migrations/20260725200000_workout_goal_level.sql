-- =====================================================
-- MIGRATION — Tipo (obiettivo) e livello sulle schede.
-- Allineano le schede ai modelli (workout_templates), che li hanno già:
-- così l'editor scheda può impostarli e "salva come modello" li trasferisce.
-- Testo libero (nessun CHECK), come su workout_templates.
-- =====================================================
alter table public.workouts
  add column goal  text,
  add column level text;
