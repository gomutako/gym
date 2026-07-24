-- =====================================================
-- MIGRATION — Scheda "attiva" (quella attualmente in uso).
-- Una sola scheda attiva per member: attivarne una disattiva le altre.
-- Impostabile dal member (sulle proprie) e da trainer/admin.
-- =====================================================

alter table public.workouts
  add column if not exists is_active boolean not null default false;

-- Al più una scheda attiva per member (integrità a livello DB)
create unique index if not exists workouts_one_active_per_member
  on public.workouts (member_id) where is_active;

-- La RLS su workouts consente al member di aggiornare le proprie schede?
-- Verifichiamo/aggiungiamo il permesso di update sulle PROPRIE schede: la
-- logica di business (quali campi, esclusività) resta nel backend, ma il
-- toggle "attiva" è un'azione del member sulle proprie righe.
drop policy if exists workouts_update_own on public.workouts;
create policy workouts_update_own on public.workouts
  for update using (
    member_id = auth.uid()
    or public.current_user_role() in ('admin', 'trainer')
  )
  with check (
    member_id = auth.uid()
    or public.current_user_role() in ('admin', 'trainer')
  );

-- touch_updated_at: updated_at riflette l'ultima modifica del CONTENUTO.
-- Attivare/disattivare (o un update che non cambia titolo/note/giornate) non
-- deve toccare updated_at, così le liste ordinate per "aggiornata" non si
-- riordinano quando si cambia solo la scheda in uso.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  if TG_TABLE_NAME = 'workouts'
     and new.title is not distinct from old.title
     and new.notes is not distinct from old.notes
     and new.days_json is not distinct from old.days_json
     and new.member_id is not distinct from old.member_id then
    return new; -- nessun cambiamento di contenuto: lascia updated_at com'è
  end if;
  new.updated_at = now();
  return new;
end;
$$;
