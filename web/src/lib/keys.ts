/** Keyboard helpers shared by the palette shortcut and the hint that advertises it. */

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** The platform's primary modifier as people read it. */
export const mod = isMac ? "⌘" : "Ctrl";

/** True when the event carries the platform's primary modifier and no other. */
export const hasMod = (e: KeyboardEvent | React.KeyboardEvent) =>
  isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;

type ImeFields = Pick<KeyboardEvent, "isComposing" | "keyCode">;

/**
 * True for a key the IME is still processing, which is never a command key. keyCode 229 is such a
 * key, which some browsers (Safari, on the Enter that accepts a candidate) report without isComposing.
 */
export const isImeKey = (e: ImeFields | { nativeEvent: ImeFields }) => {
  const key = "nativeEvent" in e ? e.nativeEvent : e;
  return key.isComposing || key.keyCode === 229;
};

/** A shortcut as a list of key labels, for a `KbdGroup`. */
export const keys = (...parts: string[]) => parts.map((p) => (p === "mod" ? mod : p));

/** Composer-local model picker shortcut; never consume IME input. */
export const isModelPickerKey = (e: React.KeyboardEvent) =>
  e.key === "/" && hasMod(e) && !e.altKey && !e.shiftKey && !e.repeat && !isImeKey(e);

/** Enter sends from a keyboard. Shift+Enter, IME composition, key repeat and touch screens (where Enter is a newline) do not. */
export const isSendKey = (e: React.KeyboardEvent) =>
  e.key === "Enter" &&
  !e.shiftKey &&
  !isImeKey(e) &&
  !e.repeat &&
  !window.matchMedia("(pointer: coarse)").matches;
