-- =====================================================
-- MIGRATION — Scheda "disattivata" (archiviata).
-- Distinta da is_active ("in uso"): una scheda disattivata resta nello storico
-- ma sparisce dalle combobox di selezione, così negli anni la lista selezionabile
-- non diventa sterminata. Invariante: una scheda in uso non può essere archiviata.
-- =====================================================

alter table public.workouts
  add column if not exists archived boolean not null default false;

-- Invariante: in uso ⇒ non archiviata (gestita anche dal backend)
alter table public.workouts
  drop constraint if exists workouts_active_not_archived_ck;
alter table public.workouts
  add constraint workouts_active_not_archived_ck check (not (is_active and archived));

create index if not exists idx_workouts_member_archived
  on public.workouts (member_id, archived);
