import { createClient } from "@supabase/supabase-js";
import { config } from "./config.ts";
import {
  collectDocs,
  parsePlayers,
  parseMatches,
  parseUpcoming,
  type PtgMatch,
} from "./parse.ts";

// Grupo PTG que auto-importamos como próximos partidos a configurar.
const AUTO_IMPORT_GROUP = process.env.PTG_AUTO_GROUP ?? "azul";

const db = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
  auth: { persistSession: false },
});

/**
 * Sincroniza jugadores PTG → Supabase. Usamos el `rankingId` (custom.usuario_ranking)
 * como `ptg_player_id`. SOLO actualiza nombre + % de victorias de los jugadores que
 * vea en esta pasada; NO toca las POSICIONES de ranking, porque PTG (Bubble SPA) no
 * deja leer el grupo completo por URL y recalcular posiciones con datos parciales las
 * corrompería. Las posiciones se mantienen del seed (recalcular = tarea aparte con el
 * grupo completo). Jugadores nuevos entran con ranking 999 hasta una recálculo manual.
 */
async function syncPlayers(docs: any[]) {
  const players = parsePlayers(docs);
  if (players.length === 0) return { count: 0 };

  const rows = players.map((p) => ({
    ptg_player_id: p.rankingId,
    name: p.name,
    current_win_pct: round4(p.currentWinPct),
    historic_win_pct: round4(p.historicWinPct),
    updated_at: new Date().toISOString(),
  }));

  // upsert: en filas existentes solo cambia las columnas presentes (no las posiciones)
  const { error } = await db.from("players").upsert(rows, { onConflict: "ptg_player_id" });
  if (error) throw error;
  return { count: rows.length };
}

/**
 * Liquida en Supabase los partidos PTG que ya tengan resultado y que existan en
 * nuestra BD (creados por admin o por una futura sincronización de próximos).
 * El lado ganador (A/B) se deduce comparando los ganadores PTG con las parejas
 * almacenadas en el partido.
 */
async function settleFinished(docs: any[]) {
  const matches = parseMatches(docs).filter((m) => m.result);
  let settled = 0;

  for (const m of matches) {
    const { data: row } = await db
      .from("matches")
      .select(
        `id, status,
         a1:team_a_p1(ptg_player_id), a2:team_a_p2(ptg_player_id),
         b1:team_b_p1(ptg_player_id), b2:team_b_p2(ptg_player_id)`,
      )
      .eq("ptg_match_id", m.id)
      .maybeSingle();
    if (!row || row.status === "settled") continue;

    const winner = decideWinnerSide(m, row);
    if (!winner) continue; // no podemos mapear las parejas con seguridad

    const { error } = await db.rpc("settle_match", {
      p_match_id: row.id,
      p_winner: winner,
      p_had_bagel: m.result!.hadBagel,
      p_three_sets: m.result!.wentTo3Sets,
      p_set_scores: m.result!.setScores,
    });
    if (error) console.error(`! liquidando ${m.id}:`, error.message);
    else settled++;
  }
  return { settled };
}

function decideWinnerSide(m: PtgMatch, row: any): "A" | "B" | null {
  const teamA = [row.a1?.ptg_player_id, row.a2?.ptg_player_id].filter(Boolean);
  const teamB = [row.b1?.ptg_player_id, row.b2?.ptg_player_id].filter(Boolean);
  const winners = m.result!.winnerRankingIds;
  const inA = winners.filter((w) => teamA.includes(w)).length;
  const inB = winners.filter((w) => teamB.includes(w)).length;
  if (inA === 2) return "A";
  if (inB === 2) return "B";
  return null;
}

/**
 * Auto-importa los próximos partidos del grupo configurado (azul) como partidos
 * 'pending' en Supabase: solo fecha + grupo, SIN parejas (PTG no las publica hasta
 * que el partido acaba). En la app alguien asigna las 2 parejas y se abren a apuestas.
 * Sólo crea filas nuevas; NO toca partidos ya configurados/abiertos.
 */
async function syncUpcoming(docs: any[]) {
  const up = parseUpcoming(docs).filter(
    (m) => (m.group ?? "").toLowerCase() === AUTO_IMPORT_GROUP,
  );
  let created = 0;

  for (const m of up) {
    const { data: existing } = await db
      .from("matches")
      .select("id, status")
      .eq("ptg_match_id", m.ptgId)
      .maybeSingle();

    if (existing && existing.status !== "pending") continue; // ya configurado → no tocar

    if (existing) {
      // actualizar fecha + roster (los apuntados van creciendo en PTG)
      const { error } = await db
        .from("matches")
        .update({
          scheduled_at: new Date(m.dateMs).toISOString(),
          ptg_player_ids: m.playerRankingIds,
        })
        .eq("id", existing.id);
      if (error) console.error(`! actualizando próximo ${m.ptgId}:`, error.message);
    } else {
      const { error } = await db.from("matches").insert({
        ptg_match_id: m.ptgId,
        scheduled_at: new Date(m.dateMs).toISOString(),
        status: "pending",
        grupo: m.group ?? AUTO_IMPORT_GROUP,
        origin: "ptg",
        ptg_player_ids: m.playerRankingIds,
      });
      if (error) console.error(`! importando próximo ${m.ptgId}:`, error.message);
      else created++;
    }
  }
  return { upcoming: up.length, created };
}

export async function syncFromDocs(payloads: any[]) {
  const docs = collectDocs(payloads);
  const p = await syncPlayers(docs);
  const s = await settleFinished(docs);
  const u = await syncUpcoming(docs);
  // Cierre quincenal idempotente: la RPC solo actúa si han pasado ≥15 días y no hay
  // apuestas pendientes; si no, es un no-op. No debe tumbar el sync si falla.
  try {
    await db.rpc("close_due_period");
  } catch (e) {
    console.error("! close_due_period:", (e as Error).message);
  }
  return { docs: docs.length, ...p, ...s, ...u };
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}
