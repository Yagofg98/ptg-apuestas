import { api, DEMO_MODE } from "../lib/api";
import { SessionUser } from "../lib/types";

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

      <div className="card divide-y divide-ink-700 text-sm">
        <Row label="Modo" value={DEMO_MODE ? "Demo (datos en memoria)" : "Conectado a PTG"} />
        <Row label="Instalar app" value="Menú navegador → Añadir a inicio" />
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 px-4 py-3">
      <span className="text-gray-400 shrink-0">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
