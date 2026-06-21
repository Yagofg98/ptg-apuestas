import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useBetSlip } from "../hooks/useBetSlip";
import { api } from "../lib/api";
import { fmtOdds, fmtTokens } from "../lib/format";

/** Boleto de apuesta (combinada) que sube desde abajo cuando hay selecciones. */
export function BetSlip({ balance, onPlaced }: { balance: number; onPlaced: () => void }) {
  const { legs, combinedOdds, remove, clear } = useBetSlip();
  const [open, setOpen] = useState(false);
  const [stake, setStake] = useState(50);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const payout = Number((stake * combinedOdds).toFixed(2));
  const isCombo = legs.length > 1;

  async function place() {
    setBusy(true);
    setError(null);
    try {
      await api.placeBet(
        legs.map((l) => ({ outcomeId: l.outcomeId, odds: l.odds, label: `${l.outcomeLabel} (${l.matchLabel})` })),
        stake,
      );
      clear();
      setOpen(false);
      onPlaced();
    } catch (e: any) {
      setError(e.message ?? "Error al apostar");
    } finally {
      setBusy(false);
    }
  }

  if (legs.length === 0) return null;

  return (
    <>
      {/* Barra flotante */}
      <div className="fixed bottom-[68px] inset-x-0 z-30 px-3">
        <button
          onClick={() => setOpen(true)}
          className="w-full card bg-padel-600 border-padel-500 px-4 py-3 flex items-center justify-between shadow-2xl"
        >
          <span className="flex items-center gap-2 font-semibold">
            <span className="bg-white text-padel-700 rounded-full w-6 h-6 grid place-items-center text-sm">
              {legs.length}
            </span>
            {isCombo ? "Combinada" : "Apuesta"}
          </span>
          <span className="font-bold tabular-nums">{fmtOdds(combinedOdds)}</span>
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              className="fixed inset-0 bg-black/60 z-40"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
            />
            <motion.div
              className="fixed bottom-0 inset-x-0 z-50 card rounded-b-none p-4 pb-6 max-h-[80vh] overflow-y-auto"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 280 }}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-lg">{isCombo ? "Combinada" : "Tu apuesta"}</h3>
                <button onClick={clear} className="text-sm text-gray-400">Vaciar</button>
              </div>

              <div className="space-y-2 mb-4">
                {legs.map((l) => (
                  <div key={l.outcomeId} className="flex items-center justify-between bg-ink-700/40 rounded-xl px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate">{l.outcomeLabel}</div>
                      <div className="text-xs text-gray-400 truncate">
                        {l.marketTitle} · {l.matchLabel}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 pl-2">
                      <span className="font-bold tabular-nums">{fmtOdds(l.odds)}</span>
                      <button onClick={() => remove(l.outcomeId)} className="text-gray-500 text-lg leading-none">×</button>
                    </div>
                  </div>
                ))}
              </div>

              <label className="text-sm text-gray-400">Importe (tokens)</label>
              <div className="flex gap-2 mt-1 mb-2">
                <input
                  type="number"
                  min={1}
                  value={stake}
                  onChange={(e) => setStake(Math.max(0, Number(e.target.value)))}
                  className="flex-1 bg-ink-900 border border-ink-600 rounded-xl px-3 py-3 text-lg font-semibold tabular-nums"
                />
                {[25, 50, 100].map((v) => (
                  <button key={v} onClick={() => setStake(v)} className="px-3 rounded-xl bg-ink-700 text-sm font-medium">
                    {v}
                  </button>
                ))}
              </div>

              <div className="flex justify-between text-sm text-gray-300 mb-1">
                <span>Cuota estimada</span>
                <span className="font-bold tabular-nums">{fmtOdds(combinedOdds)}</span>
              </div>
              <div className="flex justify-between text-base mb-1">
                <span>Ganancia estimada</span>
                <span className="font-extrabold text-padel-400 tabular-nums">{fmtTokens(payout)}</span>
              </div>
              <p className="text-[11px] text-gray-500 mb-3">
                Cuota orientativa: el pago final sale del <b>bote</b> repartido entre acertantes.
                {isCombo && " Combinada del mismo partido."}
              </p>

              {error && <p className="text-red-400 text-sm mb-2">{error}</p>}
              {stake > balance && <p className="text-amber-400 text-sm mb-2">Saldo insuficiente ({fmtTokens(balance)} tokens)</p>}

              <button
                disabled={busy || stake <= 0 || stake > balance}
                onClick={place}
                className="btn-primary w-full text-lg"
              >
                {busy ? "Apostando…" : `Apostar ${fmtTokens(stake)} tokens`}
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
