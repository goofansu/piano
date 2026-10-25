/**
 * `text` cut to at most `max` UTF-16 units, never between the two halves of a surrogate pair: a
 * lone half shows as a replacement character and is not well-formed Unicode in JSON. A character
 * straddling the limit is left out whole. Text within the limit is returned as is.
 */
export const cutText = (text: string, max: number): string => {
  if (text.length <= max) return text;
  const high = max > 0 && (text.charCodeAt(max - 1) & 0xfc00) === 0xd800;
  return text.slice(0, high ? max - 1 : max);
};
