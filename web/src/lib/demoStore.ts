/**
 * MODO DEMO: estado en memoria que reutiliza el motor de cuotas real.
 * Modelo PARIMUTUEL (bote): no hay casa, el dinero de un bolsillo va a otro.
 * Cada mercado es un bote que se reparte entre acertantes → cuadra siempre.
 * Las cuotas mostradas son ESTIMADAS (ranking + dinero); el pago sale del bote real.
 */
import {
  DEFAULT_CONFIG,
  matchPriors,
  parimutuelOdds,
  poolPayout,
  PlayerStats,
} from "./odds";
import { buildMatchMarkets } from "./matchMarkets";
import {
  Match,
  Market,
  Outcome,
  Player,
  Bet,
  WalletTx,
  SessionUser,
  PendingDeposit,
  SettleInput,
  SettlementDebt,
  OpenMatchInput,
} from "./types";

let _id = 0;
const uid = () => `id_${++_id}`;

function mkPlayer(
  name: string,
  cr: number,
  cw: number,
  hr: number,
  hw: number,
): Player {
  return { id: uid(), name, currentRanking: cr, currentWinPct: cw, historicRanking: hr, historicWinPct: hw };
}

// Config del motor para la demo: liga de ~40 jugadores (grupo Madrid Mas Azul).
// α bajo = pesa más el ranking HISTÓRICO (estable) que el actual, porque a principio
// de temporada el % actual tiene muy pocos partidos (1-2) y es ruidoso.
// (Mejora futura: ponderar lo actual según nº de partidos jugados — shrinkage.)
const CFG = { ...DEFAULT_CONFIG, leagueSize: 40, alpha: 0.35, decisiveness: 0.28 };

// Topes (espejo de odds_settings en el backend real).
const MAX_STAKE_PER_MATCH = 500; // 5€
const MONTHLY_DEPOSIT_CAP = 2000; // 20€

// Roster REAL del grupo "Madrid Mas Azul" (capturado de PTG, ordenado por ranking
// histórico). mkPlayer(nombre, ranking_actual, win_actual, ranking_histórico, win_histórico).
const roster: Player[] = [
  mkPlayer("Yago Fernández González", 5, 1.0, 1, 0.875),
  mkPlayer("Pablo Ausín García", 8, 0.8333, 2, 0.8333),
  mkPlayer("Alejandro Romero", 3, 1.0, 3, 0.8125),
  mkPlayer("Javier Cardona Magro", 21, 0.5, 4, 0.7885),
  mkPlayer("Manuel Sánchez Ureta", 1, 1.0, 5, 0.7368),
  mkPlayer("Gonzalo Bañegil", 16, 0.6, 6, 0.6977),
  mkPlayer("Guillermo Segovia", 11, 0.6667, 7, 0.6842),
  mkPlayer("Adrián Vera", 40, 0.0, 8, 0.65),
  mkPlayer("Nacho Justicia", 2, 1.0, 9, 0.6316),
  mkPlayer("Ignacio Quirós", 12, 0.6667, 10, 0.6176),
  mkPlayer("Rafa Pariente", 10, 0.6667, 11, 0.5739),
  mkPlayer("Jorge Garcia Calle", 25, 0.4, 12, 0.569),
  mkPlayer("Ignacio Ozaita", 6, 1.0, 13, 0.5672),
  mkPlayer("Luis Pita", 14, 0.6667, 14, 0.5616),
  mkPlayer("Antonio Martínez", 9, 0.6667, 15, 0.5556),
  mkPlayer("Luis Isasi", 20, 0.5, 16, 0.5476),
  mkPlayer("Abelardo Algora", 34, 0.2, 17, 0.5429),
  mkPlayer("Pelayo Reimondo Camblor", 24, 0.4286, 18, 0.5333),
  mkPlayer("Lionel Linares", 30, 0.3333, 19, 0.5244),
  mkPlayer("Simón Gutiérrez de Ravé", 29, 0.3333, 20, 0.52),
  mkPlayer("Eduardo Casielles Castrillón", 37, 0.0, 21, 0.5),
  mkPlayer("Felipe Yannone Sierra", 7, 1.0, 22, 0.5),
  mkPlayer("Jaime Soler Hernández", 22, 0.5, 23, 0.5),
  mkPlayer("Javier Alonso", 18, 0.5, 24, 0.4909),
  mkPlayer("Manuel Segura", 4, 1.0, 25, 0.4844),
  mkPlayer("Alejandro Blanco", 15, 0.6667, 26, 0.48),
  mkPlayer("Pablo Estévez", 31, 0.3333, 27, 0.4722),
  mkPlayer("Ignacio Sagardoy", 39, 0.0, 28, 0.4694),
  mkPlayer("Iñigo Sanz Mustieles", 28, 0.3333, 29, 0.4643),
  mkPlayer("Juan de la Cierva", 13, 0.6667, 30, 0.463),
  mkPlayer("Pablo Plasencia", 32, 0.25, 31, 0.4615),
  mkPlayer("Juan Fernández", 17, 0.5714, 32, 0.4588),
  mkPlayer("Alvaro Hernandez", 38, 0.0, 33, 0.4444),
  mkPlayer("Rafael Otero de Lucas", 35, 0.0, 34, 0.4375),
  mkPlayer("Manuel Núñez Campos", 36, 0.0, 35, 0.4286),
  mkPlayer("Luis Lozano", 23, 0.4444, 36, 0.4286),
  mkPlayer("Carlos Juárez", 27, 0.4, 37, 0.4211),
  mkPlayer("Fernando Losada", 26, 0.4, 38, 0.4),
  mkPlayer("Alejandro Castejón", 19, 0.5, 39, 0.28),
  mkPlayer("Sergio Velasco Bayon", 33, 0.25, 40, 0.25),
];

