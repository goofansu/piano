/**
 * Application viewport presentation, not session capacity (panelLayout) or pointer capability.
 * CSS md uses 48rem, corresponding to 768px at the default 16px media-query baseline; keep px
 * semantics here. Upstream use-mobile.ts remains owned by shadcn, not by this module.
 */
export const VIEWPORT_BREAKPOINT = 768;
export const WIDE_VIEWPORT_QUERY = `(min-width: ${VIEWPORT_BREAKPOINT}px)`;
/** Preserve the header's existing subscription boundary, including its fractional-width gap. */
export const HEADER_NARROW_VIEWPORT_QUERY = `(max-width: ${VIEWPORT_BREAKPOINT - 1}px)`;
