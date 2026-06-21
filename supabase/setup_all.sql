-- ============================================================
-- PTG Apuestas — setup completo (pegar en Supabase SQL Editor)
-- Ejecuta TODO de una vez. Incluye esquema + funciones + seed.
-- ============================================================


-- ░░░░░░░░░░ migrations/0001_init.sql ░░░░░░░░░░

-- ============================================================================
-- PTG Apuestas — esquema inicial
-- Postgres (Supabase). Ledger de saldos + apuestas + mercados + datos PTG.
-- Todo dinero es "token" (paridad fija con €). La app NUNCA mueve dinero real:
-- los depósitos/retiradas los confirma el tesorero a mano (modelo libro contable).
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- Tipos enumerados
-- ----------------------------------------------------------------------------
create type user_role       as enum ('player', 'admin', 'treasurer');
create type match_status     as enum ('open', 'locked', 'live', 'settled', 'cancelled');
create type market_type      as enum ('winner', 'bagel', 'sets');
create type market_status    as enum ('open', 'locked', 'settled', 'void');
create type bet_status       as enum ('pending', 'won', 'lost', 'void', 'cashed_out');
create type tx_type          as enum ('deposit', 'withdrawal', 'bet_stake', 'bet_payout', 'bet_refund', 'adjustment');
create type deposit_status   as enum ('requested', 'confirmed', 'rejected');

-- ----------------------------------------------------------------------------
-- Perfiles (1:1 con auth.users de Supabase)
-- ----------------------------------------------------------------------------
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role        user_role not null default 'player',
  -- enlace opcional al jugador PTG (si este usuario también juega)
  player_id   uuid,
  created_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Jugadores PTG (sincronizados por el scraper / admin)
-- ----------------------------------------------------------------------------
create table players (
  id                uuid primary key default gen_random_uuid(),
  ptg_player_id     text unique,                  -- id en la plataforma PTG
  name              text not null,
  current_ranking   int  not null default 999,    -- 1 = mejor
  current_win_pct   numeric(5,4) not null default 0.5,  -- [0,1]
  historic_ranking  int  not null default 999,
  historic_win_pct  numeric(5,4) not null default 0.5,
  updated_at        timestamptz not null default now()
);

alter table profiles
  add constraint profiles_player_fk foreign key (player_id) references players(id) on delete set null;

-- Histórico de rankings por temporada (para el peso histórico de las cuotas)
create table ranking_history (
  id         uuid primary key default gen_random_uuid(),
  player_id  uuid not null references players(id) on delete cascade,
  season     text not null,
  ranking    int  not null,
  win_pct    numeric(5,4) not null,
  unique (player_id, season)
);

-- ----------------------------------------------------------------------------
-- Partidos
-- ----------------------------------------------------------------------------
create table matches (
  id            uuid primary key default gen_random_uuid(),
  ptg_match_id  text unique,
  scheduled_at  timestamptz,
  status        match_status not null default 'open',
  -- Pareja A y Pareja B (2 jugadores cada una)
  team_a_p1     uuid references players(id),
  team_a_p2     uuid references players(id),
  team_b_p1     uuid references players(id),
  team_b_p2     uuid references players(id),
  -- Resultado (al liquidar)
  winner_team   char(1) check (winner_team in ('A','B')),
  set_scores    jsonb,          -- p.ej. [[6,4],[3,6],[6,2]]
  had_bagel     boolean,        -- hubo algún 6/0
  went_to_3_sets boolean,
  -- Snapshot de las probabilidades previas (para auditoría/depuración)
  priors        jsonb,
  created_at    timestamptz not null default now(),
  settled_at    timestamptz
);

create index on matches (status, scheduled_at);

-- ----------------------------------------------------------------------------
-- Mercados y resultados apostables
-- ----------------------------------------------------------------------------
create table markets (
  id            uuid primary key default gen_random_uuid(),
  match_id      uuid not null references matches(id) on delete cascade,
  type          market_type not null,
  status        market_status not null default 'open',
  settled_outcome_id uuid,    -- el outcome ganador (se rellena al liquidar)
  unique (match_id, type)
);

create table outcomes (
  id            uuid primary key default gen_random_uuid(),
  market_id     uuid not null references markets(id) on delete cascade,
  label         text not null,            -- "Pareja A", "Sí (6/0)", "3 sets"...
  prior_prob    numeric(6,5) not null,    -- probabilidad previa (motor de cuotas)
  current_odds  numeric(7,2) not null,    -- cuota viva publicada
  total_staked  numeric(14,2) not null default 0,  -- tokens apostados a este resultado
  sort_order    int not null default 0
);

create index on outcomes (market_id);

-- ----------------------------------------------------------------------------
-- Monederos y libro contable
-- ----------------------------------------------------------------------------
create table wallets (
  user_id   uuid primary key references profiles(id) on delete cascade,
  balance   numeric(14,2) not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

create table transactions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  type       tx_type not null,
  amount     numeric(14,2) not null,   -- positivo entra, negativo sale
  ref_id     uuid,                     -- bet_id / deposit_id según el tipo
  note       text,
  created_at timestamptz not null default now()
);

create index on transactions (user_id, created_at desc);

-- Solicitudes de depósito/retirada (confirma el tesorero)
create table deposits (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles(id) on delete cascade,
  amount_eur   numeric(10,2) not null,
  tokens       numeric(14,2) not null,
  method       text,                    -- 'bizum' | 'transfer' | ...
  status       deposit_status not null default 'requested',
  confirmed_by uuid references profiles(id),
  created_at   timestamptz not null default now(),
  confirmed_at timestamptz
);

