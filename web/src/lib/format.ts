export const fmtOdds = (o: number) => o.toFixed(2);
export const fmtTokens = (n: number) =>
  new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 }).format(Math.round(n));

export function teamName(team: { name: string }[]) {
  return team.map((p) => p.name).join(" / ");
}

export function whenLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return `Hoy ${time}`;
  const tomorrow = new Date(now.getTime() + 86400000);
  if (d.toDateString() === tomorrow.toDateString()) return `Mañana ${time}`;
  return d.toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" }) + ` ${time}`;
}
