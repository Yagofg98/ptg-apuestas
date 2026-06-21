import { config } from "./config.ts";
import { PtgClient } from "./ptg.ts";
import { syncFromDocs } from "./sync.ts";

const ONCE = process.argv.includes("--once");

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
  try {
    const payloads = await client.fetchDocs();
    const res = await syncFromDocs(payloads);
    console.log(
      `[${new Date().toISOString()}] sync OK — ${res.docs} docs, ${res.count} jugadores, ${res.settled} liquidados, ${res.created}/${res.upcoming} próximos importados`,
    );
  } catch (err) {
    // Resiliencia: un fallo NO debe tumbar el proceso. El admin puede operar a mano.
    console.error(`[${new Date().toISOString()}] sync ERROR:`, (err as Error).message);
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
}

main();
