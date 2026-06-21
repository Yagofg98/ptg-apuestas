import { useState } from "react";
import { api } from "../lib/api";

function friendly(msg: string): string {
  if (/invalid login credentials/i.test(msg)) return "Email o contraseña incorrectos.";
  if (/already registered|already exists|user already/i.test(msg)) return "Ese email ya tiene cuenta. Entra con tu contraseña.";
  if (/password should be at least/i.test(msg)) return "La contraseña debe tener al menos 6 caracteres.";
  return msg;
}

export function Login({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready =
    email.includes("@") && password.length >= 6 && (mode === "login" || name.trim().length > 0);

  async function submit() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === "signup") await api.signUpWithPassword(name, email, password);
      else await api.signInWithPassword(email, password);
      onDone();
    } catch (e: any) {
      setError(friendly(e.message ?? "Error"));
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

        <div className="card p-5 space-y-3">
          {/* Toggle Entrar / Crear cuenta */}
          <div className="flex gap-2 text-sm">
            <button
              onClick={() => { setMode("login"); setError(null); }}
              className={`flex-1 rounded-xl py-2 font-medium ${mode === "login" ? "bg-padel-600 text-white" : "bg-ink-700/50 text-gray-400"}`}
            >
              Entrar
            </button>
            <button
              onClick={() => { setMode("signup"); setError(null); }}
              className={`flex-1 rounded-xl py-2 font-medium ${mode === "signup" ? "bg-padel-600 text-white" : "bg-ink-700/50 text-gray-400"}`}
            >
              Crear cuenta
            </button>
          </div>

          {mode === "signup" && (
            <input
              type="text"
              autoComplete="name"
              placeholder="Tu nombre"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-ink-900 border border-ink-600 rounded-xl px-3 py-3"
            />
          )}
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="tu@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-ink-900 border border-ink-600 rounded-xl px-3 py-3"
          />
          <input
            type="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            placeholder="contraseña (mín. 6)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            className="w-full bg-ink-900 border border-ink-600 rounded-xl px-3 py-3"
          />

          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button disabled={busy || !ready} onClick={submit} className="btn-primary w-full">
            {busy ? "…" : mode === "signup" ? "Crear cuenta" : "Entrar"}
          </button>
        </div>
        <p className="text-[11px] text-gray-600">Solo para miembros del grupo PTG.</p>
      </div>
    </div>
  );
}
