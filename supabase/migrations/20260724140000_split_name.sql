-- =====================================================
-- MIGRATION — Nome e cognome separati.
-- `full_name` diventa una colonna GENERATA da first_name + last_name:
-- tutte le letture esistenti (liste, header, combobox) continuano a
-- funzionare senza modifiche; cambiano solo i punti che SCRIVONO il nome
-- (rotte profilo/admin, trigger di signup, seed).
-- =====================================================

alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name  text;

-- Backfill: primo token -> nome, il resto -> cognome
update public.profiles set
  first_name = nullif(split_part(coalesce(full_name, ''), ' ', 1), ''),
  last_name  = nullif(btrim(substr(coalesce(full_name, ''),
                 length(split_part(coalesce(full_name, ''), ' ', 1)) + 1)), '')
where first_name is null and last_name is null;

-- full_name da colonna dati a colonna generata (single source of truth = first/last)
alter table public.profiles drop column full_name;
-- Nota: concat_ws è STABLE (non IMMUTABLE) → non ammessa in una colonna
-- generata. Usiamo la concatenazione con || (immutable).
alter table public.profiles
  add column full_name text generated always as
    (nullif(btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), '')) stored;

-- Trigger di signup: scrive first_name/last_name dai metadati.
-- Retro-compatibile: se arriva solo 'full_name' nei metadati, lo splitta.
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
  insert into public.profiles (id, first_name, last_name, role)
  values (
    new.id, fn, ln,
    coalesce((new.raw_user_meta_data ->> 'role')::public.user_role, 'member')
  );
  return new;
end;
$$;
