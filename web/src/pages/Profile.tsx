import { useState } from "react";
import { api, DEMO_MODE } from "../lib/api";
import { SessionUser } from "../lib/types";
import { InstallButton } from "../components/InstallButton";

export function Profile({ user }: { user: SessionUser | null }) {
  return (
    <div className="py-3 space-y-4">
      <div className="card p-5 flex items-center gap-4">
        <div className="w-14 h-14 rounded-full bg-padel-600 grid place-items-center text-2xl">👤</div>
        <div>
          <div className="font-bold text-lg">{user?.name ?? "Jugador"}</div>
          <div className="text-xs text-gray-400 capitalize">{user?.role ?? "player"}</div>
        </div>
      </div>

      {!DEMO_MODE && <ChangePassword />}

      <div className="card p-4 space-y-2">
        <h3 className="font-semibold text-sm">Instalar como app</h3>
        <InstallButton />
      </div>

      <div className="card divide-y divide-ink-700 text-sm">
        <Row label="Modo" value={DEMO_MODE ? "Demo (datos en memoria)" : "Conectado a PTG"} />
        <Row label="Cómo funcionan las cuotas" value="Ranking actual + histórico, se mueven con el dinero" />
      </div>

      <div className="card p-4 text-[11px] text-gray-500 leading-relaxed">
        ⚠️ Apuestas sociales entre amigos. Los tokens son dinero real (1€ = 100 tk): el
        saldo se acredita al instante (con tope mensual) y cada 15 días se liquida por
        Bizum entre jugadores en la pestaña "Deudas". Juega con cabeza.
      </div>

      {!DEMO_MODE && (
        <button onClick={() => api.signOut().then(() => location.reload())} className="btn-primary w-full bg-ink-700">
          Cerrar sesión
        </button>
      )}
    </div>
  );
}

function ChangePassword() {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await api.changePassword(pw);
      setMsg("✓ Contraseña cambiada.");
      setPw("");
    } catch (e: any) {
      setMsg(e.message ?? "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4 space-y-2">
      <h3 className="font-semibold text-sm">Cambiar contraseña</h3>
      <div className="flex gap-2">
        <input
          type="password"
          autoComplete="new-password"
          placeholder="nueva contraseña (mín. 6)"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          className="flex-1 bg-ink-900 border border-ink-600 rounded-xl px-3 py-2.5"
        />
        <button disabled={busy || pw.length < 6} onClick={save} className="btn-primary py-2 px-4">
          {busy ? "…" : "Guardar"}
        </button>
      </div>
      {msg && <p className="text-xs text-padel-400">{msg}</p>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 px-4 py-3">
      <span className="text-gray-400 shrink-0">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