-- ----------------------------------------------------------------------------
-- Apuestas (simples y combinadas)
-- ----------------------------------------------------------------------------
create table bets (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references profiles(id) on delete cascade,
  stake             numeric(14,2) not null check (stake > 0),
  combined_odds     numeric(10,2) not null,
  potential_payout  numeric(14,2) not null,
  status            bet_status not null default 'pending',
  is_combo          boolean not null default false,
  created_at        timestamptz not null default now(),
  settled_at        timestamptz
);

create index on bets (user_id, created_at desc);
create index on bets (status);

-- Patas de la apuesta (1 = simple, >1 = combinada). Cada pata BLOQUEA su cuota.
create table bet_legs (
  id          uuid primary key default gen_random_uuid(),
  bet_id      uuid not null references bets(id) on delete cascade,
  outcome_id  uuid not null references outcomes(id),
  locked_odds numeric(7,2) not null,    -- cuota en el momento de apostar
  result      bet_status not null default 'pending'
);

create index on bet_legs (bet_id);
create index on bet_legs (outcome_id);

-- ============================================================================
-- ROW LEVEL SECURITY
-- Regla general: cada usuario solo ve/escribe lo suyo. Catálogo público para
-- jugadores/partidos/mercados/cuotas. Saldos y liquidaciones SOLO vía Edge
-- Functions con service-role (que saltan RLS).
-- ============================================================================
alter table profiles        enable row level security;
alter table players         enable row level security;
alter table ranking_history enable row level security;
alter table matches         enable row level security;
alter table markets         enable row level security;
alter table outcomes        enable row level security;
alter table wallets         enable row level security;
alter table transactions    enable row level security;
alter table deposits        enable row level security;
alter table bets            enable row level security;
alter table bet_legs        enable row level security;

-- Catálogo de lectura pública (cualquier usuario autenticado)
create policy "read players"   on players         for select using (auth.role() = 'authenticated');
create policy "read rankings"  on ranking_history for select using (auth.role() = 'authenticated');
create policy "read matches"   on matches         for select using (auth.role() = 'authenticated');
create policy "read markets"   on markets         for select using (auth.role() = 'authenticated');
create policy "read outcomes"  on outcomes        for select using (auth.role() = 'authenticated');

-- Perfiles: lee todos (para mostrar nombres), edita solo el suyo
create policy "read profiles"  on profiles for select using (auth.role() = 'authenticated');
create policy "update own profile" on profiles for update using (auth.uid() = id);

-- Monedero / transacciones / depósitos / apuestas: solo lo propio (lectura)
create policy "read own wallet"  on wallets      for select using (auth.uid() = user_id);
create policy "read own tx"      on transactions for select using (auth.uid() = user_id);
create policy "read own deposit" on deposits     for select using (auth.uid() = user_id);
create policy "read own bets"    on bets         for select using (auth.uid() = user_id);
create policy "read own legs"    on bet_legs     for select using (
  exists (select 1 from bets b where b.id = bet_legs.bet_id and b.user_id = auth.uid())
);

-- El usuario puede SOLICITAR un depósito (estado 'requested'); confirmarlo es del tesorero (service-role)
create policy "request own deposit" on deposits for insert with check (auth.uid() = user_id and status = 'requested');

-- NOTA: colocar apuestas, confirmar depósitos y liquidar mercados NO se hacen con
-- INSERT directo del cliente, sino con Edge Functions (service-role) que validan
-- saldo y atomicidad. Por eso no hay policies de INSERT en bets/wallets/transactions.

-- ============================================================================
-- Realtime: publicar cambios de cuotas/partidos para suscripción en vivo
-- ============================================================================
alter publication supabase_realtime add table outcomes;
alter publication supabase_realtime add table markets;
alter publication supabase_realtime add table matches;

-- ░░░░░░░░░░ migrations/0002_functions.sql ░░░░░░░░░░

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

-- ░░░░░░░░░░ migrations/0003_admin.sql ░░░░░░░░░░

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

-- ░░░░░░░░░░ migrations/0004_parimutuel.sql ░░░░░░░░░░

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

-- ░░░░░░░░░░ seed.sql ░░░░░░░░░░

-- Datos de ejemplo para probar el backend real (ejecutar tras las migraciones).
-- Jugadores del grupo con ranking actual + histórico y % de victorias.

insert into players (ptg_player_id, name, current_ranking, current_win_pct, historic_ranking, historic_win_pct) values
  ('ptg_yago',   'Yago',   2,  0.82, 3,  0.78),
  ('ptg_marcos', 'Marcos', 4,  0.71, 5,  0.69),
  ('ptg_diego',  'Diego',  7,  0.63, 6,  0.66),
  ('ptg_nacho',  'Nacho',  11, 0.55, 12, 0.52),
  ('ptg_alvaro', 'Álvaro', 1,  0.88, 1,  0.85),
  ('ptg_pablo',  'Pablo',  9,  0.58, 8,  0.60),
  ('ptg_luis',   'Luis',   18, 0.41, 16, 0.45),
  ('ptg_carlos', 'Carlos', 24, 0.30, 22, 0.33)
on conflict (ptg_player_id) do nothing;

-- ⚠️ Para convertir a un usuario en admin (tras registrarse con magic-link):
--   update profiles set role = 'admin' where id = '<uuid del usuario>';
-- (Y crea su monedero si no existe:)
--   insert into wallets (user_id, balance) values ('<uuid>', 0) on conflict do nothing;
