-- ============================================================================
-- Modelo PARIMUTUEL (bote) — sin casa, el dinero cuadra.
-- Reemplaza la lógica de cuota fija de 0002 por reparto de bote:
--   · Cada mercado es un bote (suma de apuestas simples a sus resultados).
--   · Combinadas (mismo partido) → bote de combinadas aparte (matches.combo_pool).
--   · Cuota ESTIMADA = (bote+L)/(apostado+L·prior). Sin margen.
--   · Liquidación = reparto proporcional del bote entre acertantes. Cuadra.
-- ============================================================================

alter table matches add column if not exists combo_pool numeric(14,2) not null default 0;

-- ----------------------------------------------------------------------------
-- Cuota ESTIMADA parimutuel de cada resultado de un mercado.
-- L = liquidez del prior (semilla del ranking, solo para la estimación).
-- ----------------------------------------------------------------------------
create or replace function recalc_market_odds(p_market_id uuid)
returns void language plpgsql as $$
declare
  v_total numeric;
  v_L     numeric;
  r       record;
begin
  select prior_liquidity into v_L from odds_settings where id = 1;
  select coalesce(sum(total_staked), 0) into v_total from outcomes where market_id = p_market_id;

  for r in select id, prior_prob, total_staked from outcomes where market_id = p_market_id loop
    update outcomes
       set current_odds = greatest(1.01, round(
             (v_total + v_L) / (r.total_staked + v_L * greatest(least(r.prior_prob, 0.999999), 0.000001))
           , 2))
     where id = r.id;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- Colocar apuesta (parimutuel).
--   simple (1 pata)  → entra al bote de su mercado.
--   combinada (>1)   → debe ser del MISMO partido → entra al bote de combinadas.
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

    -- combinadas: todas las patas del mismo partido
    if v_match0 is null then v_match0 := v_match;
    elsif v_match0 <> v_match then raise exception 'la combinada debe ser del mismo partido'; end if;

    insert into bet_legs (bet_id, outcome_id, locked_odds) values (v_bet_id, v_outcome, v_odds);
    v_combined := v_combined * v_odds;

    if not v_combo then
      -- simple: el dinero entra al bote del mercado y mueve la cuota estimada
      update outcomes set total_staked = total_staked + p_stake where id = v_outcome;
      perform recalc_market_odds(v_market);
    end if;
  end loop;

  if v_combo then
    -- combinada: el dinero va al bote de combinadas del partido
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
-- Liquidar partido (parimutuel): reparte cada bote entre acertantes.
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
  v_win_staked numeric;
  v_pool numeric;
  b      record;
  v_combo_pool numeric;
  v_total_win  numeric;
