-- =====================================================
-- MIGRATION — Snapshot biometrico della sessione.
-- Salvato a fine allenamento dalla app iOS (HealthKit):
-- HR media/max e calorie attive totali sulla finestra della sessione.
-- Shape: { hr_avg: int|null, hr_max: int|null, active_kcal: number|null }
-- =====================================================
alter table public.workout_sessions
  add column biometrics_json jsonb;
