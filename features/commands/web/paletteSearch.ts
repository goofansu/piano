import {
  beforeSearch,
  PALETTE_FILTER_GROUP,
  type PaletteGroup,
  paletteFilter,
  paletteScope,
} from "./paletteModel.ts";

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

type PaletteFilterGroup = typeof PALETTE_FILTER_GROUP;

export function searchPalette<G extends PaletteDocuments>(
  groups: readonly G[],
  search: string,
): (G | PaletteFilterGroup)[] {
  const { query, group: only, filters } = paletteScope(search);
  if (filters) return [PALETTE_FILTER_GROUP];
  const scoped = only ? groups.filter((group) => group.id === only) : groups;
  if (!query) return scoped.map(beforeSearch);
  return scoped
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

export function paletteItemValue(group: PaletteGroup["id"], key: string): string {
  return `${group}:${key}`;
}

type PaletteRowItem<G> = G extends PaletteGroup
  ? { kind: "row"; group: G["id"]; row: G["rows"][number]; value: string; enabled: boolean }
  : never;
export type PaletteItem =
  | { kind: "previous" | "next"; value: string; label: string; page: number }
  | PaletteRowItem<PaletteGroup>;

export function paletteItems({ group, page, total }: PalettePage): {
  heading: string;
  items: PaletteItem[];
} {
  const control = (kind: "previous" | "next", to: number) => ({
    kind,
    value: paletteItemValue(group.id, kind),
    label: `${kind === "previous" ? "Previous" : "Next"} ${group.heading.toLowerCase()}`,
    page: to,
  });
  const items: PaletteItem[] = [];
  if (page > 0) items.push(control("previous", page - 1));
  for (const row of group.rows)
    items.push({
      kind: "row",
      group: group.id,
      row,
      value: paletteItemValue(group.id, row.key),
      enabled: !("enabled" in row) || row.enabled,
    } as PaletteItem);
  const end = (page + 1) * PALETTE_PAGE_SIZE;
  if (end < total) items.push(control("next", page + 1));
  const heading =
    total > PALETTE_PAGE_SIZE
      ? `${group.heading} · ${page * PALETTE_PAGE_SIZE + 1}–${Math.min(end, total)} of ${total}`
      : group.heading;
  return { heading, items };
}

export function paletteSelection(
  pages: readonly PalettePage[],
  selected: string,
  reset: boolean,
): string {
  const valid = new Set<string>();
  let first = "";
  for (const page of pages)
    for (const item of paletteItems(page).items) {
      if (item.kind === "row" && !item.enabled) continue;
      valid.add(item.value);
      if (item.kind === "row") first ||= item.value;
    }
  return !reset && valid.has(selected) ? selected : first;
}

export interface PaletteSearchRequest {
  id: number;
  query: string;
  pages: PalettePages;
  groups?: PaletteDocuments[];
}
export interface PaletteSearchReply {
  id: number;
  pages: PalettePage<PaletteDocuments>[];
}

const rankings = new WeakMap<readonly PaletteDocuments[], { query: string; ranked: unknown[] }>();

export function answerPalette<G extends PaletteDocuments>(
  groups: readonly G[],
  query: string,
  pages: PalettePages = {},
): PalettePage<G | PaletteFilterGroup>[] {
  let ranking = rankings.get(groups);
  if (ranking?.query !== query) {
    ranking = { query, ranked: searchPalette(groups, query) };
    rankings.set(groups, ranking);
  }
  return pagePalette(ranking.ranked as (G | PaletteFilterGroup)[], pages);
}

export function createPaletteSearch() {
  let groups: PaletteDocuments[] = [];
  return (request: PaletteSearchRequest): PaletteSearchReply => {
    if (request.groups) groups = request.groups;
    return { id: request.id, pages: answerPalette(groups, request.query, request.pages) };
  };
}
