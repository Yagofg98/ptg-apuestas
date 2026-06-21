import { useEffect, useState } from "react";
import { Routes, Route, NavLink } from "react-router-dom";
import { api, DEMO_MODE } from "./lib/api";
import { useLive } from "./hooks/useLive";
import { SessionUser } from "./lib/types";
import { fmtTokens } from "./lib/format";
import { BetSlip } from "./components/BetSlip";
import { Matches } from "./pages/Matches";
import { MatchDetail } from "./pages/MatchDetail";
import { Wallet } from "./pages/Wallet";
import { Profile } from "./pages/Profile";
import { Admin } from "./pages/Admin";
import { Login } from "./pages/Login";

export default function App() {
  const [session, setSession] = useState<SessionUser | null | undefined>(undefined);
  const { data: balance, reload: reloadBalance } = useLive(() => api.getBalance(), []);

  useEffect(() => {
    api.getSession().then(setSession);
  }, []);

  if (session === undefined) return <Splash />;
  if (session === null && !DEMO_MODE) return <Login onDone={() => api.getSession().then(setSession)} />;

  const isAdmin = session?.role === "admin" || session?.role === "treasurer";

  return (
    <div className="max-w-md mx-auto min-h-full pb-32 relative">
      <Header balance={balance ?? 0} />

      <main className="px-3">
        <Routes>
          <Route path="/" element={<Matches />} />
          <Route path="/match/:id" element={<MatchDetail />} />
          <Route path="/wallet" element={<Wallet onChange={reloadBalance} />} />
          <Route path="/profile" element={<Profile user={session} />} />
          <Route path="/admin" element={<Admin user={session} onChange={reloadBalance} />} />
        </Routes>
      </main>

      <BetSlip balance={balance ?? 0} onPlaced={reloadBalance} />
      <BottomNav isAdmin={isAdmin} />
    </div>
  );
}

function Header({ balance }: { balance: number }) {
  return (
    <header className="sticky top-0 z-20 bg-ink-900/90 backdrop-blur px-4 py-3 flex items-center justify-between border-b border-ink-700/50">
      <div className="flex items-center gap-2">
        <span className="text-xl">🎾</span>
        <span className="font-extrabold tracking-tight">PTG Apuestas</span>
        {DEMO_MODE && <span className="text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded">DEMO</span>}
      </div>
      <NavLink to="/wallet" className="flex items-center gap-1.5 bg-ink-700/60 rounded-full px-3 py-1.5">
        <span className="text-padel-400 font-bold tabular-nums">{fmtTokens(balance)}</span>
        <span className="text-xs text-gray-400">tk</span>
      </NavLink>
    </header>
  );
}

function BottomNav({ isAdmin }: { isAdmin: boolean }) {
  const items = [
    { to: "/", label: "Partidos", icon: "🎾" },
    { to: "/wallet", label: "Cartera", icon: "💰" },
    ...(isAdmin ? [{ to: "/admin", label: "Admin", icon: "🛠️" }] : []),
    { to: "/profile", label: "Perfil", icon: "👤" },
  ];
  return (
    <nav className="fixed bottom-0 inset-x-0 z-30 max-w-md mx-auto bg-ink-800/95 backdrop-blur border-t border-ink-700 flex">
      {items.map((it) => (
        <NavLink
          key={it.to}
          to={it.to}
          end={it.to === "/"}
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center py-2 text-xs gap-0.5 ${
              isActive ? "text-padel-400" : "text-gray-400"
            }`
          }
        >
          <span className="text-lg">{it.icon}</span>
          {it.label}
        </NavLink>
      ))}
    </nav>
  );
}

function Splash() {
  return (
    <div className="h-full grid place-items-center text-4xl animate-pulse">🎾</div>
  );
}
