// Edge Function: admin-reset-password
// Un ADMIN/tesorero resetea la contraseña de un usuario (que la olvidó). Como no hay
// email de recuperación, el admin pone una contraseña temporal y se la dice; el usuario
// luego la cambia en Perfil. El service-role vive solo aquí (servidor).
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

    // 1) quien llama debe ser admin/tesorero
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: caller } = await admin.auth.getUser(token);
    if (!caller.user) return json({ error: "No autenticado" }, 401);
    const { data: prof } = await admin.from("profiles").select("role").eq("id", caller.user.id).single();
    if (prof?.role !== "admin" && prof?.role !== "treasurer")
      return json({ error: "Solo admin/tesorero puede resetear" }, 403);

    // 2) datos
    const { email, password } = await req.json().catch(() => ({}));
    if (!email || !String(email).includes("@")) return json({ error: "Email inválido" }, 400);
    if (!password || String(password).length < 6) return json({ error: "Contraseña mínima 6 caracteres" }, 400);

    // 3) localizar al usuario por email y resetear su contraseña
    const target = email.trim().toLowerCase();
    let userId: string | undefined;
    for (let page = 1; page <= 20 && !userId; page++) {
      const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      userId = data.users.find((u) => (u.email ?? "").toLowerCase() === target)?.id;
      if ((data.users?.length ?? 0) < 200) break;
    }
    if (!userId) return json({ error: "No existe ningún usuario con ese email" }, 404);

    const { error } = await admin.auth.admin.updateUserById(userId, { password, email_confirm: true });
    if (error) return json({ error: error.message }, 400);

    return json({ ok: true, email: target });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
