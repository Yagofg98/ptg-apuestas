import { motion } from "framer-motion";
import { useRef, useEffect, useState } from "react";
import { fmtOdds } from "../lib/format";

/** Botón de cuota que parpadea verde/rojo cuando la cuota sube/baja (efecto vivo). */
export function OddsButton({
  label,
  odds,
  active,
  onClick,
}: {
  label: string;
  odds: number;
  active: boolean;
  onClick: () => void;
}) {
  const prev = useRef(odds);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    if (odds > prev.current) setFlash("up");
    else if (odds < prev.current) setFlash("down");
    prev.current = odds;
    if (odds !== prev.current) return;
    const t = setTimeout(() => setFlash(null), 700);
    return () => clearTimeout(t);
  }, [odds]);

  return (
    <button onClick={onClick} className={`odds-btn flex-1 ${active ? "odds-btn-active" : ""}`}>
      <span className="text-[11px] leading-tight text-gray-300 mb-0.5 text-center">{label}</span>
      <motion.span
        key={odds}
        initial={{ scale: 1.15 }}
        animate={{ scale: 1 }}
        className={`text-base font-bold tabular-nums ${
          flash === "up" ? "text-padel-400" : flash === "down" ? "text-red-400" : "text-white"
        }`}
      >
        {fmtOdds(odds)}
      </motion.span>
    </button>
  );
}
