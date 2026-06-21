import { useParams, Link } from "react-router-dom";
import { useLive } from "../hooks/useLive";
import { api } from "../lib/api";
import { Market, Match } from "../lib/types";
import { teamName, whenLabel } from "../lib/format";
import { OddsButton } from "../components/OddsButton";
import { useBetSlip } from "../hooks/useBetSlip";

export function MatchDetail() {
  const { id } = useParams();
  const { data: match, loading } = useLive(() => api.getMatch(id!), [id]);

  if (loading) return <div className="py-20 text-center text-gray-500 animate-pulse">Cargando…</div>;
  if (!match) return <div className="py-20 text-center text-gray-500">Partido no encontrado.</div>;

  const matchLabel = `${teamName(match.teamA)} vs ${teamName(match.teamB)}`;

  return (
    <div className="py-3 space-y-4">
      <Link to="/" className="text-sm text-gray-400">‹ Volver</Link>

      <div className="card p-4">
        <div className="text-xs text-gray-400 mb-2">{whenLabel(match.scheduledAt)}</div>
        <Pairing label="Pareja A" match={match} team="A" />
        <div className="text-center text-xs text-gray-500 my-1">VS</div>
        <Pairing label="Pareja B" match={match} team="B" />
      </div>

      {match.markets.map((mk) => (
        <MarketBlock key={mk.id} market={mk} matchLabel={matchLabel} />
      ))}

      <p className="text-[11px] text-gray-500 px-1 leading-relaxed">
        Cada mercado es un <b>bote</b>: el dinero se reparte entre los acertantes (no hay
        casa, el dinero cuadra). La cuota es <b>estimada</b> — ponderada por{" "}
        <span className="text-gray-300">ranking actual</span> (liga de 6 meses) y{" "}
        <span className="text-padel-400">ranking histórico</span>, y se ajusta con el dinero
        apostado. Puedes combinar mercados <b>del mismo partido</b> en el boleto.
      </p>
    </div>
  );
}

function Pairing({ label, match, team }: { label: string; match: Match; team: "A" | "B" }) {
  const players = team === "A" ? match.teamA : match.teamB;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  return (
    <div>
      <div className="text-[11px] text-gray-500 mb-1">{label}</div>
      {players.map((p) => (
        <div key={p.id} className="flex items-baseline justify-between gap-3 mb-0.5">
          <span className="font-bold truncate">{p.name}</span>
          <span className="text-[11px] text-gray-400 whitespace-nowrap tabular-nums">
            <span className="text-gray-300">act {pct(p.currentWinPct)}</span>
            {" · "}
            <span className="text-padel-400">hist {pct(p.historicWinPct)}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function MarketBlock({ market, matchLabel }: { market: Market; matchLabel: string }) {
  const { has, toggle } = useBetSlip();
  return (
    <div className="card p-4">
      <h3 className="font-semibold mb-3">{market.title}</h3>
      <div className="flex gap-2">
        {market.outcomes.map((o) => (
          <OddsButton
            key={o.id}
            label={o.label}
            odds={o.currentOdds}
            active={has(o.id)}
            onClick={() =>
              toggle({
                outcomeId: o.id,
                marketId: market.id,
                matchId: market.matchId,
                matchLabel,
                marketTitle: market.title,
                outcomeLabel: o.label,
                odds: o.currentOdds,
              })
            }
          />
        ))}
      </div>
    </div>
  );
}
