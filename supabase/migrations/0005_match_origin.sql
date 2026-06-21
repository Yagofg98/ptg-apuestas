-- ============================================================================
-- Origen de los partidos + estado 'pending'.
-- Permite distinguir partidos creados por admin / por un usuario / auto-importados
-- de PTG, y marcar como 'pending' los importados de PTG que aún no tienen parejas.
--
-- ⚠️ El valor de enum nuevo va en ESTA migración (aparte de las funciones que lo
-- usan en 0006): Postgres no permite USAR un valor de enum en la misma transacción
-- en que se añade.
-- ============================================================================

alter table matches add column if not exists created_by uuid references profiles(id);
alter table matches add column if not exists origin text not null default 'admin';  -- 'admin' | 'user' | 'ptg'
alter table matches add column if not exists grupo text;                            -- azul / blanco / ... (PTG)

alter type match_status add value if not exists 'pending';
