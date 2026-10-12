/**
 * Text rules for completing a leading slash command in a composer. Only the first token of a
 * draft completes; sending trims the prompt, so whitespace before it is harmless. A `/a/b` path is
 * never a command. Nothing here depends on React or the DOM.
 */
import type { SlashCommand } from "@shared/wire";

/** At most this many suggestions are offered at once. */
export const MAX_SUGGESTIONS = 50;

/** The command token being typed: `from` is the slash, `to` the token end, `query` lowercased. */
export interface CompletionRange {
  from: number;
  to: number;
  query: string;
}

/**
 * The leading token to complete for a collapsed caret inside or at the end of it, after the slash.
 * The query is the lowercased text between the slash and the caret.
 */
export function completionRange(
  text: string,
  selection: { start: number; end: number },
): CompletionRange | null {
  const { start, end } = selection;
  if (start !== end) return null;
  const match = /^\s*\/([^\s/]*)/.exec(text);
  if (!match) return null;
  const from = match[0].indexOf("/");
  const to = match[0].length;
  if (start <= from || start > to || text[to] === "/") return null;
  return { from, to, query: text.slice(from + 1, start).toLowerCase() };
}

/** The span of the leading command token while it still names the command last accepted. */
export function commandToken(
  text: string,
  accepted: string | undefined,
): { from: number; to: number } | null {
  const leading = /^\s*\/([^\s/]+)(?=\s|$)/.exec(text);
  return accepted && leading?.[1] === accepted
    ? { from: leading[0].indexOf("/"), to: leading[0].length }
    : null;
}

/**
 * Skills whose name contains the query, those whose name without `skill:` starts with it first,
 * then by name, capped at {@link MAX_SUGGESTIONS}.
 */
export function rankSkills(commands: readonly SlashCommand[], query: string): SlashCommand[] {
  const needle = query.toLowerCase();
  const rank = (command: SlashCommand) =>
    command.name
      .replace(/^skill:/, "")
      .toLowerCase()
      .startsWith(needle)
      ? 0
      : 1;
  return commands
    .filter((command) => command.source === "skill" && command.name.toLowerCase().includes(needle))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
    .slice(0, MAX_SUGGESTIONS);
}

/**
 * Replace the range with `/name` and one separator. An existing whitespace separator is reused,
 * and the caret lands after it so the next character starts an argument, not the name.
 */
export function acceptCompletion(
  text: string,
  range: { from: number; to: number },
  name: string,
): { text: string; caret: number } {
  const suffix = text.slice(range.to);
  const hasSeparator = /^\s/.test(suffix);
  const inserted = `/${name}${hasSeparator ? "" : " "}`;
  return {
    text: text.slice(0, range.from) + inserted + suffix,
    caret: range.from + inserted.length + (hasSeparator ? 1 : 0),
  };
}
