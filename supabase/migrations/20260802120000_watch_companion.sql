-- =====================================================
-- MIGRATION — Correlazione fra sessione nata sul Watch e riga Supabase.
--
-- Una sessione avviata al polso non ha ancora un id: chi la apre genera un
-- client_session_id che accompagna ogni messaggio. L'indice unico rende la
-- materializzazione IDEMPOTENTE — svuotare il buffer due volte (succede se
-- l'app iPhone viene uccisa a metà) non crea due sessioni gemelle.
--
-- Nessuna nuova policy: la RLS di workout_sessions protegge già la riga per
-- member_id, e questa colonna è un dato come gli altri. Il guard di forma di
-- exercises_log è volutamente largo e non va toccato: accetta già le righe
-- di sets_log con il nuovo campo `uid`.
-- =====================================================
alter table public.workout_sessions
  add column client_session_id uuid;

create unique index idx_sessions_client_session
  on public.workout_sessions (member_id, client_session_id)
  where client_session_id is not null;
