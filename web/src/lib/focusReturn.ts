import { pointerLast } from "@/lib/pointerClose";

const usable = (element: HTMLElement | null | undefined): element is HTMLElement =>
  !!element?.isConnected && element.checkVisibility();

function menuTrigger(source: HTMLElement | null) {
  const id = source?.closest("[role=menu]")?.getAttribute("aria-labelledby");
  return id ? document.getElementById(id) : null;
}

export function focusReturn(fallback: string): (event: Event) => void {
  const active = document.activeElement;
  const source = active instanceof HTMLElement && active !== document.body ? active : null;
  const trigger = menuTrigger(source);
  return (event) => {
    // Radix has no DialogTrigger here; a dismissed palette or menu also loses its invoking row.
    event.preventDefault();
    if (pointerLast()) return;
    const current = document.activeElement;
    if (current instanceof HTMLElement && current !== document.body) return;
    const target = [source, trigger].find(usable) ?? document.querySelector<HTMLElement>(fallback);
    target?.focus({ preventScroll: true });
  };
}
