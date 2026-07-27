-- =====================================================
-- MIGRATION — Hardening della RLS (Fase 1 del piano di migrazione).
--
-- Contesto: finora la RLS era la SECONDA difesa e il backend Fastify la prima
-- (le rotte limitavano i campi scrivibili). Il backend però NON è sulla strada
-- obbligata: il frontend ha la anon key nel bundle, quindi qualunque utente
-- autenticato può chiamare PostgREST direttamente e scrivere ciò che la RLS
-- consente. Eliminando il backend la RLS diventa l'UNICA difesa, e queste
-- regole vanno spostate nel database.
--
-- Cosa fa:
--   1. profiles   — solo l'admin può cambiare `role` e `subscription_end_date`
--                   (prima un member poteva promuoversi ad admin da sé)
--   2. workouts   — un trainer scrive solo le PROPRIE schede (prima: tutte)
--   3. workouts   — un member sulle proprie schede tocca solo is_active/archived
--   4. bookings   — capacità del corso applicata dal DB, con lock (prima il
--                   backend contava-e-inseriva senza lock: race condition)
--   5. days_json / exercises_log — validazione di forma (prima la faceva solo
--                   lo schema JSON di Fastify)
--   6. anon       — revocati i privilegi di tabella non necessari
--
-- Nota sui bypass: i guard trigger lasciano passare `service_role` e i ruoli
-- di manutenzione (`postgres`, `supabase_admin`). Serve perché il backend
-- Fastify usa la service_role key e deve continuare a funzionare finché non
-- viene smantellato (Fase 4), e perché il seed e le migration girano come
-- postgres. I trigger sono SECURITY INVOKER di proposito: solo così
-- `current_user` riflette il ruolo del chiamante e non quello del proprietario.
-- =====================================================

