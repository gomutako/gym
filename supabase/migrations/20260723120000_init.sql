-- =====================================================
-- MIGRATION INIZIALE — Gym Manager
-- Tabelle + Row Level Security (RLS) + trigger.
-- Applicata automaticamente da `supabase start` / `supabase db reset`.
-- =====================================================

-- ----- ENUM dei ruoli -----
create type public.user_role as enum ('admin', 'trainer', 'member');

-- =====================================================
-- TABELLE
-- =====================================================

-- profiles: estende auth.users con ruolo e dati palestra.
-- L'id coincide con auth.users.id (relazione 1-1).
create table public.profiles (
  id                   uuid primary key references auth.users (id) on delete cascade,
  role                 public.user_role not null default 'member',
  full_name            text,
  subscription_end_date date,           -- null = nessun abbonamento; abbonamento attivo se >= today
  created_at           timestamptz not null default now()
);

-- classes: corsi/classi del palinsesto.
create table public.classes (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  description  text,
  trainer_id   uuid references public.profiles (id) on delete set null,
  start_time   timestamptz not null,
  max_capacity int not null default 10 check (max_capacity > 0),
  created_at   timestamptz not null default now()
);

-- bookings: prenotazioni dei member ai corsi.
-- Un member non può prenotare due volte lo stesso corso (unique).
create table public.bookings (
  id         uuid primary key default gen_random_uuid(),
  class_id   uuid not null references public.classes (id) on delete cascade,
  member_id  uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (class_id, member_id)
);

-- workouts: schede di allenamento assegnate dal trainer al member.
create table public.workouts (
  id             uuid primary key default gen_random_uuid(),
  member_id      uuid not null references public.profiles (id) on delete cascade,
  trainer_id     uuid references public.profiles (id) on delete set null,
  exercises_json jsonb not null default '[]'::jsonb,  -- es. [{"name":"Squat","sets":4,"reps":10}]
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Indici utili sulle foreign key più interrogate
create index idx_classes_trainer  on public.classes (trainer_id);
create index idx_bookings_class   on public.bookings (class_id);
create index idx_bookings_member  on public.bookings (member_id);
create index idx_workouts_member  on public.workouts (member_id);

-- =====================================================
-- FUNZIONI HELPER
-- =====================================================

-- Ritorna il ruolo dell'utente corrente.
-- SECURITY DEFINER: gira come owner e bypassa la RLS su profiles,
-- evitando la ricorsione infinita nelle policy che leggono i ruoli.
create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

grant execute on function public.current_user_role() to authenticated;

-- Trigger: alla creazione di un utente in auth.users crea il profilo
-- collegato con ruolo di default 'member' e nome dai metadati di signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    -- consente di impostare un ruolo custom al signup (es. seed admin);
    -- default 'member' se non specificato
    coalesce((new.raw_user_meta_data ->> 'role')::public.user_role, 'member')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Trigger: mantiene aggiornato updated_at sulle schede
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger workouts_touch_updated_at
  before update on public.workouts
  for each row execute function public.touch_updated_at();

-- =====================================================
-- GRANT a livello di tabella per i ruoli API di Supabase.
-- Necessari OLTRE alla RLS: il service_role bypassa la RLS ma
-- richiede comunque i GRANT; anon/authenticated accedono alle
-- tabelle e le righe sono poi filtrate dalle policy RLS.
-- =====================================================
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;

-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================
alter table public.profiles enable row level security;
alter table public.classes  enable row level security;
alter table public.bookings enable row level security;
alter table public.workouts enable row level security;

-- ----- PROFILES -----
-- Lettura: il proprio profilo; admin e trainer vedono tutti (serve per liste partecipanti/gestione).
create policy profiles_select on public.profiles
  for select using (
    id = auth.uid()
    or public.current_user_role() in ('admin', 'trainer')
  );

-- Modifica: solo admin (gestione ruoli e abbonamenti).
create policy profiles_update on public.profiles
  for update using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- ----- CLASSES -----
-- Lettura: qualsiasi utente autenticato può vedere il palinsesto.
create policy classes_select on public.classes
  for select using (auth.role() = 'authenticated');

-- Scrittura completa: solo admin (crea/modifica il palinsesto).
create policy classes_write on public.classes
  for all using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- ----- BOOKINGS -----
-- Lettura: il member vede le proprie; il trainer quelle dei propri corsi; l'admin tutte.
create policy bookings_select on public.bookings
  for select using (
    member_id = auth.uid()
    or public.current_user_role() = 'admin'
    or exists (
      select 1 from public.classes c
      where c.id = bookings.class_id and c.trainer_id = auth.uid()
    )
  );

-- Inserimento: il member può prenotare solo per sé stesso.
create policy bookings_insert on public.bookings
  for insert with check (member_id = auth.uid());

-- Cancellazione: il member annulla la propria prenotazione; l'admin qualsiasi.
create policy bookings_delete on public.bookings
  for delete using (
    member_id = auth.uid()
    or public.current_user_role() = 'admin'
  );

-- ----- WORKOUTS -----
-- Lettura: il member vede le proprie schede; il trainer quelle da lui create; l'admin tutte.
create policy workouts_select on public.workouts
  for select using (
    member_id = auth.uid()
    or trainer_id = auth.uid()
    or public.current_user_role() = 'admin'
  );

-- Scrittura: trainer (per le proprie) e admin possono creare/modificare/eliminare.
create policy workouts_write on public.workouts
  for all using (
    public.current_user_role() in ('admin', 'trainer')
  )
  with check (
    public.current_user_role() in ('admin', 'trainer')
  );
