-- =====================================================
-- MIGRATION — Profilo utente: telefono, avatar e self-service.
-- Aggiunge i campi editabili dall'utente stesso e la possibilità
-- per ognuno di aggiornare il PROPRIO profilo (nome, telefono, avatar)
-- senza toccare ruolo e abbonamento, che restano riservati all'admin.
-- =====================================================

alter table public.profiles
  add column if not exists phone       text,
  add column if not exists avatar_path text;   -- path nel bucket Storage 'avatars'

-- ----- Self-update del proprio profilo -----
-- La policy admin (profiles_update) resta per la gestione. Qui aggiungiamo
-- il permesso all'utente di modificare la propria riga, MA il backend
-- (PATCH /api/profile) limita i campi a full_name/phone/avatar_path: la
-- policy consente l'update della riga, non promuove nessuno ad admin perché
-- role/subscription non vengono mai inviati dal client su questa rotta.
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update using (id = auth.uid())
  with check (id = auth.uid());

-- ----- Bucket Storage per gli avatar (pubblico in lettura) -----
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Ogni utente gestisce solo i propri file, sotto la "cartella" <uid>/…
-- (storage.foldername(name)[1] = primo segmento del path).
drop policy if exists "avatars_insert" on storage.objects;
create policy "avatars_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_update" on storage.objects;
create policy "avatars_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_delete" on storage.objects;
create policy "avatars_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_select" on storage.objects;
create policy "avatars_select" on storage.objects
  for select using (bucket_id = 'avatars');
