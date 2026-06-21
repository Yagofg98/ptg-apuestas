# Scraper PTG 24/7 (sin tu Mac)

El scraper actualiza win% de jugadores, liquida partidos terminados y **auto-importa los
próximos partidos del grupo azul** como partidos `pending` (alguien les asigna las parejas
en la app para abrir apuestas). Para que corra solo hay dos caminos. Ambos necesitan la
**sesión de PTG** como variable:

- `PTG_SESSION_JSON` = contenido de `scraper/.ptg-session.json` (un JSON largo).
  Cuando caduque (Bubble), re-ejecuta `node capture.mjs` en local y actualiza el secreto.

Variables comunes: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (ambas en `scraper/.env`).

---

## Opción 1 — GitHub Actions (GRATIS, recomendada)
Cron cada 15 min, sin servidor. Ya está el workflow en `.github/workflows/scrape.yml`.
1. Sube el repo a GitHub (privado).
2. Repo → Settings → Secrets and variables → Actions → añade:
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PTG_SESSION_JSON`.
3. Actions → "PTG scrape" → Run (o espera al cron). Listo.

> Necesito de ti: o me das un **token de GitHub** (repo+workflow) y lo subo yo, o lo
> subes tú y pegas los 3 secrets.

## Opción 2 — Railway (always-on, bucle cada 2 min)
Ya está el `scraper/Dockerfile`.
1. railway.app → New Project → Deploy from repo (o `railway up` con la CLI).
2. Root del servicio = `scraper`. Variables: `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_JSON`, `POLL_INTERVAL_SECONDS=120`.

> Necesito de ti: un **token de Railway** (Account → Tokens) y lo despliego yo.

---

## Mercado "pareja ganadora" (parejas a mano)
CONFIRMADO: PTG **no publica las parejas hasta que el partido acaba** (los próximos solo
traen fecha + grupo + ≤1 apuntado). Por eso el scraper crea los próximos de azul como
`status='pending'` y en la app (página **➕ Crear** → "Partidos PTG por configurar")
alguien asigna las 2 parejas → se calculan cuotas y se abre a apuestas. El grupo se
configura con `PTG_AUTO_GROUP` (por defecto `azul`).