const toStats = (p: Player): PlayerStats => ({
  id: p.id,
  name: p.name,
  currentRanking: p.currentRanking,
  currentWinPct: p.currentWinPct,
  historicRanking: p.historicRanking,
  historicWinPct: p.historicWinPct,
});

function buildMatch(a1: Player, a2: Player, b1: Player, b2: Player, inHours: number): Match {
  const matchId = uid();
  const priors = matchPriors(toStats(a1), toStats(a2), toStats(b1), toStats(b2), CFG);

  const mk = (type: Market["type"], title: string, outs: [string, number][]): Market => {
    const marketId = uid();
    const outcomes: Outcome[] = outs.map(([label, prob]) => ({
      id: uid(),
      marketId,
      label,
      priorProb: prob,
      currentOdds: parimutuelOdds(prob, 0, 0, CFG), // línea de apertura ≈ 1/prior
      totalStaked: 0,
    }));
    return { id: marketId, matchId, type, title, outcomes };
  };

  return {
    id: matchId,
    scheduledAt: new Date(Date.now() + inHours * 3600_000).toISOString(),
    status: "open",
    teamA: [a1, a2],
    teamB: [b1, b2],
    markets: [
      mk("winner", "Pareja ganadora", [
        ["Pareja A", priors.winA],
        ["Pareja B", priors.winB],
      ]),
      mk("bagel", "¿Habrá un 6/0?", [
        ["Sí", priors.bagelYes],
        ["No", 1 - priors.bagelYes],
      ]),
      mk("sets", "¿2 o 3 sets?", [
        ["2 sets", 1 - priors.threeSets],
        ["3 sets", priors.threeSets],
      ]),
    ],
  };
}

interface DemoState {
  user: SessionUser;
  matches: Match[];
  balance: number;
  bets: Bet[];
  txs: WalletTx[];
  deposits: PendingDeposit[];
  // bote de combinadas por partido (matchId → tokens). Las combinadas (mismo
  // partido) compiten en su propio bote, separado de los botes por mercado.
  comboPools: Record<string, number>;
  // tokens ingresados este mes (para el tope mensual de depósito).
  depositedThisMonth: number;
  // deudas/cobros de la última liquidación (demo).
  debts: SettlementDebt[];
}

