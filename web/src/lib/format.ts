import { cutText } from "../../../shared/cutText.ts";

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

export function clamp(text: string | undefined, max: number): string {
  if (!text || text.length <= max) return text ?? "";
  return `${cutText(text, max)}\n…(truncated)`;
}

/**
 * A tool call's arguments as the reader wants them. A shell command is the whole story, so it
 * shows alone, as the lines the agent ran; its timeout is a diagnostic nobody acts on. Any other
 * call shows one `name: value` line per argument, a multi-line value (a file's new contents) on
 * its own lines with real line breaks instead of JSON's `\n` escapes. Arguments still streaming
 * in, or not a JSON object, show as they are; an empty object shows nothing.
 */
export function toolArgsText(args: string | undefined): string {
  if (!args) return "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(args);
  } catch {
    return args;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return args;
  const entries = Object.entries(parsed);
  const command = entries.find(([name, value]) => name === "command" && typeof value === "string");
  if (command && entries.every(([name]) => name === "command" || name === "timeout"))
    return command[1] as string;
  return entries
    .map(([name, value]) => {
      const text = typeof value === "string" ? value : JSON.stringify(value);
      return text.includes("\n") ? `${name}:\n${text}` : `${name}: ${text}`;
    })
    .join("\n");
}

const ESC = "\u001b";
const BEL = "\u0007";
/** Escape sequences in terminal output, built from the constants above because the lint forbids
 * control characters inside a regex literal: OSC strings such as hyperlinks (their visible text
 * stays), CSI colour and cursor codes, then any other two-byte escape. */
const TERMINAL_ESCAPES = [
  new RegExp(`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`, "g"),
  new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, "g"),
  new RegExp(`${ESC}[@-Z\\\\-_]`, "g"),
];

/** Terminal output as text: escape sequences go, `\r\n` becomes `\n` and a stray `\r` goes. */
export function stripAnsi(text: string): string {
  return TERMINAL_ESCAPES.reduce((out, pattern) => out.replace(pattern, ""), text).replace(
    /\r\n?/g,
    "\n",
  );
}

/** Compact token units, promoting rounded values at the million/billion boundaries. */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 999_500_000) return `${(tokens / 1e9).toFixed(1)}B`;
  if (tokens >= 999_500) return `${(tokens / 1e6).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1e3).toFixed(0)}k`;
  return String(tokens);
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

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const UNITS = [
  ["year", 31536000],
  ["month", 2592000],
  ["week", 604800],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
] as const;

/** How long ago `iso` was, in the largest whole unit: "2 hours ago", "yesterday", else "just now". */
export function timeAgo(iso: string, now: number): string {
  const seconds = (new Date(iso).getTime() - now) / 1000;
  for (const [unit, size] of UNITS)
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  return "just now";
}

/** How a checkout Git lists on no branch is named wherever a branch label would be. */
export const DETACHED_HEAD = "Detached HEAD";

/** A worktree's branch as the UI names it: the branch, else Detached HEAD, else Unknown branch. */
export const branchLabel = (branch: string | null, detached: boolean) =>
  branch ?? (detached ? DETACHED_HEAD : "Unknown branch");
