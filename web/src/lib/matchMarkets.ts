import { DEFAULT_CONFIG, matchPriors, probToOdds, PlayerStats } from "./odds";

export interface MarketPayload {
  type: "winner" | "bagel" | "sets";
  outcomes: { label: string; prior: number; odds: number }[];
}

/**
 * A partir de las 4 jugadoras/es, calcula los 3 mercados con sus cuotas iniciales.
 * Lo usan el panel admin (backend real, vía RPC open_match) y el modo demo.
 */
export function buildMatchMarkets(
  a1: PlayerStats,
  a2: PlayerStats,
  b1: PlayerStats,
  b2: PlayerStats,
): MarketPayload[] {
  const p = matchPriors(a1, a2, b1, b2, DEFAULT_CONFIG);
  const od = (prob: number) => probToOdds(prob, DEFAULT_CONFIG);
  return [
    {
      type: "winner",
      outcomes: [
        { label: "Pareja A", prior: p.winA, odds: od(p.winA) },
        { label: "Pareja B", prior: p.winB, odds: od(p.winB) },
      ],
    },
    {
      type: "bagel",
      outcomes: [
        { label: "Sí", prior: p.bagelYes, odds: od(p.bagelYes) },
        { label: "No", prior: 1 - p.bagelYes, odds: od(1 - p.bagelYes) },
      ],
    },
    {
      type: "sets",
      outcomes: [
        { label: "2 sets", prior: 1 - p.threeSets, odds: od(1 - p.threeSets) },
        { label: "3 sets", prior: p.threeSets, odds: od(p.threeSets) },
      ],
    },
  ];
}
