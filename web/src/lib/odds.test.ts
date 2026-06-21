import { describe, it, expect } from "vitest";
import {
  DEFAULT_CONFIG,
  PlayerStats,
  playerRating,
  matchPriors,
  probToOdds,
  blendWithMarket,
  liveOdds,
  combinedOdds,
  potentialPayout,
  parimutuelOdds,
  poolPayout,
} from "./odds";

// Jugadores de referencia
const top: PlayerStats = {
  id: "1",
  name: "Crack",
  currentRanking: 1,
  currentWinPct: 0.9,
  historicRanking: 1,
  historicWinPct: 0.88,
};
const good: PlayerStats = {
  id: "2",
  name: "Bueno",
  currentRanking: 5,
  currentWinPct: 0.65,
  historicRanking: 6,
  historicWinPct: 0.62,
};
const mid: PlayerStats = {
  id: "3",
  name: "Medio",
  currentRanking: 15,
  currentWinPct: 0.5,
  historicRanking: 15,
  historicWinPct: 0.5,
};
const weak: PlayerStats = {
  id: "4",
  name: "Flojo",
  currentRanking: 28,
  currentWinPct: 0.2,
  historicRanking: 27,
  historicWinPct: 0.25,
};

describe("playerRating", () => {
  it("ordena: mejor jugador → mayor rating", () => {
    expect(playerRating(top)).toBeGreaterThan(playerRating(good));
    expect(playerRating(good)).toBeGreaterThan(playerRating(mid));
    expect(playerRating(mid)).toBeGreaterThan(playerRating(weak));
  });

  it("alpha=1 ignora el histórico", () => {
    const cfg = { ...DEFAULT_CONFIG, alpha: 1 };
    const onlyHistoricDiffers: PlayerStats = { ...mid, historicWinPct: 0.99, historicRanking: 1 };
    expect(playerRating(onlyHistoricDiffers, cfg)).toBeCloseTo(playerRating(mid, cfg), 6);
  });
});

describe("matchPriors", () => {
  it("partido igualado ≈ 50/50 y probabilidades suman 1", () => {
    const p = matchPriors(mid, mid, mid, mid);
    expect(p.winA).toBeCloseTo(0.5, 6);
    expect(p.winA + p.winB).toBeCloseTo(1, 6);
    expect(p.gap).toBeCloseTo(0, 6);
  });

  it("gran favorito → P(ganar) alta", () => {
    const p = matchPriors(top, good, weak, weak);
    expect(p.winA).toBeGreaterThan(0.7);
  });

  it("a más desnivel, más probable el 6/0 y menos el 3er set", () => {
    const igualado = matchPriors(mid, mid, mid, mid);
    const desnivel = matchPriors(top, top, weak, weak);
    expect(desnivel.bagelYes).toBeGreaterThan(igualado.bagelYes);
    expect(desnivel.threeSets).toBeLessThan(igualado.threeSets);
  });
});

describe("probToOdds", () => {
  it("aplica margen → cuota por debajo de la justa", () => {
    const fair = 1 / 0.5; // 2.0
    const withMargin = probToOdds(0.5);
    expect(withMargin).toBeLessThan(fair);
    expect(withMargin).toBeGreaterThan(1.8);
  });

  it("nunca baja de 1.01", () => {
    expect(probToOdds(0.999999)).toBeGreaterThanOrEqual(1.01);
  });

  it("el overround del mercado ganador ≈ margen", () => {
    const p = matchPriors(top, good, mid, weak);
    const oA = probToOdds(p.winA);
    const oB = probToOdds(p.winB);
    const overround = 1 / oA + 1 / oB;
    expect(overround).toBeGreaterThan(1.0);
    expect(overround).toBeLessThan(1 + DEFAULT_CONFIG.margin + 0.02);
  });
});

describe("blendWithMarket (híbrido)", () => {
  it("sin dinero, manda el prior", () => {
    expect(blendWithMarket(0.6, 0, 0)).toBe(0.6);
  });

  it("con mucho dinero, la cuota se mueve hacia el mercado", () => {
    const prior = 0.5;
    // 90% del dinero a este resultado, gran volumen
    const blended = blendWithMarket(prior, 9000, 10000);
    expect(blended).toBeGreaterThan(prior);
    expect(blended).toBeLessThan(0.9);
  });

  it("más volumen → más peso al dinero (lambda decae)", () => {
    const poco = blendWithMarket(0.5, 80, 100);
    const mucho = blendWithMarket(0.5, 8000, 10000);
    expect(mucho).toBeGreaterThan(poco); // misma proporción 80%, pero más volumen empuja más
  });

  it("liveOdds: más dinero a un lado → su cuota baja", () => {
    const sinDinero = liveOdds(0.5, 0, 0);
    const conDinero = liveOdds(0.5, 9000, 10000);
    expect(conDinero).toBeLessThan(sinDinero);
  });
});

describe("parimutuel (bote)", () => {
  it("cuota estimada sin dinero ≈ 1/prior (línea de apertura por ranking)", () => {
    // con priorLiquidity como única semilla, odds ≈ 1/prior
    const o = parimutuelOdds(0.5, 0, 0);
    expect(o).toBeGreaterThan(1.9);
    expect(o).toBeLessThan(2.1);
  });

  it("más dinero a un resultado → su cuota estimada baja", () => {
    const sin = parimutuelOdds(0.5, 0, 0);
    const con = parimutuelOdds(0.5, 9000, 10000);
    expect(con).toBeLessThan(sin);
  });

  it("EL BOTE CUADRA: la suma de pagos = bote total", () => {
    // 3 acertantes al resultado ganador con 100/200/300; perdedores aportan 400.
    const winners = [100, 200, 300];
    const stakedOnWinner = 600;
    const pool = 1000; // 600 ganadores + 400 perdedores
    const totalPaid = winners.reduce((s, w) => s + poolPayout(w, stakedOnWinner, pool), 0);
    expect(totalPaid).toBeCloseTo(pool, 6); // se paga exactamente lo que entró
  });

  it("nadie apostó al ganador → reembolso (no se debe dinero inexistente)", () => {
    expect(poolPayout(100, 0, 1000)).toBe(100);
  });

  it("todos al mismo resultado y gana → cada uno recupera lo suyo (cuota ≈ 1)", () => {
    // pool = solo dinero de los ganadores (no hay perdedores)
    const winners = [100, 50, 250];
    const pool = 400;
    winners.forEach((w) => expect(poolPayout(w, 400, pool)).toBeCloseTo(w, 6));
  });
});

describe("combinadas", () => {
  it("cuota combinada = producto de patas", () => {
    expect(combinedOdds([1.5, 2.0, 2.0])).toBeCloseTo(6.0, 6);
  });

  it("payout = stake × cuota combinada", () => {
    expect(potentialPayout(100, [1.5, 2.0])).toBeCloseTo(300, 6);
  });

  it("respeta el tope de payout", () => {
    expect(potentialPayout(100, [10, 10, 10], 5000)).toBe(5000); // 100*1000 capado a 5000
  });
});
