import type { SlashCommand } from "@shared/wire";
import { isImeKey } from "./keys.ts";

export const MAX_SUGGESTIONS = 50;

export interface CompletionRange {
  from: number;
  to: number;
  query: string;
}

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

export function commandToken(
  text: string,
  accepted: string | undefined,
): { from: number; to: number } | null {
  const leading = /^\s*\/([^\s/]+)(?=\s|$)/.exec(text);
  return accepted && leading?.[1] === accepted
    ? { from: leading[0].indexOf("/"), to: leading[0].length }
    : null;
}

export function rankCommands(commands: readonly SlashCommand[], query: string): SlashCommand[] {
  const needle = query.toLowerCase();
  const bare = (command: SlashCommand) => command.name.replace(/^skill:/, "").toLowerCase();
  const rank = (command: SlashCommand) => (bare(command).startsWith(needle) ? 0 : 1);
  const invoked = new Map<string, SlashCommand>();
  for (const command of commands)
    if (!invoked.has(command.name)) invoked.set(command.name, command);
  return [...invoked.values()]
    .filter(
      (command) => command.source !== "extension" && command.name.toLowerCase().includes(needle),
    )
    .sort(
      (a, b) => rank(a) - rank(b) || bare(a).localeCompare(bare(b)) || a.name.localeCompare(b.name),
    )
    .slice(0, MAX_SUGGESTIONS);
}

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

export interface TextSelection {
  start: number;
  end: number;
}

export interface SlashView {
  value: string;
  enabled: boolean;
  readOnly: boolean;
  context: string;
}

export interface SlashState {
  selection: TextSelection;
  focused: boolean;
  composing: boolean;
  dismissed?: string;
  highlight?: { position: string; index: number };
  accepted?: string;
}

export const initialSlashState: SlashState = {
  selection: { start: 0, end: 0 },
  focused: false,
  composing: false,
};

const positionOf = (context: string, value: string, selection: TextSelection) =>
  JSON.stringify([context, value, { start: selection.start, end: selection.end }]);
const position = (state: SlashState, view: SlashView) =>
  positionOf(view.context, view.value, state.selection);

export function slashOpen(state: SlashState, view: SlashView): boolean {
  return (
    view.enabled &&
    state.focused &&
    !state.composing &&
    !!completionRange(view.value, state.selection) &&
    state.dismissed !== position(state, view)
  );
}

export function slashActive(state: SlashState, view: SlashView, count: number): number {
  const index = state.highlight?.position === position(state, view) ? state.highlight.index : 0;
  return Math.min(index, Math.max(0, count - 1));
}

export interface TextareaSnapshot {
  value: string;
  selection: TextSelection;
}

export type SlashEvent =
  | ({ type: "select" } & TextareaSnapshot)
  | ({ type: "focus" } & TextareaSnapshot)
  | { type: "blur" }
  | { type: "composition-start" }
  | ({ type: "composition-end" } & TextareaSnapshot)
  | { type: "highlight"; index: number }
  | { type: "dismiss" };

export function slashUpdate(state: SlashState, view: SlashView, event: SlashEvent): SlashState {
  const at = (snapshot: TextareaSnapshot): SlashState => ({
    ...state,
    selection: snapshot.selection,
    highlight:
      state.highlight?.position === positionOf(view.context, snapshot.value, snapshot.selection)
        ? state.highlight
        : undefined,
  });
  switch (event.type) {
    case "select":
      return at(event);
    case "focus":
      return { ...at(event), focused: true, dismissed: undefined };
    case "blur":
      return { ...state, focused: false };
    case "composition-start":
      return { ...state, composing: true };
    case "composition-end":
      return { ...at(event), composing: false };
    case "highlight": {
      const here = position(state, view);
      return state.highlight?.position === here && state.highlight.index === event.index
        ? state
        : { ...state, highlight: { position: here, index: event.index } };
    }
    case "dismiss":
      return { ...state, dismissed: position(state, view) };
  }
}

export interface SlashKey {
  key: string;
  repeat: boolean;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  isComposing: boolean;
  keyCode: number;
  selection: TextSelection;
}

export type SlashEffect =
  | { type: "ignore" }
  | { type: "pass" }
  | { type: "select-token"; from: number; to: number }
  | { type: "close" }
  | { type: "move" }
  | { type: "accept"; index: number }
  | { type: "hold" };

export function slashKeyDown(
  state: SlashState,
  view: SlashView,
  key: SlashKey,
  count: number,
): { state: SlashState; effect: SlashEffect } {
  if (state.composing || isImeKey(key)) return { state, effect: { type: "ignore" } };
  const token = commandToken(view.value, state.accepted);
  if (
    token &&
    !view.readOnly &&
    key.key === "Backspace" &&
    !key.metaKey &&
    !key.ctrlKey &&
    !key.altKey &&
    key.selection.end === token.to &&
    (key.selection.start === token.to || (key.repeat && key.selection.start === token.from))
  )
    return {
      state: {
        ...state,
        dismissed: position(state, view),
        selection: { start: token.from, end: token.to },
      },
      effect: { type: "select-token", ...token },
    };
  const open = slashOpen(state, view);
  if (open && key.key === "Escape")
    return { state: slashUpdate(state, view, { type: "dismiss" }), effect: { type: "close" } };
  if (open && count && !key.ctrlKey && !key.metaKey && !key.shiftKey) {
    const active = slashActive(state, view, count);
    if (!key.altKey && (key.key === "ArrowDown" || key.key === "ArrowUp")) {
      const index = (active + (key.key === "ArrowDown" ? 1 : -1) + count) % count;
      return {
        state: slashUpdate(state, view, { type: "highlight", index }),
        effect: { type: "move" },
      };
    }
    if ((key.key === "Tab" && !key.altKey) || key.key === "Enter")
      return { state, effect: key.repeat ? { type: "hold" } : { type: "accept", index: active } };
  }
  return { state, effect: { type: "pass" } };
}

export function slashAccept(
  state: SlashState,
  view: SlashView,
  name: string,
  current: TextareaSnapshot,
): { state: SlashState; text: string; caret: number } | null {
  const range = completionRange(view.value, state.selection);
  if (!range || !slashOpen(state, view)) return null;
  if (
    current.value !== view.value ||
    current.selection.start !== state.selection.start ||
    current.selection.end !== state.selection.end
  )
    return null;
  const { text, caret } = acceptCompletion(view.value, range, name);
  return {
    state: {
      ...state,
      accepted: name,
      dismissed: positionOf(view.context, text, { start: caret, end: caret }),
    },
    text,
    caret,
  };
}
