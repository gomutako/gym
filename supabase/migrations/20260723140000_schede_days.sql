-- =====================================================
-- MIGRATION — Schede come entità con giornate + descrizione esercizi.
--  * exercises.description : testo tecnica/esecuzione (condiviso per tipo)
--  * workouts.title        : nome della scheda
--  * workouts.days_json    : suddivisione in giornate, ognuna con i suoi esercizi
--    forma: [ { "name": "Giorno A", "exercises": [
--                { exercise_id, sets, reps, rest_seconds } ] } ]
-- =====================================================

-- Descrizione esecuzione nel catalogo esercizi
alter table public.exercises
  add column description text;

-- La scheda diventa un'entità con titolo e giornate
alter table public.workouts
  add column title text;

alter table public.workouts
  add column days_json jsonb not null default '[]'::jsonb;

-- La vecchia lista piatta di esercizi non serve più (sostituita da days_json)
alter table public.workouts
  drop column exercises_json;
