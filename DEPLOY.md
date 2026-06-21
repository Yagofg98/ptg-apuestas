# Deploy a producción (link público para el grupo)

Datos del proyecto Supabase ya creado:
- **URL**: `https://sillaiqmxpzijmmfkvtx.supabase.co`
- anon key → en `web/.env.local` (VITE_SUPABASE_ANON_KEY)
- service_role → en `scraper/.env`

---

## 1) Desplegar la PWA en Vercel (gratis)

Más fácil con la CLI desde la carpeta `web/`:

```bash
cd web
npm i -g vercel       # o: npx vercel
vercel login          # te autenticas (abre el navegador)
vercel --prod         # primer deploy: acepta defaults; framework = Vite
```

Cuando pregunte el **directorio raíz**, es `web` (o ejecuta desde dentro de `web/`).
Build command `npm run build`, output `dist` (Vite por defecto).

**Variables de entorno en Vercel** (Project → Settings → Environment Variables), para
Production + Preview:
- `VITE_SUPABASE_URL` = `https://sillaiqmxpzijmmfkvtx.supabase.co`
- `VITE_SUPABASE_ANON_KEY` = (copiar de `web/.env.local`)
- `VITE_TOKENS_PER_EUR` = `100`

Vuelve a `vercel --prod` tras añadirlas. Te dará una URL tipo
`https://ptg-apuestas.vercel.app`.

> `vercel.json` ya incluye el rewrite SPA (para que rutas como `/match/..` y los
> magic links no den 404 al recargar).

---

## 2) Decirle a Supabase el dominio público

Para que el login por email funcione en el dominio de Vercel, añade la URL a la
allow-list (cambia `<TU-DOMINIO>`):

```bash
TOKEN=<tu-personal-access-token-supabase>
curl -X PATCH "https://api.supabase.com/v1/projects/sillaiqmxpzijmmfkvtx/config/auth" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "User-Agent: Mozilla/5.0" \
  --data '{"site_url":"https://<TU-DOMINIO>.vercel.app","uri_allow_list":"https://<TU-DOMINIO>.vercel.app,https://<TU-DOMINIO>.vercel.app/*,http://localhost:5173,http://localhost:5173/*"}'
```

(O en el dashboard: **Authentication → URL Configuration**.)

Con esto el magic link funciona en **cualquier dispositivo** (móvil incluido), que
era el problema de `localhost`.

---

## 3) Email fiable + código de 6 dígitos (SMTP propio con Resend, gratis)

El email por defecto de Supabase está muy limitado y no deja personalizar plantilla.
Con un SMTP propio se arregla la entrega **y** se puede usar código en vez de enlace.

1. Crea cuenta en **https://resend.com** → verifica un dominio (o usa el sandbox para
   pruebas) → crea una **API key**.
2. En Supabase: **Project Settings → Authentication → SMTP Settings** → enable custom SMTP:
   - Host `smtp.resend.com`, Port `465`, User `resend`, Password = la API key,
   - Sender = `no-reply@tudominio`.
3. (Opcional pero recomendado) **Authentication → Email Templates → Magic Link**:
   cambia el cuerpo para mostrar el código: `{{ .Token }}` (ya permitido con SMTP propio).

> Si quieres login por **código de 6 dígitos** en la app en vez de enlace: el flujo
> ya está casi (la app usa `signInWithOtp`). Habría que añadir un input de código que
> llame a `supabase.auth.verifyOtp({ email, token, type: 'email' })`. ~30 min.

---

## 4) Onboarding de los colegas
- Les pasas el link de Vercel. Entran con su email → se crea su perfil + monedero solos.
- Para hacer admin/tesorero a alguien (SQL Editor):
  `update profiles set role='admin' where id=(select id from auth.users where email='X');`
- Depósitos: pagan por Bizum al tesorero → **Admin → Depósitos pendientes → Confirmar**.

---

## Pendiente aparte: scraper en vivo
El scraper (`scraper/`) ya lee PTG y escribe en Supabase, pero antes de activarlo en
bucle hay que **afinar qué páginas visita** para traer el roster/resultados completos
(ahora sembré el azul a mano). Ver `scraper/src/ptg.ts` (rutas) y `parse.ts`.
Arrancar: `cd scraper && npm start`.
