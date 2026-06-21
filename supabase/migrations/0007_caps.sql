-- ============================================================================
-- Topes para que las cuotas tengan sentido:
--  · max_stake_per_match  → un jugador no puede apostar más de X tk en un mismo partido.
--  · monthly_deposit_cap_tokens → cada jugador solo puede ingresar hasta X tk al mes.
--  · tokens_per_eur → fuente única de la paridad token/€ (espejo de VITE_TOKENS_PER_EUR).
-- Y los depósitos pasan a auto-acreditarse (sin tesorero) vía deposit_tokens().
-- ============================================================================

alter table odds_settings add column if not exists max_stake_per_match      numeric not null default 2000;
alter table odds_settings add column if not exists monthly_deposit_cap_tokens numeric not null default 10000;
alter table odds_settings add column if not exists tokens_per_eur            numeric not null default 100;

-- ----------------------------------------------------------------------------
-- place_bet (parimutuel) + TOPE por jugador y partido. Reemplaza la de 0004.
-- ----------------------------------------------------------------------------
create or replace function place_bet(p_legs jsonb, p_stake numeric)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_balance  numeric;
  v_combined numeric := 1;
  v_payout   numeric;
  v_bet_id   uuid;
  v_outcome  uuid;
  v_odds     numeric;
  v_market   uuid;
  v_match    uuid;
  v_mstatus  market_status;
  v_mtstatus match_status;
  v_count    int;
  v_combo    boolean;
  v_seen     uuid[] := '{}';
  v_match0   uuid;
  v_max_match    numeric;
  v_match_staked numeric;
begin
  if v_uid is null then raise exception 'no autenticado'; end if;
  if p_stake is null or p_stake <= 0 then raise exception 'stake inválido'; end if;
  v_count := jsonb_array_length(p_legs);
  if v_count < 1 then raise exception 'la apuesta necesita al menos 1 pata'; end if;
  v_combo := v_count > 1;

  select balance into v_balance from wallets where user_id = v_uid for update;
  if coalesce(v_balance,0) < p_stake then raise exception 'saldo insuficiente'; end if;

  insert into bets (user_id, stake, combined_odds, potential_payout, status, is_combo)
  values (v_uid, p_stake, 1, 0, 'pending', v_combo)
  returning id into v_bet_id;

  for v_outcome in select (jsonb_array_elements_text(p_legs))::uuid loop
    if v_outcome = any(v_seen) then raise exception 'pata duplicada'; end if;
    v_seen := array_append(v_seen, v_outcome);

    select o.current_odds, o.market_id, m.match_id, m.status, mt.status
      into v_odds, v_market, v_match, v_mstatus, v_mtstatus
      from outcomes o
      join markets m on m.id = o.market_id
      join matches mt on mt.id = m.match_id
     where o.id = v_outcome for update of o;

    if v_odds is null then raise exception 'resultado inexistente'; end if;
    if v_mstatus <> 'open' or v_mtstatus <> 'open' then raise exception 'mercado cerrado'; end if;

    if v_match0 is null then v_match0 := v_match;
    elsif v_match0 <> v_match then raise exception 'la combinada debe ser del mismo partido'; end if;

    insert into bet_legs (bet_id, outcome_id, locked_odds) values (v_bet_id, v_outcome, v_odds);
    v_combined := v_combined * v_odds;

    if not v_combo then
      update outcomes set total_staked = total_staked + p_stake where id = v_outcome;
      perform recalc_market_odds(v_market);
    end if;
  end loop;

  -- TOPE por jugador y partido: lo ya apostado por este usuario en el partido + lo nuevo.
  select max_stake_per_match into v_max_match from odds_settings where id = 1;
  select coalesce(sum(bt.stake), 0) into v_match_staked
    from bets bt
   where bt.user_id = v_uid and bt.id <> v_bet_id and bt.status <> 'void'
     and exists (
       select 1 from bet_legs l
         join outcomes o on o.id = l.outcome_id
         join markets m on m.id = o.market_id
        where l.bet_id = bt.id and m.match_id = v_match0);
  if v_match_staked + p_stake > v_max_match then
    raise exception 'tope de apuesta por partido superado (máx % tk; ya tienes % en este partido)',
      v_max_match, v_match_staked;
  end if;

  if v_combo then
    update matches set combo_pool = combo_pool + p_stake where id = v_match0;
  end if;

  v_combined := round(v_combined, 2);
  v_payout := round(p_stake * v_combined, 2); -- ESTIMADO (informativo)
  update bets set combined_odds = v_combined, potential_payout = v_payout where id = v_bet_id;

  update wallets set balance = balance - p_stake, updated_at = now() where user_id = v_uid;
  insert into transactions (user_id, type, amount, ref_id, note)
  values (v_uid, 'bet_stake', -p_stake, v_bet_id, 'Apuesta colocada');

  return v_bet_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- deposit_tokens: ingreso auto-acreditado (sin tesorero) con tope mensual.
-- ----------------------------------------------------------------------------
create or replace function deposit_tokens(p_amount_eur numeric)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_rate   numeric;
  v_cap    numeric;
  v_used   numeric;
  v_tokens numeric;
begin
  if v_uid is null then raise exception 'no autenticado'; end if;
  if p_amount_eur is null or p_amount_eur <= 0 then raise exception 'importe inválido'; end if;

  select tokens_per_eur, monthly_deposit_cap_tokens into v_rate, v_cap from odds_settings where id = 1;
  v_tokens := round(p_amount_eur * v_rate, 2);

  select coalesce(sum(tokens), 0) into v_used
    from deposits
   where user_id = v_uid and status = 'confirmed'
     and created_at >= date_trunc('month', now());

  if v_used + v_tokens > v_cap then
    raise exception 'tope mensual de ingreso superado: te quedan % tk este mes', greatest(v_cap - v_used, 0);
  end if;

  insert into deposits (user_id, amount_eur, tokens, method, status, confirmed_at)
  values (v_uid, p_amount_eur, v_tokens, 'app', 'confirmed', now());

  insert into wallets (user_id, balance) values (v_uid, v_tokens)
  on conflict (user_id) do update set balance = wallets.balance + v_tokens, updated_at = now();

  insert into transactions (user_id, type, amount, note)
  values (v_uid, 'deposit', v_tokens, 'Ingreso (auto)');
end;
$$;

-- ----------------------------------------------------------------------------
-- Cuánto le queda a un jugador por ingresar este mes natural (para la UI).
-- ----------------------------------------------------------------------------
create or replace function deposit_room()
returns numeric
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_cap numeric; v_used numeric;
begin
  if v_uid is null then return 0; end if;
  select monthly_deposit_cap_tokens into v_cap from odds_settings where id = 1;
  select coalesce(sum(tokens), 0) into v_used
    from deposits
   where user_id = v_uid and status = 'confirmed' and created_at >= date_trunc('month', now());
  return greatest(v_cap - v_used, 0);
end;
$$;
