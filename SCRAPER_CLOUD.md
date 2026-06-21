# Scraper PTG 24/7 (sin tu Mac)

El scraper actualiza win% de jugadores, liquida partidos terminados y **auto-descubre
partidos próximos** (clave para mapear las parejas ~2h antes). Para que corra solo hay
dos caminos. Ambos necesitan la **sesión de PTG** como variable:

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

## Mercado "pareja ganadora" (pendiente de datos)
Un partido próximo en PTG solo guarda la **lista de apuntados**; las **parejas** no
existen como campo hasta ~2h antes. Con el scraper corriendo 24/7, cuando un partido
entre en esa ventana, el auto-descubrimiento volcará el registro completo (a
`/tmp/ptg-upcoming.json` y al log) → ahí se ve el campo de parejas y lo mapeo en
minutos para abrir ese mercado automáticamente. Hasta entonces, el admin lo abre a mano.
