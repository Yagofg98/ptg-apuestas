-- ============================================================================
-- RPC de administración: abrir partido (con cuotas ya calculadas en el cliente
-- por el motor odds.ts), bloquear apuestas y solicitar retirada.
-- ============================================================================

-- Helper: ¿el llamante es admin (cliente) o service-role (scraper)?
create or replace function is_admin_caller()
returns boolean language plpgsql stable as $$
declare v_role user_role;
begin
  if auth.role() = 'service_role' then return true; end if;
  select role into v_role from profiles where id = auth.uid();
  return v_role = 'admin';
end;
$$;

-- ----------------------------------------------------------------------------
-- Abrir un partido con sus mercados y cuotas iniciales.
-- p_markets: [{ "type":"winner", "outcomes":[{"label":"Pareja A","prior":0.6,"odds":1.58}, ...] }, ...]
-- ----------------------------------------------------------------------------
create or replace function open_match(
  p_scheduled_at timestamptz,
  p_team_a_p1 uuid, p_team_a_p2 uuid, p_team_b_p1 uuid, p_team_b_p2 uuid,
  p_markets jsonb,
  p_ptg_match_id text default null
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
  if not is_admin_caller() then raise exception 'solo admin'; end if;

  insert into matches (ptg_match_id, scheduled_at, status, team_a_p1, team_a_p2, team_b_p1, team_b_p2)
  values (p_ptg_match_id, p_scheduled_at, 'open', p_team_a_p1, p_team_a_p2, p_team_b_p1, p_team_b_p2)
  returning id into v_match_id;

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
-- Bloquear / reabrir apuestas de un partido
-- ----------------------------------------------------------------------------
create or replace function set_match_status(p_match_id uuid, p_status match_status)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin_caller() then raise exception 'solo admin'; end if;
  update matches set status = p_status where id = p_match_id;
  update markets set status = (case when p_status = 'open' then 'open' else 'locked' end)::market_status
   where match_id = p_match_id and status <> 'settled';
end;
$$;

-- ----------------------------------------------------------------------------
-- Alta automática: al crear un usuario (auth) → perfil + monedero a 0
-- ----------------------------------------------------------------------------
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, display_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)), 'player')
  on conflict (id) do nothing;
  insert into wallets (user_id, balance) values (new.id, 0)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ----------------------------------------------------------------------------
-- Solicitar retirada (el jugador) — la confirma el tesorero pagando por Bizum
-- ----------------------------------------------------------------------------
create or replace function request_withdrawal(p_tokens numeric)
returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_bal numeric;
begin
  if v_uid is null then raise exception 'no autenticado'; end if;
  if p_tokens <= 0 then raise exception 'importe inválido'; end if;
  select balance into v_bal from wallets where user_id = v_uid for update;
  if coalesce(v_bal,0) < p_tokens then raise exception 'saldo insuficiente'; end if;
  update wallets set balance = balance - p_tokens, updated_at = now() where user_id = v_uid;
  insert into transactions (user_id, type, amount, note)
  values (v_uid, 'withdrawal', -p_tokens, 'Retirada solicitada (pendiente de pago)');
end;
$$;
