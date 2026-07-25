-- =====================================================
-- MIGRATION — Campi aggiuntivi del catalogo esercizi.
-- Allineano il modello alla fonte usata per il seed
-- (free-exercise-db: https://github.com/yuhonas/free-exercise-db),
-- che descrive ogni esercizio con più metadati di quelli iniziali.
-- muscle_group resta il muscolo PRIMARIO (già presente); qui si aggiungono:
--   equipment          : attrezzatura (testo libero, es. Bilanciere/Manubri/Cavi)
--   category           : categoria (testo libero, es. forza/cardio/stretching)
--   force              : tipo di sforzo (spinta/trazione/statico)
--   level              : livello di difficoltà (principiante/intermedio/avanzato)
--   mechanic           : meccanica del movimento (composto/isolamento)
--   secondary_muscles  : muscoli secondari coinvolti (lista)
-- I valori enumerati sono in italiano (coerenti con la UI); il seed traduce
-- i valori inglesi della fonte.
-- =====================================================
alter table public.exercises
  add column equipment         text,
  add column category          text,
  add column force             text check (force in ('spinta', 'trazione', 'statico')),
  add column level             text check (level in ('principiante', 'intermedio', 'avanzato')),
  add column mechanic          text check (mechanic in ('composto', 'isolamento')),
  add column secondary_muscles text[] not null default '{}';
