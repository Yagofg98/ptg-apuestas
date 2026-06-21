import { useState } from "react";
import { useLive } from "../hooks/useLive";
import { api, TOKENS_PER_EUR, DEMO_MODE } from "../lib/api";
import { fmtOdds, fmtTokens } from "../lib/format";

export function Wallet({ onChange }: { onChange: () => void }) {
  const { data: balance } = useLive(() => api.getBalance(), []);
  const { data: bets } = useLive(() => api.getBets(), []);
  const { data: txs, reload: reloadTxs } = useLive(() => api.getTransactions(), []);
  const [tab, setTab] = useState<"bets" | "movs">("bets");
  const [eur, setEur] = useState(20);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function deposit() {
    setBusy(true);
    try {
      await api.requestDeposit(eur);
      setMsg(DEMO_MODE ? "Depósito demo acreditado." : "Solicitud enviada. El tesorero la confirmará al recibir el Bizum.");
      onChange();
      reloadTxs();
    } catch (e: any) {
      setMsg(e.message ?? "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="py-3 space-y-4">
      <div className="card p-5 text-center bg-gradient-to-br from-padel-700 to-ink-800 border-padel-600/40">
        <div className="text-xs text-padel-50/70 uppercase tracking-wide">Saldo</div>
        <div className="text-4xl font-extrabold tabular-nums mt-1">{fmtTokens(balance ?? 0)}</div>
        <div className="text-xs text-padel-50/70 mt-1">tokens · {TOKENS_PER_EUR} tk = 1€</div>
      </div>

      <div className="card p-4">
        <h3 className="font-semibold mb-2">Ingresar saldo</h3>
        <div className="flex gap-2 items-center">
          <div className="flex-1 flex items-center bg-ink-900 border border-ink-600 rounded-xl px-3">
            <input
              type="number"
              min={1}
              value={eur}
              onChange={(e) => setEur(Math.max(0, Number(e.target.value)))}
              className="flex-1 bg-transparent py-3 text-lg font-semibold tabular-nums outline-none"
            />
            <span className="text-gray-400">€</span>
          </div>
          <button disabled={busy || eur <= 0} onClick={deposit} className="btn-primary">
            {busy ? "…" : `+${fmtTokens(eur * TOKENS_PER_EUR)} tk`}
          </button>
        </div>
        {msg && <p className="text-xs text-padel-400 mt-2">{msg}</p>}
        {!DEMO_MODE && (
          <p className="text-[11px] text-gray-500 mt-2">
            Paga por Bizum al tesorero y se te acreditarán los tokens al confirmar.
          </p>
        )}
      </div>

      <div className="flex gap-2">
        <TabBtn active={tab === "bets"} onClick={() => setTab("bets")}>Mis apuestas</TabBtn>
        <TabBtn active={tab === "movs"} onClick={() => setTab("movs")}>Movimientos</TabBtn>
      </div>

      {tab === "bets" ? (
        <div className="space-y-2">
          {(bets ?? []).length === 0 && <p className="text-gray-500 text-sm py-6 text-center">Aún no has apostado.</p>}
          {(bets ?? []).map((b) => (
            <div key={b.id} className="card p-3">
              <div className="flex justify-between items-center mb-1">
                <span className="text-sm font-semibold">
                  {b.isCombo ? `Combinada (${b.legs.length})` : "Simple"} · {fmtOdds(b.combinedOdds)}
                </span>
                <StatusPill status={b.status} />
              </div>
              {b.legs.map((l, i) => (
                <div key={i} className="text-xs text-gray-400 flex justify-between">
                  <span className="truncate pr-2">{l.label}</span>
                  <span className="tabular-nums">{fmtOdds(l.odds)}</span>
                </div>
              ))}
              <div className="flex justify-between text-sm mt-2 pt-2 border-t border-ink-700">
                <span className="text-gray-400">Apostado {fmtTokens(b.stake)}</span>
                <span className="font-bold text-padel-400">→ {fmtTokens(b.potentialPayout)}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card divide-y divide-ink-700">
          {(txs ?? []).map((t) => (
            <div key={t.id} className="flex justify-between items-center px-4 py-2.5 text-sm">
              <span className="text-gray-300">{t.note || t.type}</span>
              <span className={`font-bold tabular-nums ${t.amount >= 0 ? "text-padel-400" : "text-red-400"}`}>
                {t.amount >= 0 ? "+" : ""}
                {fmtTokens(t.amount)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded-xl py-2 text-sm font-medium ${active ? "bg-padel-600 text-white" : "bg-ink-700/50 text-gray-400"}`}
    >
      {children}
    </button>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "bg-amber-500/20 text-amber-300",
    won: "bg-padel-600/30 text-padel-400",
    lost: "bg-red-500/20 text-red-300",
    void: "bg-ink-600 text-gray-400",
  };
  const label: Record<string, string> = { pending: "En juego", won: "Ganada", lost: "Perdida", void: "Anulada" };
  return <span className={`text-[11px] px-2 py-0.5 rounded-full ${map[status]}`}>{label[status] ?? status}</span>;
}
