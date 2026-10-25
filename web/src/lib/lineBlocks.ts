/** Rows per `lazy-lines` block: few enough that one block lays out quickly, many enough that a
 * 1 MiB file is a few dozen blocks. */
export const BLOCK_ROWS = 500;

/** Consecutive runs of at most `BLOCK_ROWS` items, each with the index of its first item. */
export function lineBlocks<T>(items: readonly T[]): { start: number; items: T[] }[] {
  const blocks: { start: number; items: T[] }[] = [];
  for (let start = 0; start < items.length; start += BLOCK_ROWS)
    blocks.push({ start, items: items.slice(start, start + BLOCK_ROWS) });
  return blocks;
}
