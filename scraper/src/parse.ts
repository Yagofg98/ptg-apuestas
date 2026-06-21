/**
 * Parser de los datos reales de PTG (Bubble.io + Elasticsearch).
 *
 * PTG carga datos vía POST a /elasticsearch/msearch (búsquedas) y /elasticsearch/mget
 * (por id). Las respuestas traen documentos Bubble con `_type`:
 *   - custom.usuario_ranking  → ranking + % victorias (actual e histórico) de cada jugador
 *   - user                    → nombre / apodo del jugador
 *   - custom.partidos         → partidos (parejas drive/revés + marcador por sets)
 *
 * Este módulo es PURO: recibe una lista de documentos `_source` y devuelve jugadores
 * y partidos normalizados. Así se testea contra los fixtures reales capturados.
 */

// ----------------------------------------------------------------------------
// Tipos normalizados
// ----------------------------------------------------------------------------
export interface PtgPlayer {
  rankingId: string; // _id del custom.usuario_ranking
  userId?: string; // _id del user (si se pudo resolver)
  email: string;
  name: string;
  group?: string; // azul / blanco / ...
  city?: string;
  currentRatio: number; // ratio_act_number  (métrica de ranking actual)
  historicRatio: number; // ratio_h_number    (ranking histórico)
  currentWinPct: number; // __victorias_act_number  [0,1]
  historicWinPct: number; // __victorias_h_number    [0,1]
  matchesCurrent: number; // pjnum_act_number
  matchesHistoric: number; // pjnum_h_number
}

export interface PtgResult {
  winnerRankingIds: string[]; // 2 ranking ids (pareja ganadora)
  loserRankingIds: string[]; // 2 ranking ids (pareja perdedora)
  setScores: number[][]; // [[ganador, perdedor], ...] por set
  setsPlayed: number;
  wentTo3Sets: boolean;
  hadBagel: boolean; // algún 6/0
}

export interface PtgMatch {
  id: string;
  date: number | null; // epoch ms
  group?: string;
  season?: string;
  city?: string;
  finished: boolean;
  cancelled: boolean;
  playerRankingIds: string[]; // jugadores implicados (ranking ids)
  result?: PtgResult;
}

type Doc = Record<string, any>;

// ----------------------------------------------------------------------------
// Utilidades Bubble
// ----------------------------------------------------------------------------

/** "..._LOOKUP__1680167638183x342..." → "1680167638183x342..." */
export function lookupId(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const i = v.indexOf("__LOOKUP__");
  return i >= 0 ? v.slice(i + "__LOOKUP__".length) : v;
}

function lookupList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(lookupId).filter((x): x is string => !!x);
}

/** Aplana respuestas de msearch (hits) y mget (docs) a una lista de `_source`. */
export function collectDocs(payloads: any[]): Doc[] {
  const out: Doc[] = [];
  for (const d of payloads) {
    if (!d || typeof d !== "object") continue;
    for (const r of d.responses ?? []) {
      for (const h of r?.hits?.hits ?? []) if (h?._source) out.push(h._source);
    }
    for (const doc of d.docs ?? []) if (doc?._source) out.push(doc._source);
  }
  return out;
}

// ----------------------------------------------------------------------------
// Mapa de nombres (user)
// ----------------------------------------------------------------------------
function buildNameMaps(docs: Doc[]) {
  const byUserId = new Map<string, string>();
  const byEmail = new Map<string, string>();
  for (const s of docs) {
    if (s._type !== "user") continue;
    const name =
      s.nombre___apellidos_text ||
      [s.nombre_text, s.apellido_text].filter(Boolean).join(" ") ||
      s.apodo_text;
    if (!name) continue;
    if (s._id) byUserId.set(s._id, name);
    const email = s.authentication?.email?.email;
    if (email) byEmail.set(email.toLowerCase(), name);
  }
  return { byUserId, byEmail };
}

// ----------------------------------------------------------------------------
// Jugadores
// ----------------------------------------------------------------------------
export function parsePlayers(docs: Doc[]): PtgPlayer[] {
  const { byUserId, byEmail } = buildNameMaps(docs);
  const players = new Map<string, PtgPlayer>();

  for (const s of docs) {
    if (s._type !== "custom.usuario_ranking") continue;
    if (!s._id) continue;
    const userId = lookupId(s.usuario_user);
    const email = (s.email_text ?? "").toLowerCase();
    const name =
      (userId && byUserId.get(userId)) ||
      byEmail.get(email) ||
      (email ? email.split("@")[0] : "Jugador");

    // nos quedamos con la versión más completa si aparece duplicado
    const prev = players.get(s._id);
    const player: PtgPlayer = {
      rankingId: s._id,
      userId,
      email,
      name,
      group: s.grupo_option_grupos,
      city: s.ciudad_option_ciudad,
      currentRatio: num(s.ratio_act_number, prev?.currentRatio ?? 0),
      historicRatio: num(s.ratio_h_number, prev?.historicRatio ?? 0),
      currentWinPct: clamp01(num(s.__victorias_act_number, prev?.currentWinPct ?? 0.5)),
      historicWinPct: clamp01(num(s.__victorias_h_number, prev?.historicWinPct ?? 0.5)),
      matchesCurrent: num(s.pjnum_act_number, prev?.matchesCurrent ?? 0),
      matchesHistoric: num(s.pjnum_h_number, prev?.matchesHistoric ?? 0),
    };
    players.set(s._id, player);
  }
  return [...players.values()];
}

