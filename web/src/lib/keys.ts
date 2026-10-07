/** Keyboard helpers shared by the palette shortcut and the hint that advertises it. */

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** The platform's primary modifier as people read it. */
export const mod = isMac ? "⌘" : "Ctrl";

/** True when the event carries the platform's primary modifier and no other. */
export const hasMod = (e: KeyboardEvent | React.KeyboardEvent) => (isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey);

/** A shortcut as a list of key labels, for a `KbdGroup`. */
export const keys = (...parts: string[]) => parts.map((p) => (p === "mod" ? mod : p));
