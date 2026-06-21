-- ============================================================================
-- Partidos creados por usuarios + jugadores "ad-hoc" (de fuera de PTG).
--
--  · open_match: ahora lo puede llamar CUALQUIER usuario autenticado (no solo admin)
--    y admite rellenar un partido PTG ya importado como 'pending' (p_existing_match_id).
--  · create_adhoc_player: alta rápida de un jugador suelto (sin ranking PTG), para
--    los partidos que la peña juega fuera de PTG.
--
--  Liquidar (settle_match) y bloquear (set_match_status) SIGUEN siendo solo de admin:
--  así quien crea un partido y apuesta NO puede autopagarse el bote.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Abrir un partido (creado por usuario/admin) o CONFIGURAR un shell PTG pendiente.
-- p_existing_match_id:
--   · null  → crea un partido nuevo (status 'open').
--   · uuid  → rellena las parejas de un partido 'pending' (importado de PTG) y lo abre.
-- p_markets: [{ "type":"winner", "outcomes":[{"label":"Pareja A","prior":0.6,"odds":1.58}, ...] }, ...]
-- ----------------------------------------------------------------------------
create or replace function open_match(
  p_scheduled_at timestamptz,
  p_team_a_p1 uuid, p_team_a_p2 uuid, p_team_b_p1 uuid, p_team_b_p2 uuid,
  p_markets jsonb,
  p_ptg_match_id text default null,
  p_origin text default 'user',
  p_existing_match_id uuid default null
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_match_id  uuid;
  v_market    jsonb;
  v_market_id uuid;
  v_outcome   jsonb;
  v_i         int;
begin
  if auth.uid() is null and auth.role() <> 'service_role' then
    raise exception 'no autenticado';
  end if;

  if p_existing_match_id is null then
    insert into matches (ptg_match_id, scheduled_at, status, created_by, origin,
                         team_a_p1, team_a_p2, team_b_p1, team_b_p2)
    values (p_ptg_match_id, p_scheduled_at, 'open', auth.uid(), coalesce(p_origin, 'user'),
            p_team_a_p1, p_team_a_p2, p_team_b_p1, p_team_b_p2)
    returning id into v_match_id;
  else
    update matches
       set scheduled_at = p_scheduled_at,
           status       = 'open',
           created_by   = coalesce(created_by, auth.uid()),
           team_a_p1    = p_team_a_p1, team_a_p2 = p_team_a_p2,
           team_b_p1    = p_team_b_p1, team_b_p2 = p_team_b_p2
     where id = p_existing_match_id and status = 'pending'
     returning id into v_match_id;
    if v_match_id is null then raise exception 'partido no encontrado o ya configurado'; end if;
  end if;

  for v_market in select * from jsonb_array_elements(p_markets) loop
    insert into markets (match_id, type)
    values (v_match_id, (v_market->>'type')::market_type)
    returning id into v_market_id;

    v_i := 0;
    for v_outcome in select * from jsonb_array_elements(v_market->'outcomes') loop
      insert into outcomes (market_id, label, prior_prob, current_odds, sort_order)
      values (
        v_market_id,
        v_outcome->>'label',
        (v_outcome->>'prior')::numeric,
        (v_outcome->>'odds')::numeric,
        v_i
      );
      v_i := v_i + 1;
    end loop;
  end loop;

  return v_match_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- Alta rápida de un jugador suelto (sin vínculo PTG). Defaults del esquema:
-- ranking 999 y % victorias 0.5 → cuota base ≈ 50%. Cualquier usuario autenticado.
-- ----------------------------------------------------------------------------
create or replace function create_adhoc_player(p_name text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'no autenticado'; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'nombre vacío'; end if;
  insert into players (name) values (btrim(p_name)) returning id into v_id;
  return v_id;
end;
$$;
