/**
 * Custom High Density terminal styles for KairoForge
 */

export const THEME = {
  bg: "bg-[#0A0B0E]",
  sidebar: "bg-[#0A0B0E]",
  panel: "bg-[#0D1014]",
  header: "bg-[#111418]",
  card: "bg-[#161B22]",
  border: "border-slate-800",
  textPrimary: "text-slate-200",
  textSecondary: "text-slate-500",
  accent: "text-cyan-400",
  accentBg: "bg-cyan-500",
  success: "text-emerald-400",
  danger: "text-rose-400",
  warning: "text-amber-400",
  input: "bg-[#161B22] border-slate-700 focus:border-cyan-500",
};

export const containerClass = "h-screen flex flex-col overflow-hidden font-sans selection:bg-cyan-500/30";
export const cardClass = `${THEME.card} border ${THEME.border} rounded-xl overflow-hidden`;
