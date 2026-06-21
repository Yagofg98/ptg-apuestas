import { useState } from "react";
import { useLive } from "../hooks/useLive";
import { api } from "../lib/api";
import { Match, Player, SessionUser } from "../lib/types";
import { fmtTokens, teamName, whenLabel } from "../lib/format";

export function Admin({ user, onChange }: { user: SessionUser | null; onChange: () => void }) {
  if (user && user.role !== "admin" && user.role !== "treasurer") {
    return <div className="py-20 text-center text-gray-500">Solo para administradores.</div>;
  }
  return (
    <div className="py-3 space-y-5">
      <h1 className="text-xl font-extrabold px-1">Panel admin</h1>
      <InvitePlayer />
      <Deposits onChange={onChange} />
      <NewMatch />
      <ManageMatches onChange={onChange} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-4 space-y-3">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </div>
  );
}

function InvitePlayer() {
  const [email, setEmail] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function invite() {
    setBusy(true);
    setError(null);
    setLink(null);
    try {
      const l = await api.invitePlayer(email.trim());
      setLink(l);
    } catch (e: any) {
      setError(e.message ?? "Error");
    } finally {
      setBusy(false);
    }
  }

  const waText = `¡Únete a las apuestas de PTG! 🎾 Entra con este enlace (un solo uso): ${link}`;
  const waUrl = `https://wa.me/?text=${encodeURIComponent(waText)}`;

  return (
    <Section title="Invitar jugador (por WhatsApp)">
      <p className="text-xs text-gray-400 -mt-1">
        Genera un enlace de acceso y mándaselo por WhatsApp. No necesita email.
      </p>
      <div className="flex gap-2">
        <input
          type="email"
          placeholder="email del jugador"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="flex-1 bg-ink-900 border border-ink-600 rounded-xl px-3 py-2.5"
        />
        <button disabled={busy || !email.includes("@")} onClick={invite} className="btn-primary py-2 px-4">
          {busy ? "…" : "Generar"}
        </button>
      </div>
      {error && <p className="text-red-400 text-sm">{error}</p>}
      {link && (
        <div className="bg-ink-700/40 rounded-xl p-3 space-y-2">
          <div className="text-xs text-gray-400 break-all">{link}</div>
          <div className="flex gap-2">
            <a href={waUrl} target="_blank" rel="noreferrer" className="btn-primary py-2 px-3 text-sm flex-1 text-center">
              Compartir por WhatsApp
            </a>
            <button
              onClick={() => { navigator.clipboard?.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
              className="bg-ink-600 rounded-xl px-3 text-sm"
            >
              {copied ? "✓" : "Copiar"}
            </button>
          </div>
          <p className="text-[11px] text-gray-500">Válido 1 hora, un solo uso. El jugador lo abre y entra.</p>
        </div>
      )}
    </Section>
  );
}

function Deposits({ onChange }: { onChange: () => void }) {
  const { data: deps, reload } = useLive(() => api.listPendingDeposits(), []);
  async function confirm(id: string) {
    await api.confirmDeposit(id);
    reload();
    onChange();
  }
  return (
    <Section title="Depósitos pendientes">
      {(deps ?? []).length === 0 && <p className="text-sm text-gray-500">No hay depósitos pendientes.</p>}
      {(deps ?? []).map((d) => (
        <div key={d.id} className="flex items-center justify-between bg-ink-700/40 rounded-xl px-3 py-2">
          <div>
            <div className="font-semibold text-sm">{d.userName}</div>
            <div className="text-xs text-gray-400">{d.amountEur}€ → {fmtTokens(d.tokens)} tk</div>
          </div>
          <button onClick={() => confirm(d.id)} className="btn-primary py-2 px-3 text-sm">Confirmar</button>
        </div>
      ))}
    </Section>
  );
}

function NewMatch() {
  const { data: players } = useLive(() => api.listPlayers(), []);
  const [sel, setSel] = useState<string[]>(["", "", "", ""]);
  const [when, setWhen] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const labels = ["Pareja A · jugador 1", "Pareja A · jugador 2", "Pareja B · jugador 1", "Pareja B · jugador 2"];
  const dupes = new Set(sel.filter(Boolean)).size !== sel.filter(Boolean).length;
  const ready = sel.every(Boolean) && !dupes;

  async function create() {
    setBusy(true);
    setMsg(null);
    try {
      await api.openMatch({
        scheduledAt: when ? new Date(when).toISOString() : new Date(Date.now() + 3600_000).toISOString(),
        teamAp1: sel[0], teamAp2: sel[1], teamBp1: sel[2], teamBp2: sel[3],
      });
      setMsg("✓ Partido creado y abierto a apuestas.");
      setSel(["", "", "", ""]);
    } catch (e: any) {
      setMsg(e.message ?? "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Crear partido">
      {labels.map((lab, i) => (
        <div key={i}>
          <label className="text-xs text-gray-400">{lab}</label>
          <select
            value={sel[i]}
            onChange={(e) => setSel((s) => s.map((v, j) => (j === i ? e.target.value : v)))}
            className="w-full bg-ink-900 border border-ink-600 rounded-xl px-3 py-2.5 mt-1"
          >
            <option value="">— elegir —</option>
            {(players ?? []).map((p: Player) => (
              <option key={p.id} value={p.id}>
                {p.name} (#{p.currentRanking})
              </option>
            ))}
          </select>
        </div>
      ))}
      <div>
        <label className="text-xs text-gray-400">Fecha/hora (opcional)</label>
        <input
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          className="w-full bg-ink-900 border border-ink-600 rounded-xl px-3 py-2.5 mt-1"
        />
      </div>
      {dupes && <p className="text-amber-400 text-sm">No repitas jugadores.</p>}
      {msg && <p className="text-padel-400 text-sm">{msg}</p>}
      <button disabled={!ready || busy} onClick={create} className="btn-primary w-full">
        {busy ? "Creando…" : "Crear partido"}
      </button>
    </Section>
  );
}

function ManageMatches({ onChange }: { onChange: () => void }) {
  const { data: matches, reload } = useLive(() => api.listMatches(), []);
  return (
    <Section title="Partidos abiertos">
      {(matches ?? []).length === 0 && <p className="text-sm text-gray-500">No hay partidos.</p>}
      {(matches ?? []).map((m) => (
        <MatchAdminRow key={m.id} match={m} reload={() => { reload(); onChange(); }} />
      ))}
    </Section>
  );
}

function MatchAdminRow({ match, reload }: { match: Match; reload: () => void }) {
  const [settling, setSettling] = useState(false);
  const [winner, setWinner] = useState<"A" | "B">("A");
  const [bagel, setBagel] = useState(false);
  const [three, setThree] = useState(false);

  async function lock() {
    await api.setMatchStatus(match.id, match.status === "open" ? "locked" : "open");
    reload();
  }
  async function settle() {
    await api.settleMatch(match.id, {
      winner, hadBagel: bagel, threeSets: three,
      setScores: three ? [[6, 4], [3, 6], [6, 3]] : [[6, 4], [6, 3]],
    });
    setSettling(false);
    reload();
  }

  return (
    <div className="bg-ink-700/40 rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-sm">
          <div className="font-semibold">{teamName(match.teamA)} vs {teamName(match.teamB)}</div>
          <div className="text-xs text-gray-400">{whenLabel(match.scheduledAt)} · {match.status}</div>
        </div>
        <button onClick={lock} className="text-xs bg-ink-600 rounded-lg px-2 py-1">
          {match.status === "open" ? "🔒 Bloquear" : "🔓 Abrir"}
        </button>
      </div>

      {!settling ? (
        <button onClick={() => setSettling(true)} className="text-sm text-padel-400">Liquidar resultado →</button>
      ) : (
        <div className="space-y-2 pt-1 border-t border-ink-600">
          <div className="flex gap-2 text-sm">
            <SegBtn active={winner === "A"} onClick={() => setWinner("A")}>Gana A</SegBtn>
            <SegBtn active={winner === "B"} onClick={() => setWinner("B")}>Gana B</SegBtn>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={bagel} onChange={(e) => setBagel(e.target.checked)} /> Hubo un 6/0
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={three} onChange={(e) => setThree(e.target.checked)} /> Fue a 3 sets
          </label>
          <div className="flex gap-2">
            <button onClick={settle} className="btn-primary py-2 text-sm flex-1">Confirmar y pagar</button>
            <button onClick={() => setSettling(false)} className="text-sm text-gray-400 px-3">Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}

function SegBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`flex-1 rounded-lg py-1.5 ${active ? "bg-padel-600 text-white" : "bg-ink-600 text-gray-300"}`}>
      {children}
    </button>
  );
}