begin
  if auth.role() <> 'service_role' then
    select role into v_role from profiles where id = v_uid;
    if v_role <> 'admin' then raise exception 'solo admin liquida'; end if;
  end if;

  update matches set status='settled', winner_team=p_winner, had_bagel=p_had_bagel,
     went_to_3_sets=p_three_sets, set_scores=p_set_scores, settled_at=now()
   where id = p_match_id;

  -- ----- SIMPLES: un bote por mercado -----
  for mk in select id, type from markets where match_id = p_match_id loop
    v_win_label := case mk.type
      when 'winner' then case p_winner when 'A' then 'Pareja A' else 'Pareja B' end
      when 'bagel'  then case when p_had_bagel then 'Sí' else 'No' end
      when 'sets'   then case when p_three_sets then '3 sets' else '2 sets' end end;

    select id, total_staked into v_win_outcome, v_win_staked
      from outcomes where market_id = mk.id and label = v_win_label limit 1;
    select coalesce(sum(total_staked),0) into v_pool from outcomes where market_id = mk.id;

    update markets set status='settled', settled_outcome_id=v_win_outcome where id = mk.id;
    update bet_legs set result='won'  where outcome_id = v_win_outcome and result='pending';
    update bet_legs set result='lost'
      where outcome_id in (select id from outcomes where market_id = mk.id and id <> v_win_outcome)
        and result='pending';

    -- pagar apuestas SIMPLES de este mercado
    for b in
      select bt.id, bt.user_id, bt.stake, l.outcome_id
        from bets bt join bet_legs l on l.bet_id = bt.id
       where bt.is_combo = false and bt.status = 'pending'
         and l.outcome_id in (select id from outcomes where market_id = mk.id)
    loop
      if coalesce(v_win_staked,0) <= 0 then
        -- nadie acertó → reembolso a todos los del mercado
        update bets set status='void', potential_payout=b.stake, settled_at=now() where id = b.id;
        update wallets set balance = balance + b.stake, updated_at=now() where user_id = b.user_id;
        insert into transactions (user_id,type,amount,ref_id,note)
        values (b.user_id,'bet_refund',b.stake,b.id,'Reembolso (sin acertantes)');
      elsif b.outcome_id = v_win_outcome then
        update bets set status='won', potential_payout=round(b.stake*v_pool/v_win_staked,2), settled_at=now() where id=b.id;
        update wallets set balance = balance + round(b.stake*v_pool/v_win_staked,2), updated_at=now() where user_id=b.user_id;
        insert into transactions (user_id,type,amount,ref_id,note)
        values (b.user_id,'bet_payout',round(b.stake*v_pool/v_win_staked,2),b.id,'Premio (bote del mercado)');
      else
        update bets set status='lost', settled_at=now() where id=b.id;
      end if;
    end loop;
  end loop;

  -- ----- COMBINADAS (mismo partido): bote de combinadas -----
  select combo_pool into v_combo_pool from matches where id = p_match_id;
  -- total apostado por combinadas GANADORAS (todas sus patas 'won')
  select coalesce(sum(bt.stake),0) into v_total_win
    from bets bt where bt.is_combo and bt.status='pending'
     and exists (select 1 from bet_legs l join outcomes o on o.id=l.outcome_id
                 join markets m on m.id=o.market_id where l.bet_id=bt.id and m.match_id=p_match_id)
     and not exists (select 1 from bet_legs l where l.bet_id=bt.id and l.result <> 'won');

  for b in
    select bt.id, bt.user_id, bt.stake,
           not exists (select 1 from bet_legs l where l.bet_id=bt.id and l.result <> 'won') as all_won
      from bets bt
     where bt.is_combo and bt.status='pending'
       and exists (select 1 from bet_legs l join outcomes o on o.id=l.outcome_id
                   join markets m on m.id=o.market_id where l.bet_id=bt.id and m.match_id=p_match_id)
  loop
    if v_total_win <= 0 then
      update bets set status='void', potential_payout=b.stake, settled_at=now() where id=b.id;
      update wallets set balance=balance+b.stake, updated_at=now() where user_id=b.user_id;
      insert into transactions (user_id,type,amount,ref_id,note)
      values (b.user_id,'bet_refund',b.stake,b.id,'Reembolso combinada (sin acertantes)');
    elsif b.all_won then
      update bets set status='won', potential_payout=round(b.stake*v_combo_pool/v_total_win,2), settled_at=now() where id=b.id;
      update wallets set balance=balance+round(b.stake*v_combo_pool/v_total_win,2), updated_at=now() where user_id=b.user_id;
      insert into transactions (user_id,type,amount,ref_id,note)
      values (b.user_id,'bet_payout',round(b.stake*v_combo_pool/v_total_win,2),b.id,'Premio (bote de combinadas)');
    else
      update bets set status='lost', settled_at=now() where id=b.id;
    end if;
  end loop;

  update matches set combo_pool = 0 where id = p_match_id;
end;
$$;

-- En parimutuel no hay margen de casa: lo dejamos a 0 (informativo).
update odds_settings set margin = 0 where id = 1;
