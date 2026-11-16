import { readStorage, writeStorage } from "./storage.ts";

export const PANEL_WIDTH = { min: 400, max: 1024, default: 480 };
export const RAIL_WIDTH = 320;
export const AGENT_MIN_WIDTH = 448;
export const SPLIT_MIN_WIDTH = AGENT_MIN_WIDTH + PANEL_WIDTH.min + 1;
const WIDTH_KEY = "piano.panelWidth";

export const singleArea = (width: number): boolean | undefined =>
  width > 0 ? width < SPLIT_MIN_WIDTH : undefined;

export const clampPanelWidth = (width: number): number =>
  Math.round(Math.min(PANEL_WIDTH.max, Math.max(PANEL_WIDTH.min, width)));

export function readPanelWidth(): number {
  const raw = Number(readStorage(WIDTH_KEY));
  return Number.isFinite(raw) && raw > 0 ? clampPanelWidth(raw) : PANEL_WIDTH.default;
}

export function writePanelWidth(width: number): void {
  writeStorage(WIDTH_KEY, String(clampPanelWidth(width)));
}
