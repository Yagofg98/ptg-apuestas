import { config } from "./config.ts";
import { PtgClient } from "./ptg.ts";
import { syncFromDocs } from "./sync.ts";

const ONCE = process.argv.includes("--once");

// Salud de la sesión: si la sesión PTG caduca, fetchDocs deja de interceptar datos
// (PTG redirige a login) → 0 docs/0 jugadores. Tras N pasadas malas SEGUIDAS fallamos
// ruidosamente (exit 1) para que GitHub avise por email; el bucle sano resetea a 0.
const MAX_CONSECUTIVE_FAILS = Number(process.env.MAX_CONSECUTIVE_FAILS ?? 3);
let consecutiveFails = 0;

function assertConfig() {
  const missing = [
    ["SUPABASE_URL", config.supabase.url],
    ["SUPABASE_SERVICE_ROLE_KEY", config.supabase.serviceRoleKey],
  ].filter(([, v]) => !v);
  if (missing.length) {
    console.error("Faltan variables de entorno:", missing.map(([k]) => k).join(", "));
    process.exit(1);
  }
}

async function tick(client: PtgClient) {
  let healthy = false;
  try {
    const payloads = await client.fetchDocs();
    const res = await syncFromDocs(payloads);
    // Sesión viva ⇒ siempre hay jugadores/rankings. 0 docs/0 jugadores ⇒ sesión muerta.
    healthy = res.docs > 0 && res.count > 0;
    console.log(
      `[${new Date().toISOString()}] sync OK — ${res.docs} docs, ${res.count} jugadores, ${res.settled} liquidados, ${res.created}/${res.upcoming} próximos importados`,
    );
    if (!healthy) {
      console.error(
        `[${new Date().toISOString()}] ⚠️ pasada sin datos (${consecutiveFails + 1}/${MAX_CONSECUTIVE_FAILS}) — ¿sesión PTG caducada?`,
      );
    }
  } catch (err) {
    console.error(
      `[${new Date().toISOString()}] sync ERROR (${consecutiveFails + 1}/${MAX_CONSECUTIVE_FAILS}):`,
      (err as Error).message,
    );
  }

  consecutiveFails = healthy ? 0 : consecutiveFails + 1;
  if (consecutiveFails >= MAX_CONSECUTIVE_FAILS) {
    console.error(
      "❌ Sesión PTG probablemente CADUCADA. Regenera la sesión: `cd scraper && node capture.mjs` " +
        "(login a mano), copia el nuevo .ptg-session.json al secret PTG_SESSION_JSON y re-lanza el workflow.",
    );
    // Sin await: cerrar el navegador puede colgarse con ticks solapados; salimos ya
    // (process.exit mata el proceso y su Chromium). El job falla → GitHub avisa.
    void client.close().catch(() => {});
    process.exit(1);
  }
}

async function main() {
  assertConfig();
  const client = new PtgClient();
  await client.init();

  await tick(client);

  if (ONCE) {
    await client.close();
    return;
  }

  console.log(`Sondeando cada ${config.pollIntervalMs / 1000}s. Ctrl+C para parar.`);
  const timer = setInterval(() => tick(client), config.pollIntervalMs);

  const shutdown = async () => {
    clearInterval(timer);
    await client.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // En CI encadenamos turnos: tras MAX_RUNTIME_SECONDS salimos limpio y el workflow
  // relanza el siguiente. 0 = sin límite (VM always-on).
  if (config.maxRuntimeMs > 0) {
    console.log(`Turno limitado a ${config.maxRuntimeMs / 1000}s; luego relevo.`);
    setTimeout(() => {
      console.log("Fin del turno: cerrando para encadenar el siguiente.");
      shutdown();
    }, config.maxRuntimeMs).unref();
  }
}

main();
