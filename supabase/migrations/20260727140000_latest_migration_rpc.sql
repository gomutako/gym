-- =====================================================
-- MIGRATION — `public.latest_migration()` per la diagnostica admin.
--
-- Perché: il guasto più insidioso di questa architettura è il disallineamento
-- fra codice e schema. Se il frontend va in produzione PRIMA della migrazione,
-- scrive colonne che nel database non esistono: PostgREST le scarta, la
-- richiesta risponde 2xx e il dato non viene mai salvato. Nessun errore, da
-- nessuna parte. È lo stesso rischio che col vecchio backend era sorvegliato
-- confrontando la versione dell'app con quella del server.
--
-- Questa funzione espone la versione più recente applicata al database, così il
-- badge diagnostico può confrontarla con quella attesa dalla build.
--
-- `supabase_migrations` non è tra gli schemi esposti dall'API, quindi serve una
-- funzione SECURITY DEFINER: è l'unico modo per leggerla da un client.
-- =====================================================

create or replace function public.latest_migration()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v text;
begin
  -- Riservata all'admin: il badge diagnostico è una vista di amministrazione, e
  -- l'elenco delle migrazioni descrive l'infrastruttura. Coerente con
  -- l'impostazione del progetto, dove il perimetro lo decide sempre il database.
  if public.current_user_role() is distinct from 'admin' then
    raise exception 'Accesso negato: richiesto ruolo admin'
      using errcode = '42501';
  end if;

  select max(version) into v from supabase_migrations.schema_migrations;
  return v;
end;
$$;

comment on function public.latest_migration() is
  'Versione della migrazione più recente applicata. Usata dal badge diagnostico admin per rilevare il disallineamento fra schema e codice. Solo admin.';

revoke execute on function public.latest_migration() from public, anon;
grant execute on function public.latest_migration() to authenticated;
