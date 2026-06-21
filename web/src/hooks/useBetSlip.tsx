import { createContext, useContext, useMemo, useState, ReactNode, useCallback } from "react";
import { BetSlipLeg } from "../lib/types";

interface BetSlipCtx {
  legs: BetSlipLeg[];
  add: (leg: BetSlipLeg) => void;
  remove: (outcomeId: string) => void;
  toggle: (leg: BetSlipLeg) => void;
  clear: () => void;
  has: (outcomeId: string) => boolean;
  combinedOdds: number;
}

const Ctx = createContext<BetSlipCtx | null>(null);

export function BetSlipProvider({ children }: { children: ReactNode }) {
  const [legs, setLegs] = useState<BetSlipLeg[]>([]);

  const remove = useCallback((outcomeId: string) => {
    setLegs((ls) => ls.filter((l) => l.outcomeId !== outcomeId));
  }, []);

  // Las combinadas son SOLO del mismo partido: si eliges otro partido, el boleto
  // se reinicia con esa nueva selección.
  const addLeg = (ls: BetSlipLeg[], leg: BetSlipLeg): BetSlipLeg[] => {
    const sameMatch = ls.length === 0 || ls[0].matchId === leg.matchId ? ls : [];
    // una sola pata por mercado (resultados excluyentes)
    const filtered = sameMatch.filter((l) => l.marketId !== leg.marketId);
    return [...filtered, leg];
  };

  const add = useCallback((leg: BetSlipLeg) => {
    setLegs((ls) => addLeg(ls, leg));
  }, []);

  const toggle = useCallback((leg: BetSlipLeg) => {
    setLegs((ls) => {
      if (ls.some((l) => l.outcomeId === leg.outcomeId)) {
        return ls.filter((l) => l.outcomeId !== leg.outcomeId);
      }
      return addLeg(ls, leg);
    });
  }, []);

  const clear = useCallback(() => setLegs([]), []);
  const has = useCallback((outcomeId: string) => legs.some((l) => l.outcomeId === outcomeId), [legs]);

  const combinedOdds = useMemo(
    () => Number(legs.reduce((acc, l) => acc * l.odds, 1).toFixed(2)),
    [legs],
  );

  const value = useMemo(
    () => ({ legs, add, remove, toggle, clear, has, combinedOdds }),
    [legs, add, remove, toggle, clear, has, combinedOdds],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBetSlip() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useBetSlip fuera de BetSlipProvider");
  return ctx;
}
