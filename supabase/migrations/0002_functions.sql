-- ============================================================================
-- Funciones RPC (SECURITY DEFINER) para operaciones sensibles y atómicas.
-- El cliente NO inserta apuestas/saldos directamente: llama a estas funciones,
-- que validan saldo, bloquean cuotas y mantienen el ledger cuadrado.
-- La lógica de cuotas replica web/src/lib/odds.ts (mantener en sync).
-- ============================================================================

-- Parámetros del motor de cuotas (deben coincidir con DEFAULT_CONFIG en TS)
create table if not exists odds_settings (
  id              int primary key default 1,
  margin          numeric not null default 0.05,
  prior_liquidity numeric not null default 500,
  max_payout      numeric not null default 100000,
  check (id = 1)
);
insert into odds_settings (id) values (1) on conflict do nothing;

-- ----------------------------------------------------------------------------
-- prob → cuota con margen (espejo de probToOdds)
-- ----------------------------------------------------------------------------
create or replace function prob_to_odds(p numeric, p_margin numeric)
returns numeric language sql immutable as $$
  select greatest(1.01, round( (1.0 / greatest(least(p, 0.999999), 0.000001)) / (1 + p_margin), 2));
$$;

-- ----------------------------------------------------------------------------
-- Recalcular las cuotas vivas de TODOS los outcomes de un mercado
-- pFinal = lambda·prior + (1-lambda)·(staked/total),  lambda = L/(L+total)
-- ----------------------------------------------------------------------------
create or replace function recalc_market_odds(p_market_id uuid)
returns void language plpgsql as $$
declare
  v_total   numeric;
  v_margin  numeric;
  v_liq     numeric;
  v_lambda  numeric;
  r         record;
  v_pmoney  numeric;
  v_pfinal  numeric;
begin
  select margin, prior_liquidity into v_margin, v_liq from odds_settings where id = 1;
  select coalesce(sum(total_staked), 0) into v_total from outcomes where market_id = p_market_id;

  if v_total <= 0 then
    -- sin dinero: la cuota = prior puro
    update outcomes set current_odds = prob_to_odds(prior_prob, v_margin)
     where market_id = p_market_id;
    return;
  end if;

  v_lambda := v_liq / (v_liq + v_total);

  for r in select id, prior_prob, total_staked from outcomes where market_id = p_market_id loop
    v_pmoney := r.total_staked / v_total;
    v_pfinal := v_lambda * r.prior_prob + (1 - v_lambda) * v_pmoney;
    update outcomes set current_odds = prob_to_odds(v_pfinal, v_margin) where id = r.id;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- Colocar una apuesta (simple o combinada)
-- p_legs: jsonb array de outcome_id, p.ej. ["uuid1","uuid2"]
-- ----------------------------------------------------------------------------
create or replace function place_bet(p_legs jsonb, p_stake numeric)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid       uuid := auth.uid();
  v_balance   numeric;
  v_combined  numeric := 1;
  v_payout    numeric;
  v_maxpay    numeric;
  v_bet_id    uuid;
  v_outcome   uuid;
  v_odds      numeric;
  v_market    uuid;
  v_mstatus   market_status;
  v_mstatch   match_status;
  v_count     int;
  v_seen      uuid[] := '{}';
begin
  if v_uid is null then raise exception 'no autenticado'; end if;
  if p_stake is null or p_stake <= 0 then raise exception 'stake inválido'; end if;

  v_count := jsonb_array_length(p_legs);
  if v_count < 1 then raise exception 'la apuesta necesita al menos 1 pata'; end if;

  -- Bloquear el monedero y comprobar saldo
  select balance into v_balance from wallets where user_id = v_uid for update;
  if v_balance is null then raise exception 'sin monedero'; end if;
  if v_balance < p_stake then raise exception 'saldo insuficiente'; end if;

  select max_payout into v_maxpay from odds_settings where id = 1;

  -- Crear la apuesta (placeholder; rellenamos cuotas tras recorrer las patas)
  insert into bets (user_id, stake, combined_odds, potential_payout, status, is_combo)
  values (v_uid, p_stake, 1, 0, 'pending', v_count > 1)
  returning id into v_bet_id;

  -- Recorrer cada pata: validar mercado abierto, bloquear cuota
  for v_outcome in select (jsonb_array_elements_text(p_legs))::uuid loop
    if v_outcome = any(v_seen) then
      raise exception 'pata duplicada en la combinada';
    end if;
    v_seen := array_append(v_seen, v_outcome);

    select o.current_odds, o.market_id, m.status, mt.status
      into v_odds, v_market, v_mstatus, v_mstatch
      from outcomes o
      join markets m on m.id = o.market_id
      join matches mt on mt.id = m.match_id
     where o.id = v_outcome
     for update of o;

    if v_odds is null then raise exception 'resultado inexistente'; end if;
    if v_mstatus <> 'open' or v_mstatch <> 'open' then
      raise exception 'mercado cerrado para apuestas';
    end if;

    insert into bet_legs (bet_id, outcome_id, locked_odds) values (v_bet_id, v_outcome, v_odds);
    v_combined := v_combined * v_odds;

    -- sumar el dinero a este resultado y recalcular cuotas vivas del mercado
    update outcomes set total_staked = total_staked + p_stake where id = v_outcome;
    perform recalc_market_odds(v_market);
  end loop;

  v_combined := round(v_combined, 2);
  v_payout := least(v_maxpay, round(p_stake * v_combined, 2));

  update bets set combined_odds = v_combined, potential_payout = v_payout where id = v_bet_id;

  -- Debitar saldo y registrar en el ledger
  update wallets set balance = balance - p_stake, updated_at = now() where user_id = v_uid;
  insert into transactions (user_id, type, amount, ref_id, note)
  values (v_uid, 'bet_stake', -p_stake, v_bet_id, 'Apuesta colocada');

  return v_bet_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- Confirmar un depósito (solo tesorero/admin) → acredita tokens
