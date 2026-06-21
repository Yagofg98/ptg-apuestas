/**
 * Capa de datos única para la UI. Si hay Supabase configurado, usa el backend
 * real (tablas + RPC del esquema). Si no, usa el store en memoria (MODO DEMO).
 */
import { HAS_SUPABASE, supabase, TOKENS_PER_EUR } from "./supabase";
import { demo, subscribe as demoSubscribe } from "./demoStore";
import { buildMatchMarkets } from "./matchMarkets";
import { PlayerStats } from "./odds";
import {
  Bet,
  Match,
  Player,
  PendingDeposit,
  SessionUser,
  SettleInput,
  OpenMatchInput,
  WalletTx,
} from "./types";

export { TOKENS_PER_EUR };
export const DEMO_MODE = !HAS_SUPABASE;

export interface BetSlipLegInput {
  outcomeId: string;
  odds: number;
  label: string;
}

// ---------------------------------------------------------------------------
// MODO DEMO
// ---------------------------------------------------------------------------
const demoApi = {
  async getSession(): Promise<SessionUser | null> {
    return demo.getUser();
  },
  async signInWithEmail(_email: string) {
    /* en demo no hay login real */
  },
  async signOut() {},
  async listMatches(): Promise<Match[]> {
    return demo.getMatches();
  },
  async getMatch(id: string): Promise<Match | null> {
    return demo.getMatch(id);
  },
  async getBalance(): Promise<number> {
    return demo.getBalance();
  },
  async getBets(): Promise<Bet[]> {
    return demo.getBets();
  },
  async getTransactions(): Promise<WalletTx[]> {
    return demo.getTxs();
  },
  async placeBet(legs: BetSlipLegInput[], stake: number): Promise<string> {
    return demo.placeBet(legs, stake);
  },
  async requestDeposit(amountEur: number): Promise<void> {
    demo.requestDeposit(amountEur, TOKENS_PER_EUR);
  },
  subscribe(fn: () => void): () => void {
    return demoSubscribe(fn);
  },
  // ---- admin ----
  async listPlayers(): Promise<Player[]> {
    return demo.listPlayers();
  },
  async listPendingDeposits(): Promise<PendingDeposit[]> {
    return demo.listPendingDeposits();
  },
  async confirmDeposit(id: string): Promise<void> {
    demo.confirmDeposit(id);
  },
  async openMatch(input: OpenMatchInput): Promise<string> {
    return demo.openMatch(input);
  },
  async setMatchStatus(matchId: string, status: Match["status"]): Promise<void> {
    demo.setMatchStatus(matchId, status);
  },
  async settleMatch(matchId: string, res: SettleInput): Promise<void> {
    demo.settleMatch(matchId, res);
  },
  async invitePlayer(email: string): Promise<string> {
    return `https://demo.local/login?email=${encodeURIComponent(email)}`;
  },
};

