-- =====================================================
-- MIGRATION — `email` denormalizzata su profiles (Fase 4.7).
--
-- Perché: l'email vive in `auth.users`, che il client con anon key non può
-- leggere. Per mostrarla (anagrafica clienti, lista utenti admin) il backend
-- chiamava `auth.admin.listUsers()` con la service_role key — ed è l'UNICO
-- motivo per cui esistono le rotte GET /api/members e GET /api/users.
-- Portando l'email su profiles, quelle due rotte diventano letture RLS dirette
-- e si possono cancellare.
--
-- La colonna è un riflesso di auth.users.email, non la fonte: la mantengono i
-- trigger qui sotto. Chi vuole CAMBIARE l'email deve passare da Supabase Auth
-- (Edge Function admin, Fase 4.8), non scrivere qui.
--
-- Visibilità: nessuna policy nuova. `profiles_select` già concede al member la
-- propria riga e a trainer/admin tutte — esattamente ciò che faceva il backend.
-- =====================================================

alter table public.profiles
  add column if not exists email text;

comment on column public.profiles.email is
  'Riflesso di auth.users.email, mantenuto dai trigger sync_profile_email / handle_new_user. Sola lettura per i client: per modificarla si passa da Supabase Auth.';

-- ----- Backfill dalle utenze esistenti -----
update public.profiles p
   set email = u.email
  from auth.users u
 where u.id = p.id
   and (p.email is distinct from u.email);

-- ----- Sincronizzazione: auth.users → profiles -----
-- Copre il cambio email fatto da un admin via Auth API e la conferma di un
-- cambio email da parte dell'utente.
create or replace function public.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
     set email = new.email
   where id = new.id
     and email is distinct from new.email;
  return null; -- AFTER trigger
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.sync_profile_email();

-- ----- Signup: scrive l'email subito, senza attendere una sync -----
-- Estende la funzione esistente (nome/cognome dai metadati + ruolo) aggiungendo
-- la colonna email. Resta retro-compatibile con i metadati `full_name`.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta_full text := new.raw_user_meta_data ->> 'full_name';
  fn text := coalesce(
    new.raw_user_meta_data ->> 'first_name',
    nullif(split_part(coalesce(meta_full, ''), ' ', 1), '')
  );
  ln text := coalesce(
    new.raw_user_meta_data ->> 'last_name',
    nullif(btrim(substr(coalesce(meta_full, ''),
      length(split_part(coalesce(meta_full, ''), ' ', 1)) + 1)), '')
  );
begin
  insert into public.profiles (id, first_name, last_name, role, email)
  values (
    new.id, fn, ln,
    coalesce((new.raw_user_meta_data ->> 'role')::public.user_role, 'member'),
    new.email
  );
  return new;
end;
$$;

-- ----- Guard: l'email non si scrive dai client -----
-- Estende il guard della Fase 1 (role, subscription_end_date). Senza questo, un
-- member potrebbe cambiarsi profiles.email e sfasarla da auth.users: la lista
-- admin mostrerebbe un indirizzo con cui non si può accedere.
create or replace function public.guard_profile_privileged_fields()
returns trigger
language plpgsql
as $$
begin
  -- service_role (Edge Function, seed) e ruoli di manutenzione: nessun vincolo.
  -- Anche i trigger SECURITY DEFINER di sincronizzazione passano da qui.
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;

  if new.email is distinct from old.email then
    raise exception 'L''email si cambia da Supabase Auth, non su profiles'
      using errcode = '42501';
  end if;

  -- l'admin gestisce ruoli e abbonamenti
  if public.current_user_role() = 'admin' then
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'Solo un amministratore può modificare il ruolo'
      using errcode = '42501';
  end if;

  if new.subscription_end_date is distinct from old.subscription_end_date then
    raise exception 'Solo un amministratore può modificare l''abbonamento'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- Indice: la lista utenti dell'admin ordina/filtra per email
create index if not exists idx_profiles_email on public.profiles (email);
