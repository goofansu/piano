export function abbrevHome(p: string | undefined, home?: string): string {
  if (!p) return "";
  const h =
    home ??
    (p.startsWith("/Users/")
      ? `/Users/${p.split("/")[2]}`
      : p.startsWith("/home/")
        ? `/home/${p.split("/")[2]}`
        : "");
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

/** Compact token units, promoting rounded values at the million/billion boundaries. */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 999_500_000) return `${(tokens / 1e9).toFixed(1)}B`;
  if (tokens >= 999_500) return `${(tokens / 1e6).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1e3).toFixed(0)}k`;
  return String(tokens);
}

export function modelShort(ref: string | undefined): string {
  return ref ? (ref.split("/").pop() ?? ref) : "";
}

/** Hydro-style path: `~` for home, every segment but the last shortened to its first character (a leading dot kept). */
export function abbrevPath(p: string | undefined, home?: string): string {
  const full = abbrevHome(p, home);
  if (!full) return "";
  const parts = full.split("/");
  return parts
    .map((part, i) =>
      i === parts.length - 1 || part === "~" || part === ""
        ? part
        : (part.match(/^\.?./)?.[0] ?? part),
    )
    .join("/");
}