// ---------------------------------------------------------------------------
// MODO SUPABASE (backend real)
// ---------------------------------------------------------------------------
const realApi = {
  async getSession(): Promise<SessionUser | null> {
    const { data } = await supabase!.auth.getUser();
    if (!data.user) return null;
    const { data: profile } = await supabase!
      .from("profiles")
      .select("display_name, role")
      .eq("id", data.user.id)
      .single();
    return {
      id: data.user.id,
      name: profile?.display_name ?? data.user.email ?? "Jugador",
      role: (profile?.role as SessionUser["role"]) ?? "player",
    };
  },
  async signInWithEmail(email: string) {
    const { error } = await supabase!.auth.signInWithOtp({ email });
    if (error) throw error;
  },
  async signOut() {
    await supabase!.auth.signOut();
  },
  async listMatches(): Promise<Match[]> {
    const { data, error } = await supabase!
      .from("matches")
      .select(
        `id, scheduled_at, status, winner_team, had_bagel, went_to_3_sets,
         team_a_p1(*), team_a_p2(*), team_b_p1(*), team_b_p2(*),
         markets ( id, type, outcomes ( id, market_id, label, prior_prob, current_odds, total_staked, sort_order ) )`,
      )
      .in("status", ["open", "locked", "live"])
      .order("scheduled_at", { ascending: true });
    if (error) throw error;
    return (data ?? []).map(mapMatch);
  },
  async getMatch(id: string): Promise<Match | null> {
    const { data, error } = await supabase!
      .from("matches")
      .select(
        `id, scheduled_at, status, winner_team, had_bagel, went_to_3_sets,
         team_a_p1(*), team_a_p2(*), team_b_p1(*), team_b_p2(*),
         markets ( id, type, outcomes ( id, market_id, label, prior_prob, current_odds, total_staked, sort_order ) )`,
      )
      .eq("id", id)
      .single();
    if (error) return null;
    return mapMatch(data);
  },
  async getBalance(): Promise<number> {
    const { data } = await supabase!.from("wallets").select("balance").maybeSingle();
    return Number(data?.balance ?? 0);
  },
  async getBets(): Promise<Bet[]> {
    const { data, error } = await supabase!
      .from("bets")
      .select(`id, stake, combined_odds, potential_payout, status, is_combo, created_at,
               bet_legs ( locked_odds, result, outcomes ( label ) )`)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((b: any) => ({
      id: b.id,
      stake: Number(b.stake),
      combinedOdds: Number(b.combined_odds),
      potentialPayout: Number(b.potential_payout),
      status: b.status,
      isCombo: b.is_combo,
      createdAt: b.created_at,
      legs: (b.bet_legs ?? []).map((l: any) => ({
        label: l.outcomes?.label ?? "",
        odds: Number(l.locked_odds),
        result: l.result,
      })),
    }));
  },
  async getTransactions(): Promise<WalletTx[]> {
    const { data, error } = await supabase!
      .from("transactions")
      .select("id, type, amount, note, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return (data ?? []).map((t: any) => ({
      id: t.id,
      type: t.type,
      amount: Number(t.amount),
      note: t.note ?? "",
      createdAt: t.created_at,
    }));
  },
  async placeBet(legs: BetSlipLegInput[], stake: number): Promise<string> {
    const { data, error } = await supabase!.rpc("place_bet", {
      p_legs: legs.map((l) => l.outcomeId),
      p_stake: stake,
    });
    if (error) throw error;
    return data as string;
  },
  async requestDeposit(amountEur: number): Promise<void> {
    const { data: u } = await supabase!.auth.getUser();
    const { error } = await supabase!.from("deposits").insert({
      user_id: u.user!.id,
      amount_eur: amountEur,
      tokens: amountEur * TOKENS_PER_EUR,
      method: "bizum",
      status: "requested",
    });
    if (error) throw error;
  },
  subscribe(fn: () => void): () => void {
    // Nombre de canal ÚNICO por suscripción: varios componentes se suscriben a la
    // vez y reutilizar el mismo nombre rompe supabase-js ("after subscribe()").
    const ch = supabase!
      .channel(`live-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "outcomes" }, fn)
      .on("postgres_changes", { event: "*", schema: "public", table: "matches" }, fn)
      .subscribe();
    return () => {
      supabase!.removeChannel(ch);
    };
  },
  // ---- admin ----
  async listPlayers(): Promise<Player[]> {
    const { data } = await supabase!.from("players").select("*").order("current_ranking");
    return (data ?? []).map((p: any) => ({
      id: p.id,
      name: p.name,
      currentRanking: p.current_ranking,
      currentWinPct: Number(p.current_win_pct),
      historicRanking: p.historic_ranking,
      historicWinPct: Number(p.historic_win_pct),
    }));
  },
  async listPendingDeposits(): Promise<PendingDeposit[]> {
    const { data } = await supabase!
      .from("deposits")
      .select("id, amount_eur, tokens, created_at, profiles(display_name)")
      .eq("status", "requested")
      .order("created_at", { ascending: false });
    return (data ?? []).map((d: any) => ({
      id: d.id,
      userName: d.profiles?.display_name ?? "Jugador",
      amountEur: Number(d.amount_eur),
      tokens: Number(d.tokens),
      createdAt: d.created_at,
    }));
  },
  async confirmDeposit(id: string): Promise<void> {
    const { error } = await supabase!.rpc("confirm_deposit", { p_deposit_id: id });
    if (error) throw error;
  },
  async openMatch(input: OpenMatchInput): Promise<string> {
    const players = await realApi.listPlayers();
    const byId = new Map(players.map((p) => [p.id, p]));
    const stats = (id: string): PlayerStats => {
      const p = byId.get(id)!;
      return {
        id: p.id, name: p.name,
        currentRanking: p.currentRanking, currentWinPct: p.currentWinPct,
        historicRanking: p.historicRanking, historicWinPct: p.historicWinPct,
      };
    };
    const markets = buildMatchMarkets(
      stats(input.teamAp1), stats(input.teamAp2), stats(input.teamBp1), stats(input.teamBp2),
    );
    const { data, error } = await supabase!.rpc("open_match", {
      p_scheduled_at: input.scheduledAt,
      p_team_a_p1: input.teamAp1, p_team_a_p2: input.teamAp2,
      p_team_b_p1: input.teamBp1, p_team_b_p2: input.teamBp2,
      p_markets: markets,
      p_ptg_match_id: null,
    });
    if (error) throw error;
    return data as string;
  },
  async setMatchStatus(matchId: string, status: Match["status"]): Promise<void> {
    const { error } = await supabase!.rpc("set_match_status", { p_match_id: matchId, p_status: status });
    if (error) throw error;
  },
  async settleMatch(matchId: string, res: SettleInput): Promise<void> {
    const { error } = await supabase!.rpc("settle_match", {
      p_match_id: matchId,
      p_winner: res.winner,
      p_had_bagel: res.hadBagel,
      p_three_sets: res.threeSets,
      p_set_scores: res.setScores,
    });
    if (error) throw error;
  },
  async invitePlayer(email: string): Promise<string> {
    const { data, error } = await supabase!.functions.invoke("invite", { body: { email } });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data.link as string;
  },
};

function mapMatch(row: any): Match {
  const p = (x: any) => ({
    id: x.id,
    name: x.name,
    currentRanking: x.current_ranking,
    currentWinPct: Number(x.current_win_pct),
    historicRanking: x.historic_ranking,
    historicWinPct: Number(x.historic_win_pct),
  });
  const titles: Record<string, string> = {
    winner: "Pareja ganadora",
    bagel: "¿Habrá un 6/0?",
    sets: "¿2 o 3 sets?",
  };
  return {
    id: row.id,
    scheduledAt: row.scheduled_at,
    status: row.status,
    winnerTeam: row.winner_team ?? undefined,
    hadBagel: row.had_bagel ?? undefined,
    wentTo3Sets: row.went_to_3_sets ?? undefined,
    teamA: [p(row.team_a_p1), p(row.team_a_p2)],
    teamB: [p(row.team_b_p1), p(row.team_b_p2)],
    markets: (row.markets ?? []).map((m: any) => ({
      id: m.id,
      matchId: row.id,
      type: m.type,
      title: titles[m.type] ?? m.type,
      outcomes: (m.outcomes ?? [])
        .sort((a: any, b: any) => a.sort_order - b.sort_order)
        .map((o: any) => ({
          id: o.id,
          marketId: o.market_id,
          label: o.label,
          priorProb: Number(o.prior_prob),
          currentOdds: Number(o.current_odds),
          totalStaked: Number(o.total_staked),
        })),
    })),
  };
}

export const api = DEMO_MODE ? demoApi : realApi;
