-- =====================================================
-- MIGRATION — Storico abbonamenti.
-- Passiamo dalla singola data (profiles.subscription_end_date) a uno STORICO
-- di periodi. Per non toccare home/auth/report, profiles.subscription_end_date
-- resta come valore DENORMALIZZATO (= max delle date di fine dei periodi),
-- mantenuto da un trigger. 'Attivo' continua a significare end >= oggi.
-- =====================================================

create table public.subscriptions (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references public.profiles (id) on delete cascade,
  start_date date not null,
  end_date   date not null,
  created_at timestamptz not null default now(),
  constraint subscriptions_dates_ck check (end_date >= start_date)
);

create index idx_subscriptions_member on public.subscriptions (member_id);

grant all on public.subscriptions to anon, authenticated, service_role;

alter table public.subscriptions enable row level security;

-- Lettura: il member i propri periodi; trainer/admin tutti.
create policy subscriptions_select on public.subscriptions
  for select using (
    member_id = auth.uid()
    or public.current_user_role() in ('admin', 'trainer')
  );

-- Scrittura: solo admin (gestione abbonamenti).
create policy subscriptions_write on public.subscriptions
  for all using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- Mantiene profiles.subscription_end_date = max(end_date) dei periodi del member
-- (null se non ne ha più). Gira su insert/update/delete.
create or replace function public.sync_subscription_end()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  mid uuid := coalesce(new.member_id, old.member_id);
begin
  update public.profiles p
     set subscription_end_date = (
       select max(end_date) from public.subscriptions s where s.member_id = mid
     )
   where p.id = mid;
  return null; -- AFTER trigger: valore di ritorno ignorato
end;
$$;

create trigger subscriptions_sync_end
  after insert or update or delete on public.subscriptions
  for each row execute function public.sync_subscription_end();

-- Backfill: chi ha già una data di scadenza ottiene un primo periodo
-- (inizio = data di creazione del profilo, fine = data di scadenza attuale).
insert into public.subscriptions (member_id, start_date, end_date)
select id, created_at::date, subscription_end_date
from public.profiles
where subscription_end_date is not null;
