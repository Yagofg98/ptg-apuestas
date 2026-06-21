export const config = {
  ptg: {
    baseUrl: process.env.PTG_BASE_URL ?? "https://padelteamgourmet.com",
    feedPath: process.env.PTG_FEED_PATH ?? "/feed",
    // Opcionales: solo para re-login automático cuando la sesión expire (futuro).
    email: process.env.PTG_EMAIL ?? "",
    password: process.env.PTG_PASSWORD ?? "",
  },
  supabase: {
    url: process.env.SUPABASE_URL ?? "",
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  },
  pollIntervalMs: Number(process.env.POLL_INTERVAL_SECONDS ?? 120) * 1000,
  // Duración máxima del bucle antes de salir limpio (para encadenar turnos en CI).
  // 0 = sin límite (bucle infinito, p.ej. en una VM always-on).
  maxRuntimeMs: Number(process.env.MAX_RUNTIME_SECONDS ?? 0) * 1000,
};
