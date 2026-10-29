/** Fit a name to its rendered width, sharing the retained graphemes between its two ends.
 * Unlike a file path, neither side of a slash gets priority. */
export function middleEllipsis(
  text: string,
  width: number,
  measure: (value: string) => number,
): string {
  if (width <= 0) return "";
  if (measure(text) <= width) return text;
  if (measure("…") > width) return "";
  const characters = Array.from(new Intl.Segmenter().segment(text), ({ segment }) => segment);
  let result = "…";
  let low = 2;
  let high = characters.length - 1;
  while (low <= high) {
    const keep = Math.floor((low + high) / 2);
    const candidate = `${characters.slice(0, Math.floor(keep / 2)).join("")}…${characters.slice(-Math.ceil(keep / 2)).join("")}`;
    if (measure(candidate) <= width) {
      result = candidate;
      low = keep + 1;
    } else {
      high = keep - 1;
    }
  }
  return result;
}
