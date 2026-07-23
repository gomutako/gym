-- =====================================================
-- MIGRATION — Catalogo esercizi + Storage immagini.
-- L'immagine rappresenta il TIPO di esercizio ed è condivisa
-- tra tutte le schede e tutti gli utenti (single source of truth).
-- Le schede (workouts.exercises_json) referenziano exercise_id e
-- aggiungono sets/reps/rest_seconds per la singola assegnazione.
-- =====================================================

-- ----- Catalogo esercizi -----
create table public.exercises (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  muscle_group text,
  image_path   text,        -- path nel bucket Storage 'exercise-images'
  created_at   timestamptz not null default now()
);

-- GRANT: le tabelle nuove non ereditano i grant dati alle tabelle esistenti
grant all on public.exercises to anon, authenticated, service_role;

alter table public.exercises enable row level security;

-- Lettura: tutti gli autenticati (il member deve vedere l'immagine in scheda)
create policy exercises_select on public.exercises
  for select using (auth.role() = 'authenticated');

-- Scrittura: trainer e admin gestiscono il catalogo
create policy exercises_write on public.exercises
  for all using (public.current_user_role() in ('admin', 'trainer'))
  with check (public.current_user_role() in ('admin', 'trainer'));

-- ----- Bucket Storage per le immagini (pubblico in lettura) -----
insert into storage.buckets (id, name, public)
values ('exercise-images', 'exercise-images', true)
on conflict (id) do nothing;

-- Upload/modifica/eliminazione file: solo trainer e admin
create policy "exercise_images_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'exercise-images'
    and public.current_user_role() in ('admin', 'trainer')
  );

create policy "exercise_images_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'exercise-images'
    and public.current_user_role() in ('admin', 'trainer')
  );

create policy "exercise_images_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'exercise-images'
    and public.current_user_role() in ('admin', 'trainer')
  );

-- Lettura file: chiunque (il bucket è pubblico, serve per mostrare le immagini)
create policy "exercise_images_select" on storage.objects
  for select using (bucket_id = 'exercise-images');
