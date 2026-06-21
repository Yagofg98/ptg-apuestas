import { createClient, SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** true si hay credenciales → usamos backend real; si no, MODO DEMO en memoria. */
export const HAS_SUPABASE = Boolean(url && anon);

export const supabase: SupabaseClient | null = HAS_SUPABASE
  ? createClient(url!, anon!)
  : null;

export const TOKENS_PER_EUR = Number(import.meta.env.VITE_TOKENS_PER_EUR ?? 100);
