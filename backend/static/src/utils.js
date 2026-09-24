// Shared small utilities (browser-only)

export const $ = (id) => document.getElementById(id);

export function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function formatKW(v) {
  if (!isFinite(v)) return "—";
  return `${Number(v).toFixed(2)} kW`;
}

export function niceTime(ts) {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
