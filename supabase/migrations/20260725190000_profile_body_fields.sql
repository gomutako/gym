-- =====================================================
-- MIGRATION — Dati anagrafici/fisici del profilo.
-- Campi opzionali, valorizzati dall'utente (self-service) dopo la registrazione.
-- Il BMI NON è una colonna: è derivato da height_cm/weight_kg lato client.
-- =====================================================
alter table public.profiles
  add column gender     text check (gender in ('uomo', 'donna', 'altro')),
  add column birth_date date,
  add column height_cm  numeric(5, 1),   -- altezza in cm
  add column weight_kg  numeric(5, 1),   -- peso in kg
  add column notes      text;
