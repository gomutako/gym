-- =====================================================
-- MIGRATION — Tipo di carico dell'esercizio.
-- Determina cosa si registra per ogni serie:
--   'weight' -> peso in kg (es. panca piana)
--   'level'  -> livello di difficoltà (es. tapis roulant)
-- =====================================================
alter table public.exercises
  add column load_type text not null default 'weight'
  check (load_type in ('weight', 'level'));
