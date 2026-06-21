import { useState } from "react";
import { useLive } from "../hooks/useLive";
import { api } from "../lib/api";
import { Player } from "../lib/types";

/** ISO → valor para <input type="datetime-local"> (hora local, sin segundos). */
function toLocalInput(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

/**
 * Formulario de creación/configuración de un partido. Lo usan:
 *  · la página "Crear" (cualquier usuario) → partido propio (origin 'user').
 *  · la config de un shell PTG pendiente → pasa `existingMatchId`.
 *  · el panel admin.
 */
export function NewMatchForm({
  existingMatchId,
  presetWhen,
  origin = "user",
  submitLabel = "Crear partido",
  onCreated,
}: {
  existingMatchId?: string;
  presetWhen?: string;
  origin?: "user" | "admin";
  submitLabel?: string;
  onCreated?: () => void;
}) {
  const { data: players, reload } = useLive(() => api.listPlayers(), []);
  const [sel, setSel] = useState<string[]>(["", "", "", ""]);
  const [when, setWhen] = useState(toLocalInput(presetWhen));
  const [newName, setNewName] = useState("");
  const [addingBusy, setAddingBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const labels = ["Pareja A · jugador 1", "Pareja A · jugador 2", "Pareja B · jugador 1", "Pareja B · jugador 2"];
  const dupes = new Set(sel.filter(Boolean)).size !== sel.filter(Boolean).length;
  const ready = sel.every(Boolean) && !dupes;

  async function addPlayer() {
    const name = newName.trim();
    if (!name) return;
    setAddingBusy(true);
    setMsg(null);
    try {
      const id = await api.createAdhocPlayer(name);
      setNewName("");
      await reload();
      // auto-asignar al primer hueco libre
      setSel((s) => {
        const i = s.findIndex((v) => !v);
        if (i < 0) return s;
        return s.map((v, j) => (j === i ? id : v));
      });
    } catch (e: any) {
      setMsg(e.message ?? "Error");
    } finally {
      setAddingBusy(false);
    }
  }

  async function create() {
    setBusy(true);
    setMsg(null);
    try {
      await api.openMatch({
        scheduledAt: when ? new Date(when).toISOString() : new Date(Date.now() + 3600_000).toISOString(),
        teamAp1: sel[0], teamAp2: sel[1], teamBp1: sel[2], teamBp2: sel[3],
        origin,
        existingMatchId,
      });
      setMsg("✓ Partido creado y abierto a apuestas.");
      setSel(["", "", "", ""]);
      onCreated?.();
    } catch (e: any) {
      setMsg(e.message ?? "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
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
                {p.name}{p.currentRanking < 999 ? ` (#${p.currentRanking})` : ""}
              </option>
            ))}
          </select>
        </div>
      ))}

      <div>
        <label className="text-xs text-gray-400">Añadir jugador de fuera de PTG</label>
        <div className="flex gap-2 mt-1">
          <input
            type="text"
            placeholder="nombre del jugador"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addPlayer(); } }}
            className="flex-1 bg-ink-900 border border-ink-600 rounded-xl px-3 py-2.5"
          />
          <button
            disabled={addingBusy || !newName.trim()}
            onClick={addPlayer}
            className="bg-ink-600 rounded-xl px-4 text-sm disabled:opacity-40"
          >
            {addingBusy ? "…" : "+ nuevo"}
          </button>
        </div>
      </div>

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
        {busy ? "Creando…" : submitLabel}
      </button>
    </div>
  );
}
