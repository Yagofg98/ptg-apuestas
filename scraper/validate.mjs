// Valida el parser contra los datos REALES capturados de PTG (scraper/fixtures/).
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { collectDocs, parsePlayers, parseMatches, assignRankingPositions } from "./src/parse.ts";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "fixtures");

const payloads = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith(".json")) continue;
  try {
    const raw = readFileSync(join(dir, f), "utf8").split("\n").slice(1).join("\n");
    payloads.push(JSON.parse(raw));
  } catch {}
}

const docs = collectDocs(payloads);
const players = parsePlayers(docs);
const matches = parseMatches(docs);
const finished = matches.filter((m) => m.result);
const pos = assignRankingPositions(players);

console.log(`Documentos: ${docs.length}`);
console.log(`Jugadores parseados: ${players.length}`);
console.log(`Partidos: ${matches.length} (con resultado: ${finished.length})`);

const named = players.filter((p) => p.name && !p.name.includes("@")).length;
console.log(`Jugadores con NOMBRE resuelto: ${named}/${players.length}`);

console.log("\n--- TOP 5 ranking actual (por ratio) ---");
[...players]
  .sort((a, b) => b.currentRatio - a.currentRatio)
  .slice(0, 5)
  .forEach((p) => {
    const r = pos.get(p.rankingId);
    console.log(
      `  #${r.current} ${p.name.padEnd(24)} ratio_act=${p.currentRatio.toFixed(3)} win_act=${(p.currentWinPct * 100).toFixed(0)}% win_h=${(p.historicWinPct * 100).toFixed(0)}% PJ=${p.matchesCurrent}`,
    );
  });

console.log("\n--- 3 partidos con resultado ---");
const nameByRanking = new Map(players.map((p) => [p.rankingId, p.name]));
finished.slice(0, 3).forEach((m) => {
  const nm = (id) => nameByRanking.get(id) ?? id.slice(0, 6);
  console.log(
    `  ${new Date(m.date).toLocaleDateString("es-ES")} [${m.group}] ${m.result.winnerRankingIds.map(nm).join(" + ")}  vs  ${m.result.loserRankingIds.map(nm).join(" + ")}`,
  );
  console.log(
    `      marcador=${JSON.stringify(m.result.setScores)} sets=${m.result.setsPlayed} 3sets=${m.result.wentTo3Sets} 6/0=${m.result.hadBagel}`,
  );
});

// sanity checks
const ok =
  players.length > 0 &&
  finished.length > 0 &&
  finished.every((m) => m.result.winnerRankingIds.length === 2 && m.result.loserRankingIds.length === 2);
console.log(`\n${ok ? "✅ PARSER OK contra datos reales" : "❌ algo falla"}`);
process.exit(ok ? 0 : 1);
