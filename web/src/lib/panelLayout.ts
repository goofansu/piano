/**
 * The right sidebar's remembered width. It has no collapsed state and no mobile column: below the
 * breakpoint it is a sheet, so only the desktop width is a preference.
 */
import { readStorage, writeStorage } from "./storage.ts";

export const PANEL_WIDTH = { min: 320, max: 1024, default: 480 };
const WIDTH_KEY = "piano.panelWidth";

export const clampPanelWidth = (width: number): number =>
  Math.round(Math.min(PANEL_WIDTH.max, Math.max(PANEL_WIDTH.min, width)));

export function readPanelWidth(): number {
  const raw = Number(readStorage(WIDTH_KEY));
  return Number.isFinite(raw) && raw > 0 ? clampPanelWidth(raw) : PANEL_WIDTH.default;
}

export function writePanelWidth(width: number): void {
  writeStorage(WIDTH_KEY, String(clampPanelWidth(width)));
}
