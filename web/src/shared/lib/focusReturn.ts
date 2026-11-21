import { focusMovedOn, pointerLast } from "@/shared/lib/pointerClose";

const usable = (element: HTMLElement | null | undefined): element is HTMLElement =>
  !!element?.isConnected && element.checkVisibility();

function menuTrigger(source: HTMLElement | null) {
  const id = source?.closest("[role=menu]")?.getAttribute("aria-labelledby");
  return id ? document.getElementById(id) : null;
}

export type FocusReturn = () => HTMLElement | false;

export function focusReturn(fallback: string): FocusReturn {
  const active = document.activeElement;
  const source = active instanceof HTMLElement && active !== document.body ? active : null;
  const trigger = menuTrigger(source);
  return () => {
    if (pointerLast() || focusMovedOn()) return false;
    return [source, trigger].find(usable) ?? document.querySelector<HTMLElement>(fallback) ?? false;
  };
}
