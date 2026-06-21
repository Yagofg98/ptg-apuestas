import { useLive } from "../hooks/useLive";
import { api } from "../lib/api";
import { SettlementDebt } from "../lib/types";
import { fmtTokens } from "../lib/format";

export function Debts() {
  const { data: net } = useLive(() => api.getCurrentNet(), []);
  const { data: debts, reload } = useLive(() => api.getMyDebts(), []);

  const pay = (debts ?? []).filter((d) => d.direction === "pay");
  const receive = (debts ?? []).filter((d) => d.direction === "receive");
  const n = net ?? 0;

  return (
    <div className="py-3 space-y-4">
      <h1 className="text-xl font-extrabold px-1">A quién debes</h1>

      {/* Neto en vivo del periodo en curso */}
      <div className="card p-5 text-center">
        <div className="text-xs text-gray-400 uppercase tracking-wide">Tu balance esta quincena</div>
        <div className={`text-4xl font-extrabold tabular-nums mt-1 ${n >= 0 ? "text-padel-400" : "text-red-400"}`}>
          {n >= 0 ? "+" : ""}{fmtTokens(n)}
        </div>
        <div className="text-xs text-gray-400 mt-1">
          {n >= 0 ? "vas ganando" : "vas perdiendo"} · {Math.abs(n / 100).toFixed(2)}€
        </div>
      </div>

      <p className="text-[11px] text-gray-500 px-1 -mt-1">
        Cada 15 días se cierra la quincena y se paga por Bizum entre jugadores. Los tokens son
        dinero real: 1€ = 100 tk.
      </p>

      {/* Pagas tú */}
      <Section title="Pagas tú">
        {pay.length === 0 && <Empty text="No debes nada de la última liquidación." />}
        {pay.map((d) => (
          <DebtRow key={d.id} d={d} />
        ))}
      </Section>

      {/* Te pagan */}
      <Section title="Te pagan">
        {receive.length === 0 && <Empty text="Nadie te debe de la última liquidación." />}
        {receive.map((d) => (
          <DebtRow
            key={d.id}
            d={d}
            onConfirm={async () => {
              await api.confirmDebtReceived(d.id);
              reload();
            }}
          />
        ))}
      </Section>
    </div>
  );
}

function DebtRow({ d, onConfirm }: { d: SettlementDebt; onConfirm?: () => void }) {
  const isPay = d.direction === "pay";
  return (
    <div className="flex items-center justify-between bg-ink-700/40 rounded-xl px-3 py-2.5">
      <div className="min-w-0">
        <div className="text-sm font-semibold truncate">
          {isPay ? `Pagas a ${d.otherName}` : `${d.otherName} te paga`}
        </div>
        <div className="text-xs text-gray-400">{d.euros}€ · {fmtTokens(d.tokens)} tk</div>
      </div>
      {d.status === "confirmed" ? (
        <span className="text-[11px] px-2 py-1 rounded-full bg-padel-600/30 text-padel-400">✓ Pagado</span>
      ) : isPay ? (
        <span className="text-[11px] px-2 py-1 rounded-full bg-amber-500/20 text-amber-300">Pendiente</span>
      ) : (
        <button onClick={onConfirm} className="btn-primary py-2 px-3 text-sm">Marcar recibido</button>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-4 space-y-2">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-gray-500">{text}</p>;
}
