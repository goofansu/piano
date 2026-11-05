/**
 * The session's area geometry: the Surface area's remembered width beside the Agent area, and the
 * width below which the session shows one area at a time. The width is a preference only while the
 * two sit side by side; one at a time, the Surface area takes the session's full width.
 */
import { readStorage, writeStorage } from "./storage.ts";

export const PANEL_WIDTH = { min: 400, max: 1024, default: 480 };
/** The session rail's fixed width inside the Agent area; narrower than the Surface area's minimum, so it fits wherever that does. */
export const RAIL_WIDTH = 320;
/** The narrowest Agent area that sits beside a surface: a readable column and its composer. */
export const AGENT_MIN_WIDTH = 448;
/**
 * Below this session width (both minimums and the hairline) the areas take turns. It is measured
 * on the areas container after the sidebar and insets, not on the viewport. Preferred Surface
 * width and pointer capability do not choose the mode.
 */
export const SPLIT_MIN_WIDTH = AGENT_MIN_WIDTH + PANEL_WIDTH.min + 1;
const WIDTH_KEY = "piano.panelWidth";

/** One-area-at-a-time below 849 CSS px, without rounding. Zero is unmeasured/hidden: retain the prior mode. */
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
