/** Keyboard helpers shared by the palette shortcut and the hint that advertises it. */

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** The platform's primary modifier as people read it. */
export const mod = isMac ? "⌘" : "Ctrl";

/** True when the event carries the platform's primary modifier and no other. */
export const hasMod = (e: KeyboardEvent | React.KeyboardEvent) => (isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey);

/** A shortcut as a list of key labels, for a `KbdGroup`. */
export const keys = (...parts: string[]) => parts.map((p) => (p === "mod" ? mod : p));

/** Enter sends from a keyboard. Shift+Enter, IME composition, key repeat and touch screens (where Enter is a newline) do not. */
export const isSendKey = (e: React.KeyboardEvent) =>
  e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229 && !e.repeat && !window.matchMedia("(pointer: coarse)").matches;
