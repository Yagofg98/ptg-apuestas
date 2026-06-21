// Tipos de dominio compartidos por la UI y la capa de datos.

export type MarketType = "winner" | "bagel" | "sets";
export type MatchStatus = "open" | "locked" | "live" | "settled" | "cancelled";

export interface Player {
  id: string;
  name: string;
  currentRanking: number;
  currentWinPct: number;
  historicRanking: number;
  historicWinPct: number;
}

export interface Outcome {
  id: string;
  marketId: string;
  label: string;
  priorProb: number;
  currentOdds: number;
  totalStaked: number;
}

export interface Market {
  id: string;
  matchId: string;
  type: MarketType;
  title: string;
  outcomes: Outcome[];
}

export interface Match {
  id: string;
  scheduledAt: string;
  status: MatchStatus;
  teamA: [Player, Player];
  teamB: [Player, Player];
  markets: Market[];
  // resultado (si settled)
  winnerTeam?: "A" | "B";
  hadBagel?: boolean;
  wentTo3Sets?: boolean;
}

export interface BetSlipLeg {
  outcomeId: string;
  marketId: string;
  matchId: string;
  matchLabel: string; // "A vs B"
  marketTitle: string; // "Ganador"
  outcomeLabel: string; // "Pareja A"
  odds: number;
}

export interface Bet {
  id: string;
  stake: number;
  combinedOdds: number;
  potentialPayout: number;
  status: "pending" | "won" | "lost" | "void";
  isCombo: boolean;
  createdAt: string;
  legs: { label: string; odds: number; result: string; outcomeId?: string }[];
}

export interface WalletTx {
  id: string;
  type: string;
  amount: number;
  note: string;
  createdAt: string;
}

export interface SessionUser {
  id: string;
  name: string;
  role: "player" | "admin" | "treasurer";
}

export interface PendingDeposit {
  id: string;
  userName: string;
  amountEur: number;
  tokens: number;
  createdAt: string;
}

export interface SettleInput {
  winner: "A" | "B";
  hadBagel: boolean;
  threeSets: boolean;
  setScores: number[][];
}

export interface OpenMatchInput {
  scheduledAt: string;
  teamAp1: string;
  teamAp2: string;
  teamBp1: string;
  teamBp2: string;
}
