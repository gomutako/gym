-- =====================================================
-- MIGRATION — Schede preconfezionate (libreria di programmi pronti).
-- Non appartengono a un member: sono modelli che trainer/admin possono
-- ASSEGNARE a un cliente (il backend le clona in public.workouts).
-- days_json ha la stessa forma di workouts.days_json:
--   [{ "name": "Giorno A", "exercises": [{ exercise_id, sets, reps, rest_seconds }] }]
-- =====================================================
create table public.workout_templates (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  description  text,
  goal         text,        -- es. ipertrofia | forza | dimagrimento | resistenza
  level        text,        -- principiante | intermedio | avanzato
  days_json    jsonb not null default '[]'::jsonb,
  source       text,        -- provenienza (es. "curated")
  created_at   timestamptz not null default now()
);

-- GRANT: le tabelle nuove non ereditano i grant dati alle tabelle esistenti
grant all on public.workout_templates to anon, authenticated, service_role;

alter table public.workout_templates enable row level security;

-- Lettura: tutti gli autenticati (la libreria è consultabile)
create policy workout_templates_select on public.workout_templates
  for select using (auth.role() = 'authenticated');

-- Scrittura: solo trainer e admin gestiscono la libreria
create policy workout_templates_write on public.workout_templates
  for all using (public.current_user_role() in ('admin', 'trainer'))
  with check (public.current_user_role() in ('admin', 'trainer'));