const state: DemoState = {
  user: { id: "demo-user", name: "Yago Fernández González", role: "admin" },
  matches: [
    // Igualado: Yago(#1)+Adrián(#8) vs Pablo Ausín(#2)+Nacho(#9)
    buildMatch(roster[0], roster[7], roster[1], roster[8], 3),
    // Favorito claro: Alejandro Romero(#3)+Gonzalo Bañegil(#6) vs Plasencia(#31)+Juan Fdez(#32)
    buildMatch(roster[2], roster[5], roster[30], roster[31], 6),
    // Medio: Guillermo Segovia(#7)+Luis Pita(#14) vs Rafa Pariente(#11)+Antonio Martínez(#15)
    buildMatch(roster[6], roster[13], roster[10], roster[14], 26),
  ],
  balance: 1500,
  bets: [],
  txs: [{ id: uid(), type: "deposit", amount: 1500, note: "Depósito inicial (demo)", createdAt: new Date().toISOString() }],
  // un depósito de otro jugador pendiente, para probar el panel admin
  deposits: [
    { id: uid(), userName: "Pablo Ausín García", amountEur: 20, tokens: 2000, createdAt: new Date().toISOString() },
  ],
  comboPools: {},
  // el saldo inicial sembrado cuenta como ingreso del periodo → neto arranca en 0.
  depositedThisMonth: 1500,
  // Ejemplo de una liquidación ya cerrada (para ver la pestaña en demo).
  debts: [
    { id: uid(), direction: "pay", otherName: "Pablo Ausín García", tokens: 500, euros: 5, status: "pending" },
    { id: uid(), direction: "receive", otherName: "Nacho Justicia", tokens: 800, euros: 8, status: "pending" },
  ],
};

// ---- Suscripción simple para que la UI reaccione a cambios (cuotas/saldo) ----
type Listener = () => void;
const listeners = new Set<Listener>();
export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() {
  listeners.forEach((l) => l());
}

function findOutcome(outcomeId: string): { match: Match; market: Market; outcome: Outcome } | null {
  for (const match of state.matches) {
    for (const market of match.markets) {
      const outcome = market.outcomes.find((o) => o.id === outcomeId);
      if (outcome) return { match, market, outcome };
    }
  }
  return null;
}

function recalcMarket(market: Market) {
  const total = market.outcomes.reduce((s, o) => s + o.totalStaked, 0);
  for (const o of market.outcomes) {
    o.currentOdds = parimutuelOdds(o.priorProb, o.totalStaked, total, CFG);
  }
}

