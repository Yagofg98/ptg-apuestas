/**
 * Motor de cuotas híbrido para PTG Apuestas.
 *
 * Dos pasos (ver plan):
 *   1) PRIOR por ranking: cada jugador → "skill" en (0,1) combinando ranking
 *      (actual + histórico) y % de victorias → rating en log-odds → probabilidad
 *      del mercado vía sigmoide → cuota con margen.
 *   2) AJUSTE DINÁMICO: la probabilidad previa se mezcla con la probabilidad
 *      implícita del dinero apostado (estilo parimutuel con "liquidez fantasma"
 *      como prior bayesiano). A más volumen, más manda el mercado.
 *
 * Todo es función pura → fácil de testear y de reutilizar en el scraper/Edge Functions.
 */

// ----------------------------------------------------------------------------
// Tipos
// ----------------------------------------------------------------------------

export interface PlayerStats {
  id: string;
  name: string;
  /** Posición en el ranking ACTUAL (1 = mejor). */
  currentRanking: number;
  /** % de victorias en la temporada actual, en [0,1]. */
  currentWinPct: number;
  /** Posición en el ranking HISTÓRICO (1 = mejor). Si no hay, usar el actual. */
  historicRanking: number;
  /** % de victorias histórico, en [0,1]. */
  historicWinPct: number;
}

export type MarketType = "winner" | "bagel" | "sets";

export interface OddsConfig {
  /** Tamaño de la liga (nº de jugadores rankeados) para normalizar la posición. */
  leagueSize: number;
  /** Peso del ranking ACTUAL frente al histórico, en [0,1]. 0.7 = el actual manda. */
  alpha: number;
  /** Dentro de cada temporada, peso del ranking (posición) vs el % de victorias. */
  rankWeight: number;
  /** Factor de decisión: cuánto importa la diferencia de rating en P(ganar). */
  decisiveness: number;
  /** Margen (overround) del bote, p. ej. 0.05 = 5%. */
  margin: number;
  /** "Liquidez fantasma" del prior, en tokens: cuánto dinero hace falta para que
   *  el mercado empiece a mover la cuota. Más alto = la cuota se mueve más lento. */
  priorLiquidity: number;
  // --- Curvas de mercados derivados (en unidades de rating, log-odds) ---
  bagelBase: number; // P(6-0) mínima en partido igualado
  bagelMax: number; // P(6-0) máxima en gran desnivel
  bagelGapScale: number;
  threeSetMin: number; // P(3 sets) mínima en gran desnivel
  threeSetMax: number; // P(3 sets) máxima en partido igualado
  threeSetGapScale: number;
}

export const DEFAULT_CONFIG: OddsConfig = {
  leagueSize: 30,
  alpha: 0.7,
  rankWeight: 0.5,
  decisiveness: 1.1,
  margin: 0.05,
  priorLiquidity: 500,
  bagelBase: 0.06,
  bagelMax: 0.55,
  bagelGapScale: 1.2,
  threeSetMin: 0.12,
  threeSetMax: 0.55,
  threeSetGapScale: 1.0,
};

// ----------------------------------------------------------------------------
// Utilidades numéricas
// ----------------------------------------------------------------------------

const EPS = 1e-6;

// Banda del "skill" de un jugador: evita ratings extremos por muestras pequeñas
// (p.ej. 0%/100% en 1 partido) que dispararían cuotas absurdas dentro del grupo.
const SKILL_FLOOR = 0.1;
const SKILL_CEIL = 0.9;

export function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/** Probabilidad → log-odds (rating). */
function logit(p: number): number {
  const q = clamp(p, EPS, 1 - EPS);
  return Math.log(q / (1 - q));
}

/** Sigmoide: rating → probabilidad. */
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/** Posición de ranking (1 = mejor) → puntuación normalizada en [0,1]. */
function rankScore(ranking: number, leagueSize: number): number {
  const size = Math.max(2, leagueSize);
  const r = clamp(ranking, 1, size);
  return (size - r) / (size - 1);
}

