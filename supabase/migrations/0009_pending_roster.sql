-- ============================================================================
-- Roster de los partidos PTG por confirmar: guardamos los ranking ids de los
-- jugadores APUNTADOS (que crecen hasta 4 en PTG) y resolvemos sus nombres para
-- mostrarlos en la app como "pendiente de confirmación".
-- ============================================================================

alter table matches add column if not exists ptg_player_ids jsonb;

-- Partidos en estado 'pending' con los nombres de los apuntados ya resueltos.
create or replace function pending_matches()
returns table(id uuid, scheduled_at timestamptz, grupo text, player_names text[])
language sql security definer set search_path = public stable as $$
  select m.id, m.scheduled_at, m.grupo,
         coalesce(
           (select array_agg(p.name order by p.name)
              from players p
             where p.ptg_player_id in (select jsonb_array_elements_text(m.ptg_player_ids))),
           '{}'::text[]
         ) as player_names
    from matches m
   where m.status = 'pending'
   order by m.scheduled_at;
$$;
