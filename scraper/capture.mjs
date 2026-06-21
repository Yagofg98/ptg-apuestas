// Capturador único: abre un navegador real, tú haces login en PTG, y yo guardo
// todas las respuestas JSON + el HTML del feed para mapear la estructura.
// Además persiste la sesión (.ptg-session.json) para que el scraper la reutilice.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = "/tmp/ptg-capture";
mkdirSync(OUT, { recursive: true });

const here = dirname(fileURLToPath(import.meta.url));
const PROFILE = join(here, ".ptg-profile");
const SESSION = join(here, ".ptg-session.json");
const WAIT_MS = Number(process.env.WAIT_MS ?? 240000);

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  viewport: { width: 1280, height: 900 },
});
const page = ctx.pages()[0] ?? (await ctx.newPage());

let i = 0;
const seen = [];
ctx.on("response", async (res) => {
  try {
    const ct = res.headers()["content-type"] || "";
    if (!ct.includes("json")) return;
    const url = res.url();
    // ignorar ruido de analítica/terceros
    if (/google|gstatic|doubleclick|sentry|hotjar|facebook|analytics/.test(url)) return;
    const body = await res.text();
    if (!body || body.length < 5) return;
    const name = `${String(i++).padStart(3, "0")}_${res.request().method()}.json`;
    writeFileSync(`${OUT}/${name}`, `// ${res.request().method()} ${url}\n${body}`);
    seen.push(`${res.status()} ${url} (${body.length}b)`);
    console.log("CAPTURED", url, body.length + "b");
  } catch {}
});

await page.goto("https://padelteamgourmet.com").catch(() => {});
console.log("==========================================================");
console.log(">> HAZ LOGIN en la ventana que se ha abierto.");
console.log(">> Luego ENTRA en la sección de PARTIDOS / FEED y muévete un poco.");
console.log(`>> Capturando durante ${WAIT_MS / 1000}s...`);
console.log("==========================================================");

await new Promise((r) => setTimeout(r, WAIT_MS));

// guardar la sesión SIEMPRE (cookies Bubble) para que el scraper la reutilice
try {
  await ctx.storageState({ path: SESSION });
  console.log("Sesión guardada en", SESSION);
} catch (e) {
  console.error("No se pudo guardar la sesión:", e?.message);
}
// guardar HTML de la página actual y del feed por si el contenido es server-rendered
try {
  writeFileSync(`${OUT}/_current.html`, await page.content());
} catch {}
try {
  await page.goto("https://padelteamgourmet.com/feed", { waitUntil: "networkidle", timeout: 20000 });
  writeFileSync(`${OUT}/_feed.html`, await page.content());
} catch {}

writeFileSync(`${OUT}/_urls.txt`, seen.join("\n"));
console.log("DONE. Respuestas guardadas en", OUT);
await ctx.close();
process.exit(0);
