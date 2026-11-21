export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export const mod = isMac ? "⌘" : "Ctrl";

export const hasMod = (e: KeyboardEvent | React.KeyboardEvent) =>
  isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;

type ImeFields = Pick<KeyboardEvent, "isComposing" | "keyCode">;

// Safari's IME-confirming Enter reports keyCode 229 without isComposing.
export const isImeKey = (e: ImeFields | { nativeEvent: ImeFields }) => {
  const key = "nativeEvent" in e ? e.nativeEvent : e;
  return key.isComposing || key.keyCode === 229;
};

const ownsTextInput = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.isContentEditable ||
    /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) ||
    !!el.closest('form, [role="textbox"]'));

const overlayOpen = () =>
  !!document.querySelector(
    '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [cmdk-root]',
  );

export const shortcutBlocked = (
  target: EventTarget | null,
  { composer }: { composer?: string } = {},
) =>
  overlayOpen() ||
  (!(composer && target instanceof HTMLTextAreaElement && target.closest(composer)) &&
    ownsTextInput(target));

const MODIFIERS = new Set(["Alt", "AltGraph", "Control", "Meta", "Shift"]);

export function sessionNavigationKey(e: KeyboardEvent): -1 | 1 | "modifier" | undefined {
  if (isImeKey(e)) return undefined;
  if (MODIFIERS.has(e.key)) return "modifier";
  if (e.defaultPrevented || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return undefined;
  if (e.key === "ArrowUp") return -1;
  if (e.key === "ArrowDown") return 1;
  return undefined;
}

export const keys = (...parts: string[]) => parts.map((p) => (p === "mod" ? mod : p));

export const isModelPickerKey = (e: React.KeyboardEvent) =>
  e.key === "/" && hasMod(e) && !e.altKey && !e.shiftKey && !e.repeat && !isImeKey(e);

export const isSendKey = (e: React.KeyboardEvent) =>
  e.key === "Enter" &&
  !e.shiftKey &&
  !isImeKey(e) &&
  !e.repeat &&
  !window.matchMedia("(pointer: coarse)").matches;