export const demo = {
  getUser: () => state.user,
  getMatches: () => state.matches,
  getMatch: (id: string) => state.matches.find((m) => m.id === id) ?? null,
  getBalance: () => state.balance,
  getBets: () => state.bets,
  getTxs: () => state.txs,
  oddsFor: (outcomeId: string) => findOutcome(outcomeId)?.outcome.currentOdds ?? null,

  placeBet(legs: { outcomeId: string; odds: number; label: string }[], stake: number) {
    if (stake <= 0) throw new Error("Importe inválido");
    if (stake > state.balance) throw new Error("Saldo insuficiente");
    const isCombo = legs.length > 1;

    // Combinada: todas las patas deben ser del MISMO partido.
    if (isCombo) {
      const matchIds = new Set(legs.map((l) => findOutcome(l.outcomeId)?.match.id));
      if (matchIds.size !== 1) throw new Error("La combinada debe ser del mismo partido");
    }

    // Tope por jugador y partido: lo ya apostado en ese partido + lo nuevo.
    const matchId = findOutcome(legs[0].outcomeId)?.match.id;
    const stakedOnMatch = state.bets
      .filter(
        (b) =>
          b.status !== "void" &&
          b.legs.some((l) => l.outcomeId && findOutcome(l.outcomeId)?.match.id === matchId),
      )
      .reduce((s, b) => s + b.stake, 0);
    if (stakedOnMatch + stake > MAX_STAKE_PER_MATCH) {
      throw new Error(
        `Tope de apuesta por partido superado (máx ${MAX_STAKE_PER_MATCH} tk; ya tienes ${stakedOnMatch})`,
      );
    }

    // combinada = cuota ESTIMADA (producto); simple = cuota estimada de su mercado
    const combined = Number(legs.reduce((acc, l) => acc * l.odds, 1).toFixed(2));
    const payout = Number((stake * combined).toFixed(2));
    const bet: Bet = {
      id: uid(),
      stake,
      combinedOdds: combined,
      potentialPayout: payout, // ESTIMADO; el pago real sale del bote al liquidar
      status: "pending",
      isCombo,
      createdAt: new Date().toISOString(),
      legs: legs.map((l) => ({ label: l.label, odds: l.odds, result: "pending", outcomeId: l.outcomeId })),
    };
    state.bets.unshift(bet);
    state.balance -= stake;
    state.txs.unshift({ id: uid(), type: "bet_stake", amount: -stake, note: "Apuesta colocada", createdAt: bet.createdAt });

    if (isCombo) {
      // la combinada va a su propio bote (por partido), no mueve los botes de mercado
      const matchId = findOutcome(legs[0].outcomeId)!.match.id;
      state.comboPools[matchId] = (state.comboPools[matchId] ?? 0) + stake;
    } else {
      // simple: el dinero entra al bote de su mercado y mueve la cuota estimada
      const found = findOutcome(legs[0].outcomeId);
      if (found) {
        found.outcome.totalStaked += stake;
        recalcMarket(found.market);
      }
    }
    emit();
    return bet.id;
  },

  requestDeposit(amountEur: number, tokensPerEur: number) {
    // Auto-acreditado al instante (sin tesorero), con tope mensual.
    const tokens = amountEur * tokensPerEur;
    if (state.depositedThisMonth + tokens > MONTHLY_DEPOSIT_CAP) {
      const left = Math.max(MONTHLY_DEPOSIT_CAP - state.depositedThisMonth, 0);
      throw new Error(`Tope mensual de ingreso superado: te quedan ${left} tk este mes`);
    }
    state.depositedThisMonth += tokens;
    state.balance += tokens;
    state.txs.unshift({ id: uid(), type: "deposit", amount: tokens, note: "Ingreso (auto)", createdAt: new Date().toISOString() });
    emit();
  },

  depositRoom() {
    return Math.max(MONTHLY_DEPOSIT_CAP - state.depositedThisMonth, 0);
  },

  // Neto del periodo en vivo: saldo − ingresado en el periodo.
  currentNet() {
    return Math.round((state.balance - state.depositedThisMonth) * 100) / 100;
  },
  getMyDebts(): SettlementDebt[] {
    // copias para que la UI (useLive) detecte el cambio tras confirmar.
    return state.debts.map((d) => ({ ...d }));
  },
  confirmDebtReceived(id: string) {
    const d = state.debts.find((x) => x.id === id);
    if (d) d.status = "confirmed";
    emit();
  },

  // Partidos PTG por confirmar (demo): uno de azul con apuntados creciendo.
  listPendingMatches() {
    return [
      {
        id: "demo-pending-1",
        scheduledAt: new Date(Date.now() + 2 * 24 * 3600_000).toISOString(),
        grupo: "azul",
        playerNames: [roster[0].name, roster[8].name, roster[1].name],
      },
    ];
  },

  // ---- Admin ----
  listPlayers: () => roster,
  listPendingDeposits: () => state.deposits,

  // Alta rápida de un jugador suelto (sin ranking): defaults ≈ 50%.
  createAdhocPlayer(name: string) {
    const p = mkPlayer(name.trim(), 999, 0.5, 999, 0.5);
    roster.push(p);
    emit();
    return p.id;
  },

  confirmDeposit(id: string) {
    const idx = state.deposits.findIndex((d) => d.id === id);
    if (idx < 0) return;
    const d = state.deposits[idx];
    state.deposits.splice(idx, 1);
    // En demo acreditamos al usuario actual (en real, al user_id del depósito)
    state.balance += d.tokens;
    state.txs.unshift({ id: uid(), type: "deposit", amount: d.tokens, note: `Depósito ${d.amountEur}€ confirmado (${d.userName})`, createdAt: new Date().toISOString() });
    emit();
  },

  openMatch(input: OpenMatchInput) {
    const find = (id: string) => roster.find((p) => p.id === id)!;
    const a1 = find(input.teamAp1), a2 = find(input.teamAp2);
    const b1 = find(input.teamBp1), b2 = find(input.teamBp2);
    const markets = buildMatchMarkets(toStats(a1), toStats(a2), toStats(b1), toStats(b2));
    const matchId = uid();
    const match: Match = {
      id: matchId,
      scheduledAt: input.scheduledAt,
      status: "open",
      teamA: [a1, a2],
      teamB: [b1, b2],
      markets: markets.map((mk) => {
        const marketId = uid();
        return {
          id: marketId,
          matchId,
          type: mk.type,
          title: mk.type === "winner" ? "Pareja ganadora" : mk.type === "bagel" ? "¿Habrá un 6/0?" : "¿2 o 3 sets?",
          outcomes: mk.outcomes.map((o) => ({
            id: uid(),
            marketId,
            label: o.label,
            priorProb: o.prior,
            currentOdds: o.odds,
            totalStaked: 0,
          })),
        };
      }),
    };
    state.matches.unshift(match);
    emit();
    return matchId;
  },

  setMatchStatus(matchId: string, status: Match["status"]) {
    const m = state.matches.find((x) => x.id === matchId);
    if (m) m.status = status;
    emit();
  },

  settleMatch(matchId: string, res: SettleInput) {
    const m = state.matches.find((x) => x.id === matchId);
    if (!m) return;
    m.status = "settled";
    m.winnerTeam = res.winner;
    m.hadBagel = res.hadBagel;
    m.wentTo3Sets = res.threeSets;

    const credit = (amount: number, note: string) => {
      state.balance += amount;
      state.txs.unshift({ id: uid(), type: "bet_payout", amount, note, createdAt: new Date().toISOString() });
    };

    // resultado ganador por mercado + datos del bote real (solo dinero de simples)
    const winningOutcomeIds = new Set<string>();
    const matchOutcomeIds = new Set<string>();
    const marketOf = new Map<string, { pool: number; winnerStaked: number; winnerId: string }>();
    for (const mk of m.markets) {
      const winLabel =
        mk.type === "winner" ? (res.winner === "A" ? "Pareja A" : "Pareja B")
        : mk.type === "bagel" ? (res.hadBagel ? "Sí" : "No")
        : (res.threeSets ? "3 sets" : "2 sets");
      const pool = mk.outcomes.reduce((s, o) => s + o.totalStaked, 0);
      const winO = mk.outcomes.find((o) => o.label === winLabel)!;
      for (const o of mk.outcomes) {
        matchOutcomeIds.add(o.id);
        marketOf.set(o.id, { pool, winnerStaked: winO.totalStaked, winnerId: winO.id });
      }
      winningOutcomeIds.add(winO.id);
    }

    // --- SIMPLES: cada mercado es un bote, se reparte entre acertantes ---
    for (const bet of state.bets) {
      if (bet.status !== "pending" || bet.isCombo) continue;
      const leg = bet.legs[0];
      if (!leg.outcomeId || !matchOutcomeIds.has(leg.outcomeId)) continue; // otro partido
      const info = marketOf.get(leg.outcomeId)!;
      if (winningOutcomeIds.has(leg.outcomeId)) {
        const payout = poolPayout(bet.stake, info.winnerStaked, info.pool);
        bet.status = "won";
        bet.potentialPayout = payout;
        leg.result = "won";
        credit(payout, "Premio (bote del mercado)");
      } else {
        bet.status = "lost";
        leg.result = "lost";
      }
    }

    // --- COMBINADAS (mismo partido): compiten en el bote de combinadas del partido ---
    const comboPool = state.comboPools[matchId] ?? 0;
    const matchCombos = state.bets.filter(
      (b) => b.status === "pending" && b.isCombo && b.legs.every((l) => l.outcomeId && matchOutcomeIds.has(l.outcomeId)),
    );
    const winners = matchCombos.filter((b) => b.legs.every((l) => winningOutcomeIds.has(l.outcomeId!)));
    const totalWinStake = winners.reduce((s, b) => s + b.stake, 0);
    for (const b of matchCombos) {
      b.legs.forEach((l) => (l.result = winningOutcomeIds.has(l.outcomeId!) ? "won" : "lost"));
      const allWin = b.legs.every((l) => l.result === "won");
      if (winners.length === 0) {
        // ninguna combinada acertó → reembolso (no hay con qué pagar)
        b.status = "void";
        b.potentialPayout = b.stake;
        credit(b.stake, "Reembolso combinada (sin acertantes)");
      } else if (allWin) {
        const payout = Number((b.stake * (comboPool / totalWinStake)).toFixed(2));
        b.status = "won";
        b.potentialPayout = payout;
        credit(payout, "Premio (bote de combinadas)");
      } else {
        b.status = "lost";
      }
    }
    if (comboPool > 0) state.comboPools[matchId] = 0;

    emit();
  },
};