// ----------------------------------------------------------------------------
// Rating de jugador y de pareja
// ----------------------------------------------------------------------------

/**
 * Rating de un jugador en log-odds, combinando ranking + % victorias y mezclando
 * temporada actual con histórico según `alpha`.
 */
export function playerRating(p: PlayerStats, cfg: OddsConfig = DEFAULT_CONFIG): number {
  const w = clamp(cfg.rankWeight, 0, 1);

  const skillCurrent =
    w * rankScore(p.currentRanking, cfg.leagueSize) + (1 - w) * clamp(p.currentWinPct, 0, 1);
  const skillHistoric =
    w * rankScore(p.historicRanking, cfg.leagueSize) + (1 - w) * clamp(p.historicWinPct, 0, 1);

  // Acotamos el "skill" a una banda para que nadie del mismo grupo sea un rating
  // extremo (p.ej. 0% en 1 partido → "infinitamente malo"). Evita cuotas absurdas.
  const ratingCurrent = logit(clamp(skillCurrent, SKILL_FLOOR, SKILL_CEIL));
  const ratingHistoric = logit(clamp(skillHistoric, SKILL_FLOOR, SKILL_CEIL));

  const a = clamp(cfg.alpha, 0, 1);
  return a * ratingCurrent + (1 - a) * ratingHistoric;
}

/** Rating de pareja = media de los dos jugadores. */
export function teamRating(p1: PlayerStats, p2: PlayerStats, cfg: OddsConfig = DEFAULT_CONFIG): number {
  return (playerRating(p1, cfg) + playerRating(p2, cfg)) / 2;
}

// ----------------------------------------------------------------------------
// Probabilidades previas (prior) por mercado
// ----------------------------------------------------------------------------

export interface MatchPriors {
  /** P(gana pareja A). */
  winA: number;
  /** P(gana pareja B). */
  winB: number;
  /** P(habrá algún 6/0 en el partido). */
  bagelYes: number;
  /** P(el partido se va a 3 sets). */
  threeSets: number;
  /** Desnivel absoluto de rating entre parejas. */
  gap: number;
}

/**
 * Calcula las probabilidades previas de los 3 mercados a partir de las dos parejas.
 * Pareja A = [a1, a2], Pareja B = [b1, b2].
 */
export function matchPriors(
  a1: PlayerStats,
  a2: PlayerStats,
  b1: PlayerStats,
  b2: PlayerStats,
  cfg: OddsConfig = DEFAULT_CONFIG,
): MatchPriors {
  const ra = teamRating(a1, a2, cfg);
  const rb = teamRating(b1, b2, cfg);
  const diff = ra - rb;
  const gap = Math.abs(diff);

  const winA = sigmoid(cfg.decisiveness * diff);
  const winB = 1 - winA;

  // 6/0: crece con el desnivel (saturando).
  const bagelYes = clamp(
    cfg.bagelBase + (cfg.bagelMax - cfg.bagelBase) * (1 - Math.exp(-gap / cfg.bagelGapScale)),
    EPS,
    1 - EPS,
  );

  // 3 sets: decrece con el desnivel (partido igualado → más probable el 3er set).
  const threeSets = clamp(
    cfg.threeSetMin + (cfg.threeSetMax - cfg.threeSetMin) * Math.exp(-gap / cfg.threeSetGapScale),
    EPS,
    1 - EPS,
  );

  return { winA, winB, bagelYes, threeSets, gap };
}

// ----------------------------------------------------------------------------
// Probabilidad → cuota (con margen) y mezcla dinámica con el dinero
// ----------------------------------------------------------------------------

/** Probabilidad → cuota decimal aplicando el margen (overround) del bote. */
export function probToOdds(prob: number, cfg: OddsConfig = DEFAULT_CONFIG): number {
  const p = clamp(prob, EPS, 1 - EPS);
  const fair = 1 / p;
  const withMargin = fair / (1 + cfg.margin);
  // Nunca por debajo de 1.01 para que siempre haya algo de premio.
  return Math.max(1.01, round2(withMargin));
}

