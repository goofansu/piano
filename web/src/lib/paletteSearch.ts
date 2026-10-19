import {
  type PaletteGroup,
  paletteFilter,
  RECENT_FILE_LIMIT,
  RECENT_LINK_LIMIT,
  RECENT_SESSION_LIMIT,
} from "./commandPalette.ts";

export const PALETTE_PAGE_SIZE = 50;
export type PalettePages = Partial<Record<PaletteGroup["id"], number>>;
export interface PaletteDocuments {
  id: PaletteGroup["id"];
  heading: PaletteGroup["heading"];
  rows: (Pick<PaletteGroup["rows"][number], "key" | "value" | "keywords"> & {
    searchOnly?: boolean;
  })[];
}
export interface PalettePage<G extends PaletteDocuments = PaletteGroup> {
  group: G;
  page: number;
  total: number;
}

/** One relevance policy for the worker and module checks. Stable ties retain catalog order. */
export function searchPalette<G extends PaletteDocuments>(
  groups: readonly G[],
  search: string,
): G[] {
  const query = search.trim();
  if (!query)
    return groups.map((group) => {
      const limit =
        group.id === "sessions"
          ? RECENT_SESSION_LIMIT
          : group.id === "files"
            ? RECENT_FILE_LIMIT
            : group.id === "links"
              ? RECENT_LINK_LIMIT
              : Infinity;
      return {
        ...group,
        heading: group.id === "sessions" ? "Recent sessions" : group.heading,
        rows: group.rows.filter((row) => !row.searchOnly).slice(0, limit),
      } as G;
    });
  return groups
    .map((group) => {
      const matches = group.rows
        .map((row) => ({ row, score: paletteFilter(row.value, query, row.keywords) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score);
      return {
        group: { ...group, rows: matches.map(({ row }) => row) } as G,
        score: matches[0]?.score ?? 0,
      };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ group }) => group);
}

/** Replace a page rather than append: all matches remain reachable, DOM size stays bounded. */
export function pagePalette<G extends PaletteDocuments>(
  groups: readonly G[],
  pages: PalettePages = {},
): PalettePage<G>[] {
  return groups.map((group) => {
    const total = group.rows.length;
    const page = Math.max(
      0,
      Math.min(pages[group.id] ?? 0, Math.ceil(total / PALETTE_PAGE_SIZE) - 1),
    );
    return {
      group: {
        ...group,
        rows: group.rows.slice(page * PALETTE_PAGE_SIZE, (page + 1) * PALETTE_PAGE_SIZE),
      } as G,
      page,
      total,
    };
  });
}

/** Background catalog refreshes keep a still-valid keyboard choice, including paging controls. */
export function paletteSelection(
  pages: readonly PalettePage[],
  selected: string,
  reset: boolean,
): string {
  const valid = new Set<string>();
  let first = "";
  for (const { group, page, total } of pages) {
    for (const row of group.rows) {
      if ("enabled" in row && !row.enabled) continue;
      const value = `${group.id}:${row.key}`;
      valid.add(value);
      first ||= value;
    }
    if (page > 0) valid.add(`${group.id}:previous`);
    if ((page + 1) * PALETTE_PAGE_SIZE < total) valid.add(`${group.id}:next`);
  }
  return !reset && valid.has(selected) ? selected : first;
}

export interface PaletteSearchRequest {
  id: number;
  query: string;
  pages: PalettePages;
  /** Sent only when the catalog changes, not on each keystroke or page. */
  groups?: PaletteDocuments[];
}
export interface PaletteSearchReply {
  id: number;
  pages: PalettePage<PaletteDocuments>[];
}

/** Worker-owned catalog and last ranking: paging never repeats the fuzzy scan. */
export function createPaletteSearch() {
  let groups: PaletteDocuments[] = [];
  let query: string | undefined;
  let ranked: PaletteDocuments[] = [];
  return (request: PaletteSearchRequest): PaletteSearchReply => {
    if (request.groups) groups = request.groups;
    if (request.groups || request.query !== query) {
      query = request.query;
      ranked = searchPalette(groups, query);
    }
    return { id: request.id, pages: pagePalette(ranked, request.pages) };
  };
}
