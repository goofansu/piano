export function abbrevHome(p: string | undefined, home?: string): string {
  if (!p) return "";
  const h = home ?? (p.startsWith("/Users/") ? `/Users/${p.split("/")[2]}` : p.startsWith("/home/") ? `/home/${p.split("/")[2]}` : "");
  if (h && p === h) return "~";
  if (h && p.startsWith(`${h}/`)) return `~${p.slice(h.length)}`;
  return p;
}

export function relTime(iso: string): string {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return "now";
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  return `${Math.floor(d / 86400)}d`;
}

export function clamp(text: string | undefined, max: number): string {
  if (!text || text.length <= max) return text ?? "";
  return `${text.slice(0, max)}\n…(truncated)`;
}

export function modelShort(ref: string | undefined): string {
  return ref ? ref.split("/").pop() ?? ref : "";
}