/**
 * Mezcla la probabilidad previa con la del dinero apostado (lo "híbrido").
 *
 *   pMoney  = apostado a este resultado / total apostado en el mercado
 *   lambda  = priorLiquidity / (priorLiquidity + totalApostado)   (decae con volumen)
 *   pFinal  = lambda · pPrior + (1 − lambda) · pMoney
 *
 * Con `totalStaked = 0` → lambda = 1 → manda el prior por completo.
 */
export function blendWithMarket(
  priorProb: number,
  stakedOnOutcome: number,
  totalStakedInMarket: number,
  cfg: OddsConfig = DEFAULT_CONFIG,
): number {
  if (totalStakedInMarket <= 0) return priorProb;
  const pMoney = clamp(stakedOnOutcome / totalStakedInMarket, EPS, 1 - EPS);
  const lambda = cfg.priorLiquidity / (cfg.priorLiquidity + totalStakedInMarket);
  return clamp(lambda * priorProb + (1 - lambda) * pMoney, EPS, 1 - EPS);
}

/** Cuota viva de un resultado = prior mezclado con el dinero, pasado a cuota. */
export function liveOdds(
  priorProb: number,
  stakedOnOutcome: number,
  totalStakedInMarket: number,
  cfg: OddsConfig = DEFAULT_CONFIG,
): number {
  const pFinal = blendWithMarket(priorProb, stakedOnOutcome, totalStakedInMarket, cfg);
  return probToOdds(pFinal, cfg);
}

// ----------------------------------------------------------------------------
// PARIMUTUEL (bote) — modelo sin casa: el dinero de un bolsillo va a otro.
// El bote de un mercado se reparte entre los acertantes. Cuadra siempre.
// ----------------------------------------------------------------------------

/**
 * Cuota ESTIMADA parimutuel de un resultado. NO está garantizada: es el multiplicador
 * que pagaría ahora mismo el bote. Se siembra con el prior del ranking (priorLiquidity
 * como "dinero fantasma" solo para la estimación), y converge al bote real conforme
 * entra dinero. Sin margen de casa → la suma de probabilidades implícitas = 1.
 */
export function parimutuelOdds(
  priorProb: number,
  stakedOnOutcome: number,
  totalStakedInMarket: number,
  cfg: OddsConfig = DEFAULT_CONFIG,
): number {
  const L = cfg.priorLiquidity;
  const pool = totalStakedInMarket + L;
  const onOutcome = stakedOnOutcome + L * clamp(priorProb, EPS, 1 - EPS);
  return Math.max(1.01, round2(pool / onOutcome));
}

/**
 * Reparto REAL del bote al liquidar (settlement). Paga a cada acertante en proporción
 * a su apuesta: stake · (bote_total / apostado_al_resultado_ganador).
 * Si nadie apostó al ganador → reembolso (no hay con qué pagar de otro lado).
 * Garantía: la suma de pagos = bote_total (cuadra al céntimo).
 */
export function poolPayout(stake: number, stakedOnWinner: number, poolTotal: number): number {
  if (stakedOnWinner <= 0) return round2(stake); // reembolso
  return round2(stake * (poolTotal / stakedOnWinner));
}

// ----------------------------------------------------------------------------
// Combinadas (parlays)
// ----------------------------------------------------------------------------

/** Cuota de una combinada = producto de las cuotas de cada pata. */
export function combinedOdds(legOdds: number[]): number {
  if (legOdds.length === 0) return 1;
  return round2(legOdds.reduce((acc, o) => acc * o, 1));
}

/**
 * Premio potencial de una apuesta (simple o combinada), con tope para proteger el bote.
 */
export function potentialPayout(
  stake: number,
  legOdds: number[],
  maxPayout = Infinity,
): number {
  return Math.min(maxPayout, round2(stake * combinedOdds(legOdds)));
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