// ----------------------------------------------------------------------------
// Partidos
// ----------------------------------------------------------------------------
export function parseMatches(docs: Doc[]): PtgMatch[] {
  const matches = new Map<string, PtgMatch>();

  for (const s of docs) {
    if (s._type !== "custom.partidos") continue;
    if (!s._id) continue;

    const finished = s.acabado_boolean === true;
    const winnerIds = [
      lookupId(s.ganadordrive_custom_usuario_ranking),
      lookupId(s.ganadorreves1_custom_usuario_ranking),
    ].filter((x): x is string => !!x);
    const loserIds = [
      lookupId(s.perdedordrive_custom_usuario_ranking),
      lookupId(s.perdedorreves_custom_usuario_ranking),
    ].filter((x): x is string => !!x);

    let result: PtgResult | undefined;
    if (finished && winnerIds.length === 2 && loserIds.length === 2) {
      const sets: number[][] = [];
      const pairs: [any, any][] = [
        [s.ganador_1er_set1_number, s.perdedor_1er_set_number],
        [s.ganador_2o_set1_number, s.perdedor_2o_set_number],
        [s.ganador_3er_set1_number, s.perdedor_3er_set_number],
      ];
      for (const [g, p] of pairs) {
        if (g == null && p == null) continue;
        sets.push([num(g, 0), num(p, 0)]);
      }
      const setsPlayed = num(s.sets_jugados_number, sets.length);
      const hadBagel = sets.some(([g, p]) => g === 0 || p === 0);
      result = {
        winnerRankingIds: winnerIds,
        loserRankingIds: loserIds,
        setScores: sets,
        setsPlayed,
        wentTo3Sets: setsPlayed >= 3,
        hadBagel,
      };
    }

    // jugadores implicados: lista explícita o, si no, ganadores+perdedores
    const playerRankingIds =
      lookupList(s.jugadores_r_list_custom_usuario_ranking).length > 0
        ? lookupList(s.jugadores_r_list_custom_usuario_ranking)
        : [...winnerIds, ...loserIds];

    const prev = matches.get(s._id);
    const match: PtgMatch = {
      id: s._id,
      date: s.fecha_partido_date ?? prev?.date ?? null,
      group: s.grupo_option_grupos ?? prev?.group,
      season: s.temporada_option_temporadas ?? prev?.season,
      city: s.ciudad_option_ciudad ?? prev?.city,
      finished,
      cancelled: s.cancelado_boolean === true,
      playerRankingIds: playerRankingIds.length ? playerRankingIds : prev?.playerRankingIds ?? [],
      result: result ?? prev?.result,
    };
    matches.set(s._id, match);
  }
  return [...matches.values()];
}

// ----------------------------------------------------------------------------
// Helpers numéricos
// ----------------------------------------------------------------------------
function num(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * DESCUBRIMIENTO: devuelve los `custom.partidos` NO terminados con campos poblados.
 * PTG publica las parejas ~2h antes del partido, con nombres de campo que aún no
 * conocemos (los terminados usan ganador/perdedor, etiquetas de resultado). Cuando
 * aparezca el primer partido próximo con parejas, el scraper volcará estos campos
 * para mapear el mercado "pareja ganadora" pre-partido.
 */
export function rawUpcomingMatches(docs: Doc[]): Doc[] {
  const out = new Map<string, Doc>();
  for (const s of docs) {
    if (s._type !== "custom.partidos") continue;
    if (s.acabado_boolean === true || s.cancelado_boolean === true) continue;
    if (Object.keys(s).length <= 6) continue; // ignorar registros casi vacíos
    const prev = out.get(s._id);
    if (!prev || Object.keys(s).length > Object.keys(prev).length) out.set(s._id, s);
  }
  return [...out.values()];
}

/**
 * Deriva la posición de ranking (1 = mejor) ordenando por ratio dentro del grupo.
 * El motor de cuotas (odds.ts) usa posición + % victorias.
 */
export function assignRankingPositions(players: PtgPlayer[]): Map<string, { current: number; historic: number }> {
  const byCurrent = [...players].sort((a, b) => b.currentRatio - a.currentRatio);
  const byHistoric = [...players].sort((a, b) => b.historicRatio - a.historicRatio);
  const pos = new Map<string, { current: number; historic: number }>();
  byCurrent.forEach((p, i) => pos.set(p.rankingId, { current: i + 1, historic: 999 }));
  byHistoric.forEach((p, i) => {
    const e = pos.get(p.rankingId)!;
    e.historic = i + 1;
  });
  return pos;
}
