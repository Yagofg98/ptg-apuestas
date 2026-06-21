# 🎾 PTG Apuestas

App de apuestas de pádel para el grupo **Padel Team Gourmet**. PWA instalable por
link, saldo en tokens, cuotas híbridas (ranking actual + histórico, se mueven con
el dinero) y apuestas combinadas. Mercados por partido:

- **Pareja ganadora**
- **¿Habrá un 6/0?**
- **¿2 o 3 sets?**

> ⚠️ **Apuestas sociales entre amigos, sin ánimo de lucro.** Los tokens representan
> saldo depositado (1 € = 100 tk). El dinero real lo gestiona un **tesorero** fuera
> de la app (Bizum/transferencia); la app es solo el libro contable. No es una casa
> de apuestas con licencia. Revisa implicaciones legales/fiscales antes de manejar
> cantidades relevantes.

## Estructura

```
web/        PWA (React + Vite + TS + Tailwind). Motor de cuotas + UI.
supabase/   Esquema Postgres + RLS + funciones RPC (place_bet, settle_match, ...).
scraper/    Worker Node + Playwright: login PTG → feed → Supabase (service-role).
```

## Arranque rápido (MODO DEMO, sin backend)

La app arranca con datos de ejemplo en memoria — ideal para probar y enseñar.

```bash
cd web
npm install
npm run dev        # abre http://localhost:5173
```

Puedes apostar, ver las cuotas moverse con el dinero (efecto híbrido) y montar
combinadas. Todo en memoria; se reinicia al recargar.

## Tests del motor de cuotas

```bash
cd web && npm test
```

## Producción (backend real)

1. **Supabase**: crea un proyecto y aplica las migraciones de `supabase/migrations/`
   (`0001_init.sql`, `0002_functions.sql`) en el SQL editor.
2. **Web**: copia `web/.env.example` → `web/.env.local` y rellena
   `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`. `npm run build` → despliega
   `web/dist` en Vercel/Netlify. Comparte el link; en el móvil: **Añadir a inicio**.
3. **Scraper** (PTG = Bubble.io + Elasticsearch, sin API pública):
   ```bash
   cd scraper && npm install && npx playwright install chromium
   # 1) Capturar sesión (una vez): abre un navegador, HAZ LOGIN en PTG, y se guarda
   #    la sesión en scraper/.ptg-session.json
   node capture.mjs
   # 2) Probar lectura en vivo (sin Supabase):
   node --experimental-strip-types testfetch.mjs
   # 3) Sincronizar a Supabase (con .env configurado):
   npm run once     # una pasada    | npm start  → bucle de sondeo
   ```
   El scraper abre PTG con la sesión guardada e **intercepta las respuestas de
   `/elasticsearch/msearch` y `/mget`** (no raspa DOM ni replica queries). El parseo
   vive en [`scraper/src/parse.ts`](scraper/src/parse.ts) y está validado contra datos
   reales (`node validate.mjs`). Cuando la sesión de Bubble expire, re-ejecuta
   `node capture.mjs` para refrescarla.

## Cómo funcionan las cuotas (modelo PARIMUTUEL — sin casa)

No hay casa de apuestas ni pasarela: **el dinero de un bolsillo va al de otro**, y
**cuadra siempre**. Cada mercado (ganador / 6-0 / 2-3 sets) es un **bote**:

1. **Cuota estimada** = se siembra con el ranking (rating de actual + histórico,
   ver `playerRating`/`matchPriors`) y se ajusta con el dinero del bote. **No lleva
   margen** → la suma de probabilidades implícitas = 1 (cuota justa).
2. **Liquidación** = el bote se reparte entre los acertantes en proporción a lo
   apostado (`poolPayout`). La suma de pagos = el bote → cuadra al céntimo.
   - Si nadie acertó un mercado → reembolso.
   - Si todos apuestan lo mismo y aciertan → cada uno recupera lo suyo (cuota ≈ 1).
3. **Combinadas**: solo del **mismo partido**; compiten en un bote de combinadas
   aparte (mismo principio de reparto).

Toda la lógica vive en [`web/src/lib/odds.ts`](web/src/lib/odds.ts) — funciones
`parimutuelOdds` (cuota estimada) y `poolPayout` (reparto), con tests que verifican
el cuadre. **Pendiente**: replicar este modelo en las funciones SQL de Supabase
(ahora son de cuota fija) al montar el backend.

## Estado / roadmap

- [x] Motor de cuotas híbrido + tests
- [x] PWA instalable, mercados, boleto/combinadas, cartera (modo demo end-to-end)
- [x] Esquema Supabase + RPC atómicas + RLS
- [x] Panel admin (confirmar depósitos, override de resultados, lock de partidos)
- [x] **Scraper real**: PTG descifrado (Bubble+Elasticsearch), parser validado contra
      datos reales y lectura en vivo probada con sesión guardada
- [ ] Sincronizar **partidos PRÓXIMOS con parejas** (confirmar campos pre-partido:
      requiere capturar un partido programado con 4 apuntados)
- [ ] Afinar rutas que visita el scraper para traer el roster completo
- [ ] Web Push (partido abierto / apuesta liquidada) y marcador en vivo
- [ ] Leaderboard de apostadores
```
