# Scraper PTG 24/7 (sin tu Mac)

El scraper actualiza win% de jugadores, liquida partidos terminados y **auto-importa los
próximos partidos del grupo azul** como partidos `pending` (alguien les asigna las parejas
en la app para abrir apuestas). Para que corra solo hay dos caminos. Ambos necesitan la
**sesión de PTG** como variable:

- `PTG_SESSION_JSON` = contenido de `scraper/.ptg-session.json` (un JSON largo).
  Cuando caduque (Bubble), re-ejecuta `node capture.mjs` en local y actualiza el secreto.

Variables comunes: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (ambas en `scraper/.env`).

---

## Opción 1 — GitHub Actions, bucle continuo (GRATIS, recomendada)
Sondeo **cada 2 min, 24/7**, sin servidor. El workflow `.github/workflows/scrape.yml`
corre el bucle ~50 min por turno y **se relanza a sí mismo** (cadena always-on); un cron
horario actúa de red de seguridad. **Requiere el repo PÚBLICO** para tener minutos de
Actions gratis e ilimitados (en privado solo hay 2.000 min/mes, insuficiente para 24/7).
El repo no contiene secretos (van en Actions Secrets), así que público solo expone el código.
1. Repo en GitHub **público**.
2. Repo → Settings → Secrets and variables → Actions → añade:
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PTG_SESSION_JSON`.
3. Al hacer push a `main` arranca solo; o Actions → "PTG scrape" → Run.

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
