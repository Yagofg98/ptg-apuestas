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
