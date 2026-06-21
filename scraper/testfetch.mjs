// Prueba end-to-end SIN Supabase: usa la sesión guardada para abrir PTG en vivo,
// intercepta las respuestas de Elasticsearch y las parsea. Read-only.
import { PtgClient } from "./src/ptg.ts";
import { collectDocs, parsePlayers, parseMatches } from "./src/parse.ts";

const client = new PtgClient();
await client.init();
console.log("Sesión cargada. Abriendo PTG en vivo (headless)…");
const payloads = await client.fetchDocs();
await client.close();

const docs = collectDocs(payloads);
const players = parsePlayers(docs);
const matches = parseMatches(docs);
console.log(`Respuestas interceptadas: ${payloads.length}`);
console.log(`Documentos: ${docs.length}`);
console.log(`Jugadores en vivo: ${players.length}`);
console.log(`Partidos en vivo: ${matches.length} (con resultado: ${matches.filter((m) => m.result).length})`);
if (players.length) {
  const top = [...players].sort((a, b) => b.currentRatio - a.currentRatio)[0];
  console.log(`Ejemplo jugador: ${top.name} ratio_act=${top.currentRatio.toFixed(3)} win=${(top.currentWinPct * 100).toFixed(0)}%`);
}
console.log(players.length > 0 ? "✅ SESIÓN VIVA OK — el scraper puede leer PTG" : "⚠️ sin datos (¿sesión expirada o ruta incorrecta?)");
