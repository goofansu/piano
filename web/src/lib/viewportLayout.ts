/**
 * Application viewport presentation, not session capacity (panelLayout) or pointer capability.
 * Match CSS md/48rem, including fractional widths and the browser's default font baseline.
 * Upstream use-mobile.ts remains owned by shadcn, not by this module.
 */
const WIDE_VIEWPORT_QUERY = "(min-width: 48rem)";

/** Read the same decision CSS makes; narrow is its logical complement, not a rounded width. */
export const isWideViewport = (): boolean => window.matchMedia(WIDE_VIEWPORT_QUERY).matches;

/** Subscribe independently of sidebar state, which need not change when the viewport crosses. */
export function subscribeViewport(listener: () => void): () => void {
  const media = window.matchMedia(WIDE_VIEWPORT_QUERY);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}
