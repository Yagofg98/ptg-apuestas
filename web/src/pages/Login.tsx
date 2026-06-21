import { useState } from "react";
import { api } from "../lib/api";

export function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await api.signInWithEmail(email.trim());
      setSent(true);
    } catch (e: any) {
      setError(e.message ?? "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-md mx-auto min-h-full grid place-items-center px-6">
      <div className="w-full text-center space-y-5">
        <div className="text-5xl">🎾</div>
        <div>
          <h1 className="text-2xl font-extrabold">PTG Apuestas</h1>
          <p className="text-gray-400 text-sm mt-1">Apuestas de pádel entre colegas</p>
        </div>

        {sent ? (
          <div className="card p-5">
            <p className="text-padel-400 font-semibold">Revisa tu email ✉️</p>
            <p className="text-sm text-gray-400 mt-1">Te enviamos un enlace para entrar.</p>
            <button onClick={onDone} className="text-xs text-gray-500 mt-3 underline">Ya he entrado</button>
          </div>
        ) : (
          <div className="card p-5 space-y-3">
            <input
              type="email"
              placeholder="tu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-ink-900 border border-ink-600 rounded-xl px-3 py-3"
            />
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <button disabled={busy || !email.includes("@")} onClick={send} className="btn-primary w-full">
              {busy ? "Enviando…" : "Entrar con email"}
            </button>
          </div>
        )}
        <p className="text-[11px] text-gray-600">Solo para miembros del grupo PTG.</p>
      </div>
    </div>
  );
}