-- =====================================================
-- 1. profiles — campi privilegiati riservati all'admin
-- =====================================================
-- `profiles_update_self` consente al member di aggiornare la PROPRIA riga
-- (serve per nome, telefono, avatar, dati fisici) ma non distingue le colonne:
-- senza questo guard un member può fare
--   PATCH /rest/v1/profiles?id=eq.<self>  {"role":"admin"}
-- e diventare amministratore, oppure allungarsi l'abbonamento.
create or replace function public.guard_profile_privileged_fields()
returns trigger
language plpgsql
as $$
begin
  -- service_role (backend, seed) e ruoli di manutenzione: nessun vincolo
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;

  -- l'admin gestisce ruoli e abbonamenti
  if public.current_user_role() = 'admin' then
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'Solo un amministratore può modificare il ruolo'
      using errcode = '42501';
  end if;

  -- subscription_end_date è denormalizzata da public.subscriptions (tabella
  -- scrivibile solo dall'admin) e mantenuta dal trigger sync_subscription_end,
  -- che gira SECURITY DEFINER come postgres → esce dal ramo di bypass sopra.
  if new.subscription_end_date is distinct from old.subscription_end_date then
    raise exception 'Solo un amministratore può modificare l''abbonamento'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_privileged_fields on public.profiles;
create trigger profiles_guard_privileged_fields
  before update on public.profiles
  for each row execute function public.guard_profile_privileged_fields();

-- =====================================================
-- 2. workouts — il trainer scrive solo le proprie schede
-- =====================================================
-- Prima: `using/with check (current_user_role() in ('admin','trainer'))`, quindi
-- un trainer poteva modificare o cancellare le schede create da altri trainer.
-- La lettura non cambia: resta governata da workouts_select (le policy
-- permissive si sommano in OR).
drop policy if exists workouts_write on public.workouts;
create policy workouts_write on public.workouts
  for all using (
    public.current_user_role() = 'admin'
    or (public.current_user_role() = 'trainer' and trainer_id = auth.uid())
  )
  with check (
    public.current_user_role() = 'admin'
    or (public.current_user_role() = 'trainer' and trainer_id = auth.uid())
  );

-- =====================================================
-- 3. workouts — il member tocca solo is_active / archived
-- =====================================================
-- `workouts_update_own` esiste per il toggle "in uso" del member, ma consente
-- l'update di TUTTA la riga: senza guard un member potrebbe riscriversi
-- days_json o cambiare trainer_id. I due campi ammessi corrispondono alle
-- uniche rotte che il backend esponeva al member
-- (PATCH /api/workouts/:id/active e /archived).
create or replace function public.guard_workout_member_fields()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;

  -- trainer/admin passano: il perimetro è già definito da workouts_write
  if public.current_user_role() in ('admin', 'trainer') then
    return new;
  end if;

  -- da qui: member sulla propria scheda (garantito da workouts_update_own)
  if new.id            is distinct from old.id
     or new.member_id  is distinct from old.member_id
     or new.trainer_id is distinct from old.trainer_id
     or new.title      is distinct from old.title
     or new.notes      is distinct from old.notes
     or new.goal       is distinct from old.goal
     or new.level      is distinct from old.level
     or new.days_json  is distinct from old.days_json
  then
    raise exception 'Su una scheda assegnata puoi cambiare solo "in uso" e "archiviata"'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists workouts_guard_member_fields on public.workouts;
create trigger workouts_guard_member_fields
  before update on public.workouts
  for each row execute function public.guard_workout_member_fields();

-- =====================================================
-- 3b. workouts — esclusività di "in uso" garantita dal database
-- =====================================================
-- L'indice `workouts_one_active_per_member` ammette al più una scheda attiva per
-- member, ma NON disattiva le altre: lo faceva il backend in due passaggi
-- (PATCH /api/workouts/:id/active azzerava le altre e poi attivava questa).
-- Senza backend il client si troverebbe un errore di chiave duplicata, e due
-- richieste concorrenti resterebbero comunque in race. Qui l'invariante è del DB.
--
-- SECURITY DEFINER di proposito: l'esclusività è un'invariante di sistema e deve
-- valere anche quando la scheda attualmente attiva appartiene a un altro
-- trainer (la RLS impedirebbe al chiamante di toccarla). Girando come owner,
-- l'UPDATE interno bypassa la RLS e i guard trigger lo lasciano passare.
create or replace function public.enforce_single_active_workout()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- archiviare esclude "in uso" (invariante workouts_active_not_archived_ck)
  if new.archived and new.is_active then
    new.is_active := false;
  end if;

  if new.is_active and (tg_op = 'INSERT' or not coalesce(old.is_active, false)) then
    update public.workouts
       set is_active = false
     where member_id = new.member_id
       and id <> new.id
       and is_active;

    -- mettere in uso una scheda la riporta fuori dall'archivio
    new.archived := false;
  end if;

  return new;
end;
$$;

drop trigger if exists workouts_enforce_single_active on public.workouts;
create trigger workouts_enforce_single_active
  before insert or update on public.workouts
  for each row execute function public.enforce_single_active_workout();

-- =====================================================
-- 4. bookings — capacità del corso applicata dal database
-- =====================================================
-- Il controllo stava in backend/src/routes/bookings.js: contava le prenotazioni
-- e poi inseriva, senza lock → due richieste concorrenti sull'ultimo posto
-- passavano entrambe. Qui il `for update` sulla riga del corso serializza i
-- concorrenti, quindi questo trigger CORREGGE UN BUG oltre a spostare la regola.
-- SECURITY DEFINER perché il member non può leggere le prenotazioni altrui
-- (bookings_select): il conteggio va fatto fuori dalla RLS.
create or replace function public.enforce_class_capacity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cap   int;
  taken int;
begin
  select max_capacity into cap
    from public.classes
   where id = new.class_id
     for update;   -- serializza le prenotazioni sullo stesso corso

  if cap is null then
    raise exception 'Corso non trovato' using errcode = '23503';
  end if;

  select count(*) into taken
    from public.bookings
   where class_id = new.class_id;

  if taken >= cap then
    raise exception 'Corso al completo' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists bookings_enforce_capacity on public.bookings;
create trigger bookings_enforce_capacity
  before insert on public.bookings
  for each row execute function public.enforce_class_capacity();

-- =====================================================
-- 5. Validazione di forma di days_json / exercises_log
-- =====================================================
-- Spariti gli schemi JSON di Fastify, il DB deve rifiutare i payload malformati.
-- Si usano TRIGGER e non CHECK constraint per due motivi: il messaggio d'errore
-- è leggibile in italiano, e un CHECK che invoca una funzione crea una
-- dipendenza che può inciampare in fase di restore di un pg_dump (rilevante:
-- il backup della Fase 5 è un pg_dump).
-- Le righe già esistenti non vengono rivalidate: i trigger scattano solo sulle
-- scritture nuove.

-- Forma attesa:
--   [{ "name": "Giorno A",
--      "exercises": [{ exercise_id: uuid, sets: int, reps: int, rest_seconds: int }] }]
create or replace function public.is_valid_days_json(p jsonb)
returns boolean
language sql
immutable
as $$
  select p is null
      or (
        jsonb_typeof(p) = 'array'
        and not exists (
          select 1
            from jsonb_array_elements(p) as d
           where jsonb_typeof(d.value) <> 'object'
              or (d.value ? 'name'      and jsonb_typeof(d.value -> 'name') <> 'string')
              or (d.value ? 'exercises' and jsonb_typeof(d.value -> 'exercises') <> 'array')
              or exists (
                   select 1
                     from jsonb_array_elements(
                            coalesce(d.value -> 'exercises', '[]'::jsonb)) as e
                    where jsonb_typeof(e.value) <> 'object'
                       or (e.value ? 'exercise_id'
                           and jsonb_typeof(e.value -> 'exercise_id') <> 'string')
                       or (e.value ? 'sets'
                           and jsonb_typeof(e.value -> 'sets') <> 'number')
                       or (e.value ? 'reps'
                           and jsonb_typeof(e.value -> 'reps') <> 'number')
                       or (e.value ? 'rest_seconds'
                           and jsonb_typeof(e.value -> 'rest_seconds') <> 'number')
                 )
        )
      );
$$;

create or replace function public.guard_days_json()
returns trigger
language plpgsql
as $$
begin
  if not public.is_valid_days_json(new.days_json) then
    raise exception 'days_json non ha la forma attesa (giornate con esercizi)'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists workouts_guard_days_json on public.workouts;
create trigger workouts_guard_days_json
  before insert or update on public.workouts
  for each row execute function public.guard_days_json();

drop trigger if exists workout_templates_guard_days_json on public.workout_templates;
create trigger workout_templates_guard_days_json
  before insert or update on public.workout_templates
  for each row execute function public.guard_days_json();

-- exercises_log: validazione volutamente più larga di days_json, perché il
-- client la riscrive a ogni serie completata durante l'allenamento e la forma
-- ha campi opzionali (incline solo per gli esercizi che la prevedono).
-- Si verifica l'ossatura: array di oggetti, con sets_log array quando presente.
create or replace function public.guard_exercises_log()
returns trigger
language plpgsql
as $$
begin
  if new.exercises_log is not null
     and (
       jsonb_typeof(new.exercises_log) <> 'array'
       or exists (
            select 1
              from jsonb_array_elements(new.exercises_log) as ex
             where jsonb_typeof(ex.value) <> 'object'
                or (ex.value ? 'sets_log'
                    and jsonb_typeof(ex.value -> 'sets_log') <> 'array')
          )
     )
  then
    raise exception 'exercises_log non ha la forma attesa (elenco di esercizi con serie)'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists sessions_guard_exercises_log on public.workout_sessions;
create trigger sessions_guard_exercises_log
  before insert or update on public.workout_sessions
  for each row execute function public.guard_exercises_log();

-- =====================================================
-- 6. Restringere i privilegi di `anon`
-- =====================================================
-- init.sql fa `grant all on all tables in schema public to anon`. Le policy
-- oggi bloccano comunque l'anonimo (tutte richiedono auth.uid() o
-- auth.role() = 'authenticated'), quindi non c'è un buco aperto: questa è
-- difesa in profondità, così una policy futura scritta con distrazione non
-- diventa automaticamente un accesso pubblico.
-- `anon` serve solo per login/registrazione, che passano da GoTrue e non
-- toccano le tabelle di public.
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
-- usage sullo schema resta: senza, PostgREST non riesce nemmeno a introspettare
grant usage on schema public to anon;
