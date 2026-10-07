// Alignment companion to cmdk 1.1.1's defaultFilter. cmdk still owns filtering and sorting.
// Adapted from cmdk's command-score implementation; see commandMatch.LICENSE.
export function commandMatch(value: string, search: string): { score: number; indices: number[] } {
  const normalize = (text: string) => text.toLowerCase().replace(/[\s-]/g, " ");
  const text = normalize(value);
  const query = normalize(search);
  const memo = new Map<string, { score: number; indices: number[] }>();
  function visit(start: number, offset: number): { score: number; indices: number[] } {
    if (offset === query.length) return { score: start === text.length ? 1 : 0.99, indices: [] };
    const key = `${start},${offset}`;
    const cached = memo.get(key);
    if (cached) return cached;
    let best = { score: 0, indices: [] as number[] };
    for (let at = text.indexOf(query.charAt(offset), start); at >= 0; at = text.indexOf(query.charAt(offset), at + 1)) {
      const tail = visit(at + 1, offset + 1);
      let score = tail.score;
      let indices = [at, ...tail.indices];
      if (score > best.score) {
        if (at !== start) {
          const previous = value.charAt(at - 1);
          const skipped = value.slice(start, at - 1);
          if (/[\\\/_+.#"@\[({&]/.test(previous)) {
            score *= 0.8;
            if (start > 0) score *= 0.999 ** (skipped.match(/[\\\/_+.#"@\[({&]/g)?.length ?? 0);
          } else if (/[\s-]/.test(previous)) {
            score *= 0.9;
            if (start > 0) score *= 0.999 ** (skipped.match(/[\s-]/g)?.length ?? 0);
          } else {
            score *= 0.17;
            if (start > 0) score *= 0.999 ** (at - start);
          }
        }
        if (value.charAt(at) !== search.charAt(offset)) score *= 0.9999;
      }
      // cmdk also accepts adjacent transpositions and a repeated query character.
      if ((score < 0.1 && text.charAt(at - 1) === query.charAt(offset + 1)) ||
          (query.charAt(offset + 1) === query.charAt(offset) && text.charAt(at - 1) !== query.charAt(offset))) {
        const transposed = visit(at + 1, offset + 2);
        if (transposed.score * 0.1 > score) {
          score = transposed.score * 0.1;
          indices = [...(text.charAt(at - 1) === query.charAt(offset + 1) ? [at - 1] : []), at, ...transposed.indices];
        }
      }
      if (score > best.score) best = { score, indices };
    }
    memo.set(key, best);
    return best;
  }
  return search ? visit(0, 0) : { score: 1, indices: [] };
}
