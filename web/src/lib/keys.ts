/** Keyboard helpers shared by the shortcuts, the palette and the hints that advertise them. */

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** The platform's primary modifier as people read it. */
export const mod = isMac ? "⌘" : "Ctrl";

/** True when the event carries the platform's primary modifier and no other. */
export const hasMod = (e: KeyboardEvent | React.KeyboardEvent) => (isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey);

/** A shortcut as a list of key labels, for a `KbdGroup`. */
export const keys = (...parts: string[]) => parts.map((p) => (p === "mod" ? mod : p === "shift" ? (isMac ? "⇧" : "Shift") : p === "alt" ? (isMac ? "⌥" : "Alt") : p));
