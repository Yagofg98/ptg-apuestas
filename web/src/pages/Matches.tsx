import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { useLive } from "../hooks/useLive";
import { api } from "../lib/api";
import { Match } from "../lib/types";
import { fmtOdds, teamName, whenLabel } from "../lib/format";

export function Matches() {
  const { data: matches, loading } = useLive(() => api.listMatches(), []);

  if (loading) return <ListSkeleton />;
  if (!matches || matches.length === 0)
    return <Empty text="No hay partidos abiertos ahora mismo." />;

  return (
    <div className="py-3 space-y-3">
      <h1 className="text-xl font-extrabold px-1">Próximos partidos</h1>
      {matches.map((m, i) => (
        <motion.div
          key={m.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.05 }}
        >
          <MatchCard match={m} />
        </motion.div>
      ))}
    </div>
  );
}

function MatchCard({ match }: { match: Match }) {
  const winner = match.markets.find((mk) => mk.type === "winner");
  return (
    <Link to={`/match/${match.id}`} className="block card p-4 active:scale-[0.99] transition">
      <div className="flex items-center justify-between text-xs text-gray-400 mb-2">
        <span>{whenLabel(match.scheduledAt)}</span>
        <span className="bg-padel-600/20 text-padel-400 px-2 py-0.5 rounded-full">Abierto</span>
      </div>

      <div className="space-y-1.5">
        <TeamRow names={teamName(match.teamA)} odds={winner?.outcomes[0]?.currentOdds} />
        <div className="text-center text-[11px] text-gray-500 font-medium">VS</div>
        <TeamRow names={teamName(match.teamB)} odds={winner?.outcomes[1]?.currentOdds} />
      </div>

      <div className="mt-3 flex gap-2 text-[11px] text-gray-400">
        <span className="bg-ink-700/60 rounded-full px-2 py-1">Ganador</span>
        <span className="bg-ink-700/60 rounded-full px-2 py-1">6/0</span>
        <span className="bg-ink-700/60 rounded-full px-2 py-1">2 o 3 sets</span>
      </div>
    </Link>
  );
}

function TeamRow({ names, odds }: { names: string; odds?: number }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="font-semibold truncate">{names}</span>
      {odds != null && (
        <span className="shrink-0 bg-ink-700 rounded-lg px-2.5 py-1 font-bold tabular-nums text-sm">
          {fmtOdds(odds)}
        </span>
      )}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="py-3 space-y-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="card p-4 h-28 animate-pulse bg-ink-800/60" />
      ))}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="py-20 text-center text-gray-500">{text}</div>;
}
