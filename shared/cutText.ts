/**
 * Return a prefix of at most `max` UTF-16 code units; `max` must be a nonnegative integer.
 * If the cut would leave a high surrogate at the end, omit it rather than split a surrogate
 * pair. Text within the limit is unchanged; this does not repair malformed input or preserve
 * whole grapheme clusters.
 */
export const cutText = (text: string, max: number): string => {
  if (text.length <= max) return text;
  const high = max > 0 && (text.charCodeAt(max - 1) & 0xfc00) === 0xd800;
  return text.slice(0, high ? max - 1 : max);
};
