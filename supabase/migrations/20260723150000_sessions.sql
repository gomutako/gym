-- =====================================================
-- MIGRATION — Sessioni di allenamento.
-- Il member "inizia un allenamento" scegliendo scheda + giornata:
-- si crea una sessione che fa lo SNAPSHOT degli esercizi di quella
-- giornata (title/day_name inclusi), così lo storico/calendario resta
-- corretto anche se la scheda viene poi modificata o eliminata.
-- exercises_log: [{ exercise_id, sets, reps, rest_seconds, done, done_at }]
-- =====================================================

create table public.workout_sessions (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references public.profiles (id) on delete cascade,
  workout_id    uuid references public.workouts (id) on delete set null,
  workout_title text,          -- snapshot del titolo scheda
  day_index     int,           -- indice della giornata dentro days_json
  day_name      text,          -- snapshot del nome giornata
  exercises_log jsonb not null default '[]'::jsonb,
  started_at    timestamptz not null default now(),
  completed_at  timestamptz,   -- null = allenamento in corso
  created_at    timestamptz not null default now()
);

create index idx_sessions_member on public.workout_sessions (member_id);

-- GRANT (le tabelle nuove non ereditano i grant delle esistenti)
grant all on public.workout_sessions to anon, authenticated, service_role;

alter table public.workout_sessions enable row level security;

-- Il member gestisce le proprie sessioni; trainer/admin le vedono (progressi)
create policy sessions_select on public.workout_sessions
  for select using (
    member_id = auth.uid()
    or public.current_user_role() in ('admin', 'trainer')
  );

create policy sessions_insert on public.workout_sessions
  for insert with check (member_id = auth.uid());

create policy sessions_update on public.workout_sessions
  for update using (member_id = auth.uid())
  with check (member_id = auth.uid());

create policy sessions_delete on public.workout_sessions
  for delete using (
    member_id = auth.uid()
    or public.current_user_role() = 'admin'
  );
