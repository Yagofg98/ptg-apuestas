// Edge Function: invite
// Un ADMIN llama a esta función con el email de un amigo. Crea el usuario (si no
// existe) y genera un MAGIC LINK de acceso que el admin comparte por WhatsApp.
// El service-role vive solo aquí (servidor), nunca en la app.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, service, { auth: { persistSession: false } });

    // 1) verificar que quien llama es admin/tesorero
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: caller } = await admin.auth.getUser(token);
    if (!caller.user) return json({ error: "No autenticado" }, 401);
    const { data: prof } = await admin
      .from("profiles").select("role").eq("id", caller.user.id).single();
    if (prof?.role !== "admin" && prof?.role !== "treasurer")
      return json({ error: "Solo admin/tesorero puede invitar" }, 403);

    // 2) email del invitado
    const { email, name } = await req.json().catch(() => ({}));
    if (!email || !String(email).includes("@")) return json({ error: "Email inválido" }, 400);

    // 3) crear usuario si no existe (el trigger crea perfil + monedero)
    await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: name ? { name } : undefined,
    }).catch(() => {/* ya existe → seguimos */});

    // 4) generar magic link hacia el dominio público
    const redirectTo = Deno.env.get("PUBLIC_SITE_URL") ?? url;
    const { data: link, error } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo },
    });
    if (error) return json({ error: error.message }, 400);

    return json({ link: link.properties?.action_link, email });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
