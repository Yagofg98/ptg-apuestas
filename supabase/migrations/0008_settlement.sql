-- ============================================================================
-- Liquidación neta cada 15 días entre jugadores (sin tesorero).
--  · Modelo "buy-in vs cash-out" (suma cero): neto_i = saldo_i − (ingresos del periodo).
--  · Al cerrar (≥15 días y SIN apuestas pendientes → cuadra a 0), se calcula el plan
--    mínimo de Bizums (netting voraz), se resetean saldos a 0 y se abre nuevo periodo.
--  · El que COBRA confirma el pago recibido.
-- ============================================================================

alter table odds_settings add column if not exists settlement_days int not null default 15;

create table if not exists settlement_periods (
  id         uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  closed_at  timestamptz,
  status     text not null default 'open'   -- 'open' | 'settled'
);

-- garantizar un periodo abierto
insert into settlement_periods (started_at, status)
select now(), 'open'
where not exists (select 1 from settlement_periods where status = 'open');

create table if not exists settlement_debts (
  id           uuid primary key default gen_random_uuid(),
  period_id    uuid not null references settlement_periods(id) on delete cascade,
  from_user    uuid not null references profiles(id),   -- paga
  to_user      uuid not null references profiles(id),   -- cobra
  tokens       numeric(14,2) not null,
  euros        numeric(10,2) not null,
  status       text not null default 'pending',         -- 'pending' | 'confirmed'
  confirmed_at timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists settlement_debts_from_idx on settlement_debts (from_user);
create index if not exists settlement_debts_to_idx   on settlement_debts (to_user);

alter table settlement_periods enable row level security;
alter table settlement_debts   enable row level security;
create policy "read periods" on settlement_periods for select using (auth.role() = 'authenticated');
create policy "read own debts" on settlement_debts for select
  using (auth.uid() = from_user or auth.uid() = to_user);

-- ----------------------------------------------------------------------------
-- Cierre quincenal idempotente. Solo cierra si han pasado settlement_days y NO hay
-- apuestas pendientes (así Σ netos = 0 exacto). Lo llama el scraper en cada pasada.
-- ----------------------------------------------------------------------------
create or replace function close_due_period()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_period settlement_periods;
  v_days   int;
  v_rate   numeric;
  v_cuid uuid; v_camt numeric;
  v_duid uuid; v_damt numeric;
  t numeric;
begin
  select * into v_period from settlement_periods where status = 'open' order by started_at limit 1;
  if v_period.id is null then
    insert into settlement_periods (started_at, status) values (now(), 'open');
    return;
  end if;

  select settlement_days, tokens_per_eur into v_days, v_rate from odds_settings where id = 1;
  if now() < v_period.started_at + make_interval(days => v_days) then return; end if;
  if exists (select 1 from bets where status = 'pending') then return; end if; -- esperar a que cuadre

  -- netos del periodo: saldo − ingresos desde el inicio del periodo
  create temp table _net on commit drop as
    select w.user_id as uid,
           round(w.balance - coalesce((
             select sum(d.tokens) from deposits d
              where d.user_id = w.user_id and d.status = 'confirmed'
                and d.created_at >= v_period.started_at), 0), 2) as net
      from wallets w;

  -- netting voraz: mayor acreedor ↔ mayor deudor → menos transferencias
  loop
    select uid, net into v_cuid, v_camt from _net where net > 0.009 order by net desc limit 1;
    select uid, net into v_duid, v_damt from _net where net < -0.009 order by net asc  limit 1;
    exit when v_cuid is null or v_duid is null;
    t := least(v_camt, -v_damt);
    insert into settlement_debts (period_id, from_user, to_user, tokens, euros)
      values (v_period.id, v_duid, v_cuid, round(t, 2), round(t / v_rate, 2));
    update _net set net = net - t where uid = v_cuid;
    update _net set net = net + t where uid = v_duid;
  end loop;

  -- resetear saldos a 0 y cerrar el periodo; abrir el siguiente
  insert into transactions (user_id, type, amount, note)
    select user_id, 'adjustment', -balance, 'Cierre de quincena' from wallets where balance <> 0;
  update wallets set balance = 0, updated_at = now() where balance <> 0;

  update settlement_periods set status = 'settled', closed_at = now() where id = v_period.id;
  insert into settlement_periods (started_at, status) values (now(), 'open');
end;
$$;

-- ----------------------------------------------------------------------------
-- El que COBRA confirma que recibió el Bizum.
-- ----------------------------------------------------------------------------
create or replace function confirm_debt_received(p_debt_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update settlement_debts set status = 'confirmed', confirmed_at = now()
   where id = p_debt_id and to_user = auth.uid() and status = 'pending';
  if not found then raise exception 'no autorizado o ya confirmado'; end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- Neto EN VIVO del periodo en curso (para la pestaña): saldo − ingresos del periodo.
-- ----------------------------------------------------------------------------
create or replace function my_current_net()
returns numeric language sql security definer set search_path = public stable as $$
  select round(
    coalesce((select balance from wallets where user_id = auth.uid()), 0)
    - coalesce((select sum(d.tokens) from deposits d
        where d.user_id = auth.uid() and d.status = 'confirmed'
          and d.created_at >= (select started_at from settlement_periods where status = 'open' order by started_at limit 1)
      ), 0), 2);
$$;

-- ----------------------------------------------------------------------------
-- Mis deudas/cobros de la última liquidación cerrada (con el nombre del otro).
-- ----------------------------------------------------------------------------
create or replace function my_settlement()
returns table(id uuid, direction text, other_name text, tokens numeric, euros numeric, status text)
language sql security definer set search_path = public stable as $$
  select d.id,
         case when d.from_user = auth.uid() then 'pay' else 'receive' end,
         case when d.from_user = auth.uid() then pt.display_name else pf.display_name end,
         d.tokens, d.euros, d.status
    from settlement_debts d
    join profiles pf on pf.id = d.from_user
    join profiles pt on pt.id = d.to_user
   where (d.from_user = auth.uid() or d.to_user = auth.uid())
     and d.period_id = (select id from settlement_periods where status = 'settled' order by closed_at desc limit 1)
   order by d.status, d.tokens desc;
$$;

-- deposit_tokens ya registra los ingresos en `deposits` con created_at, que es la base
-- del neto por periodo: no hace falta tocar wallets. (Definida en 0007.)
