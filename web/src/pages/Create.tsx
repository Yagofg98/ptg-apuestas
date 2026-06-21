import { useState } from "react";
import { useLive } from "../hooks/useLive";
import { api } from "../lib/api";
import { PendingMatch } from "../lib/types";
import { whenLabel } from "../lib/format";
import { NewMatchForm } from "../components/NewMatchForm";

export function Create({ onChange }: { onChange: () => void }) {
  return (
    <div className="py-3 space-y-5">
      <h1 className="text-xl font-extrabold px-1">Crear partido</h1>

      <div className="card p-4 space-y-3">
        <h2 className="font-semibold">Tu partido (fuera de PTG)</h2>
        <p className="text-xs text-gray-400 -mt-1">
          Elige las 2 parejas (de la lista o añade jugadores nuevos) y se abre a apuestas al instante.
        </p>
        <NewMatchForm origin="user" onCreated={onChange} />
      </div>

      <PtgPending onChange={onChange} />
    </div>
  );
}

function PtgPending({ onChange }: { onChange: () => void }) {
  const { data: pending, reload } = useLive(() => api.listPendingMatches(), []);
  const [openId, setOpenId] = useState<string | null>(null);

  if (!pending || pending.length === 0) return null;

  return (
    <div className="card p-4 space-y-3">
      <h2 className="font-semibold">Partidos PTG por configurar</h2>
      <p className="text-xs text-gray-400 -mt-1">
        Importados de PTG (grupo azul). Falta asignar las 2 parejas para abrir las apuestas.
      </p>
      {pending.map((m: PendingMatch) => (
        <div key={m.id} className="bg-ink-700/40 rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm">
              <div className="font-semibold">{m.grupo ? `Grupo ${m.grupo}` : "Partido PTG"}</div>
              <div className="text-xs text-gray-400">{whenLabel(m.scheduledAt)}</div>
            </div>
            <button
              onClick={() => setOpenId((id) => (id === m.id ? null : m.id))}
              className="text-xs bg-ink-600 rounded-lg px-2 py-1"
            >
              {openId === m.id ? "Cerrar" : "Configurar"}
            </button>
          </div>
          {openId === m.id && (
            <div className="pt-1 border-t border-ink-600">
              <NewMatchForm
                existingMatchId={m.id}
                presetWhen={m.scheduledAt}
                origin="user"
                submitLabel="Configurar y abrir"
                onCreated={() => { setOpenId(null); reload(); onChange(); }}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
