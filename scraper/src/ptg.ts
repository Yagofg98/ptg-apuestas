import { chromium, type BrowserContext } from "playwright";
import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config } from "./config.ts";

const here = dirname(fileURLToPath(import.meta.url));
const SESSION = join(here, "..", ".ptg-session.json"); // sesión capturada (cookies Bubble)

// En la nube no hay fichero: si viene SESSION_JSON por env, lo escribimos a disco.
if (!existsSync(SESSION) && process.env.SESSION_JSON) {
  writeFileSync(SESSION, process.env.SESSION_JSON);
}

/**
 * Cliente PTG. PTG (Bubble.io) carga los datos vía POST a /elasticsearch/msearch
 * y /elasticsearch/mget. En lugar de raspar el DOM o replicar las queries ofuscadas
 * de Bubble, abrimos las páginas con la SESIÓN guardada e interceptamos esas
 * respuestas JSON (lo que demostró funcionar al capturar). Devolvemos los `_source`
 * crudos; el parseo lo hace parse.ts.
 */
export class PtgClient {
  private ctx?: BrowserContext;

  async init() {
    if (!existsSync(SESSION)) {
      throw new Error(
        `No hay sesión PTG (${SESSION}). Ejecuta primero la captura: node capture.mjs y haz login.`,
      );
    }
    const browser = await chromium.launch({ headless: true });
    this.ctx = await browser.newContext({ storageState: SESSION });
  }

  async close() {
    await this.ctx?.browser()?.close();
  }

  /**
   * Navega por las páginas que cargan partidos/rankings e intercepta todas las
   * respuestas JSON de Elasticsearch. Devuelve la lista de payloads crudos.
   */
  async fetchDocs(): Promise<any[]> {
    const page = await this.ctx!.newPage();
    const payloads: any[] = [];

    page.on("response", async (res) => {
      const url = res.url();
      // PTG carga datos por msearch/mget y, en /partidos (próximos), por /search.
      if (!/\/elasticsearch\/(msearch|mget|search)/.test(url)) return;
      try {
        payloads.push(await res.json());
      } catch {
        /* ignorar respuestas no-JSON */
      }
    });

    const base = config.ptg.baseUrl;
    // Páginas que disparan las búsquedas de datos. /partidos carga los PRÓXIMOS
    // partidos (vía /elasticsearch/search) — clave para el grupo azul.
    const routes = [base + "/", base + config.ptg.feedPath, base + "/partidos"];
    for (const route of routes) {
      try {
        await page.goto(route, { waitUntil: "networkidle", timeout: 30000 });
        await page.waitForTimeout(2500); // dar margen a búsquedas tardías
      } catch {
        /* seguir con la siguiente ruta */
      }
    }

    await page.close();
    return payloads;
  }
}