-- ----------------------------------------------------------------------------
create or replace function confirm_deposit(p_deposit_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_role   user_role;
  v_uid    uuid := auth.uid();
  v_user   uuid;
  v_tokens numeric;
  v_status deposit_status;
begin
  -- el tesorero/admin (cliente) o el service-role (servidor) pueden confirmar
  if auth.role() <> 'service_role' then
    select role into v_role from profiles where id = v_uid;
    if v_role not in ('admin','treasurer') then raise exception 'no autorizado'; end if;
  end if;

  select user_id, tokens, status into v_user, v_tokens, v_status
    from deposits where id = p_deposit_id for update;
  if v_user is null then raise exception 'depósito inexistente'; end if;
  if v_status <> 'requested' then raise exception 'depósito ya procesado'; end if;

  update deposits set status = 'confirmed', confirmed_by = v_uid, confirmed_at = now()
   where id = p_deposit_id;

  insert into wallets (user_id, balance) values (v_user, v_tokens)
  on conflict (user_id) do update set balance = wallets.balance + v_tokens, updated_at = now();

  insert into transactions (user_id, type, amount, ref_id, note)
  values (v_user, 'deposit', v_tokens, p_deposit_id, 'Depósito confirmado');
end;
$$;

-- ----------------------------------------------------------------------------
-- Liquidar un partido: marca resultado, califica patas y abona premios.
-- p_winner: 'A'|'B'  ·  p_had_bagel/p_three_sets: booleanos del resultado
-- ----------------------------------------------------------------------------
create or replace function settle_match(
  p_match_id uuid, p_winner char, p_had_bagel boolean, p_three_sets boolean, p_set_scores jsonb
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_role user_role;
  v_uid  uuid := auth.uid();
  mk     record;
  v_win_label text;
  v_win_outcome uuid;
  b      record;
begin
  -- admin (cliente) o service-role (scraper) pueden liquidar
  if auth.role() <> 'service_role' then
    select role into v_role from profiles where id = v_uid;
    if v_role <> 'admin' then raise exception 'solo admin liquida'; end if;
  end if;

  update matches set
     status = 'settled', winner_team = p_winner, had_bagel = p_had_bagel,
     went_to_3_sets = p_three_sets, set_scores = p_set_scores, settled_at = now()
   where id = p_match_id;

  -- Determinar el outcome ganador de cada mercado del partido
  for mk in select id, type from markets where match_id = p_match_id loop
    v_win_label :=
      case mk.type
        when 'winner' then case p_winner when 'A' then 'Pareja A' else 'Pareja B' end
        when 'bagel'  then case when p_had_bagel then 'Sí' else 'No' end
        when 'sets'   then case when p_three_sets then '3 sets' else '2 sets' end
      end;

    select id into v_win_outcome from outcomes
      where market_id = mk.id and label = v_win_label limit 1;

    update markets set status = 'settled', settled_outcome_id = v_win_outcome where id = mk.id;

    -- marcar las patas ganadoras/perdedoras de este mercado
    update bet_legs set result = 'won'
      where outcome_id = v_win_outcome and result = 'pending';
    update bet_legs set result = 'lost'
      where outcome_id in (select id from outcomes where market_id = mk.id and id <> v_win_outcome)
        and result = 'pending';
  end loop;

  -- Resolver apuestas cuyas patas ya están todas decididas
  for b in
    select bt.id, bt.user_id, bt.potential_payout
      from bets bt where bt.status = 'pending'
       and not exists (select 1 from bet_legs l where l.bet_id = bt.id and l.result = 'pending')
  loop
    if exists (select 1 from bet_legs l where l.bet_id = b.id and l.result = 'lost') then
      update bets set status = 'lost', settled_at = now() where id = b.id;
    else
      -- todas ganadas → pagar
      update bets set status = 'won', settled_at = now() where id = b.id;
      update wallets set balance = balance + b.potential_payout, updated_at = now()
        where user_id = b.user_id;
      insert into transactions (user_id, type, amount, ref_id, note)
      values (b.user_id, 'bet_payout', b.potential_payout, b.id, 'Premio de apuesta');
    end if;
  end loop;
end;
$$;
