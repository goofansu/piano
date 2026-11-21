const WIDE_VIEWPORT_QUERY = "(min-width: 48rem)";

export const isWideViewport = (): boolean => window.matchMedia(WIDE_VIEWPORT_QUERY).matches;

export function subscribeViewport(listener: () => void): () => void {
  const media = window.matchMedia(WIDE_VIEWPORT_QUERY);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}
