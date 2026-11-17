import { defaultFilter } from "cmdk";
import { type AppState, sessionKey } from "../store.ts";
import type { GlobalCommand } from "./globalCommands.ts";
import {
  openProjectCommand,
  type ProjectCommand,
  projectDestinations,
  type SessionProjectMenu,
} from "./projectCommands.ts";
import { createSessionCatalog, recentSessions, type SessionEntry } from "./sessionCatalog.ts";
import { type SessionCommand, type SessionMenuSection, sessionRowMenu } from "./sessionCommands.ts";

export function paletteFilter(value: string, search: string, keywords?: string[]): number {
  const query = search.trim().toLowerCase();
  const label = defaultFilter(value, query);
  if (label > 0) return 0.5 + label / 2;
  const parts = query.split(/\s+/);
  const matchesWords = (text: string) => {
    const words = text.toLowerCase().split(/\s+/);
    return parts.every((part) => words.some((word) => word.startsWith(part)));
  };
  if (matchesWords(value)) return 0.75;
  return keywords?.length && matchesWords([value, ...keywords].join(" ")) ? 0.5 : 0;
}

export const PALETTE_NAME = "Search sessions, projects and commands";

const PROJECTS_TOKEN = "!p";
export const PROJECTS_ONLY = {
  label: "Projects only",
  token: PROJECTS_TOKEN,
  text: `${PROJECTS_TOKEN} `,
} as const;
const PALETTE_FILTERS = [PROJECTS_ONLY] as const;

export interface PaletteFilterRow {
  key: string;
  value: string;
  keywords: undefined;
  label: string;
  token: string;
  text: string;
}

export const PALETTE_FILTER_GROUP: Extract<PaletteGroup, { id: "filters" }> = {
  id: "filters",
  heading: "Filters",
  rows: PALETTE_FILTERS.map((filter) => ({
    key: filter.token,
    value: filter.label,
    keywords: undefined,
    ...filter,
  })),
};

export function paletteScope(search: string): {
  query: string;
  group?: "projects";
  filters?: true;
} {
  const trimmed = search.trim();
  if (trimmed === "!") return { query: "", filters: true };
  const rest = trimmed.slice(PROJECTS_TOKEN.length);
  if (!trimmed.startsWith(PROJECTS_TOKEN) || /^\S/.test(rest)) return { query: trimmed };
  return { query: rest.trim(), group: "projects" };
}

const RECENT_SESSION_LIMIT = 8;

export function beforeSearch<
  G extends { id: PaletteGroup["id"]; heading: string; rows: { searchOnly?: boolean }[] },
>(group: G): G {
  const rows = group.rows.filter((row) => !row.searchOnly);
  return group.id === "sessions"
    ? ({ ...group, heading: "Recent sessions", rows: rows.slice(0, RECENT_SESSION_LIMIT) } as G)
    : ({ ...group, rows } as G);
}

export interface PaletteSessionRow {
  key: string;
  value: string;
  keywords: string[];
  label: string;
  untitled: boolean;
  hint: string | undefined;
  selected: boolean;
  folder: string;
  session: Pick<SessionEntry, "cwd" | "sessionId">;
}

type PaletteCommand = GlobalCommand | SessionCommand | ProjectCommand;

export interface PaletteCommandRow<C extends PaletteCommand> {
  key: string;
  value: string;
  keywords: string[] | undefined;
  label: string;
  detail: string | undefined;
  checked: boolean;
  enabled: boolean;
  searchOnly?: boolean;
  command: C;
}

export type PaletteSessionCommandRow =
  | (PaletteCommandRow<SessionCommand> & { kind: "session" })
  | (PaletteCommandRow<ProjectCommand> & { kind: "project" });

export type PaletteGroup =
  | { id: "sessions"; heading: "Recent sessions" | "Sessions"; rows: PaletteSessionRow[] }
  | { id: "projects"; heading: "Projects"; rows: PaletteCommandRow<ProjectCommand>[] }
  | { id: "global"; heading: "Global commands"; rows: PaletteCommandRow<GlobalCommand>[] }
  | { id: "filters"; heading: "Filters"; rows: PaletteFilterRow[] }
  | {
      id: "session";
      heading: "Session commands";
      rows: PaletteSessionCommandRow[];
    };

export interface PaletteInput {
  globalCommands: readonly GlobalCommand[];
  sessionCommands: readonly SessionCommand[];
  sessionProject?: SessionProjectMenu;
}

function sessionRow(t: SessionEntry): PaletteSessionRow {
  const project = t.project?.name ?? "";
  const { label } = t;
  return {
    key: sessionKey(t),
    value: `${label} ${t.folder} ${t.branch} ${project} ${t.sessionId}`,
    keywords: [t.folder, t.branch, project],
    label,
    untitled: !t.title,
    hint: t.hint,
    selected: t.selected,
    folder: t.folder,
    session: { cwd: t.cwd, sessionId: t.sessionId },
  };
}

function commandRow<C extends PaletteCommand>(c: C, key: string = c.id): PaletteCommandRow<C> {
  return {
    key,
    value: c.label,
    keywords: "keywords" in c && c.keywords ? [...c.keywords] : undefined,
    label: c.label,
    detail: "detail" in c ? c.detail : undefined,
    checked: "checked" in c && !!c.checked,
    enabled: c.enabled,
    command: c,
  };
}

function projectRows(menu: SessionProjectMenu): PaletteSessionCommandRow[] {
  const choice = (command: ProjectCommand, name: string) => ({
    ...command,
    label: `${menu.entry.label}: ${name}`,
  });
  const row = (command: ProjectCommand, key: string) => ({
    ...commandRow(command, key),
    kind: "project" as const,
  });
  return [
    ...(menu.open ? [row(menu.open, "project:open")] : []),
    row(choice(menu.create, menu.create.label), "project:new"),
    ...menu.destinations.map((d) => ({
      ...row(choice(d.command, d.project.name), `project:${d.project.id}`),
      searchOnly: true,
    })),
    ...(menu.remove ? [row(menu.remove, "project:remove")] : []),
  ];
}

function sessionRows(input: PaletteInput): PaletteSessionCommandRow[] {
  const shown = input.sessionCommands.filter((c) => !c.hidden);
  const row = (c: SessionCommand): PaletteSessionCommandRow => ({
    ...commandRow(c),
    kind: "session",
  });
  const flat = (sections: SessionMenuSection[]) =>
    sections.flatMap((s) =>
      s !== "project" ? s.map(row) : input.sessionProject ? projectRows(input.sessionProject) : [],
    );
  const { sections } = sessionRowMenu(shown);
  const slot = sections.indexOf("project");
  const menu = new Set(sections.flatMap((s) => (s === "project" ? [] : s)));
  const first = shown.findIndex((c) => menu.has(c));
  const at = first < 0 ? shown.length : first;
  const others = (cs: SessionCommand[]) => cs.filter((c) => !menu.has(c)).map(row);
  return [
    ...others(shown.slice(0, at)),
    ...flat(sections.slice(0, slot + 1)),
    ...others(shown.slice(at)),
    ...flat(sections.slice(slot + 1)),
  ];
}

function commandPalette(
  state: AppState,
  input: PaletteInput,
  sessions: PaletteSessionRow[],
): PaletteGroup[] {
  const groups: PaletteGroup[] = [];
  if (sessions.length > 0)
    groups.push({
      id: "sessions",
      heading: "Sessions",
      rows: sessions,
    });
  const projects = projectDestinations(state, undefined, { keepCurrent: true });
  if (projects.length > 0)
    groups.push({
      id: "projects",
      heading: "Projects",
      rows: projects.map((project) =>
        commandRow({ ...openProjectCommand(project), label: project.name }, project.id),
      ),
    });
  groups.push({
    id: "global",
    heading: "Global commands",
    rows: input.globalCommands.map((c) => commandRow(c)),
  });
  if (state.view.kind === "session" && state.session) {
    groups.push({
      id: "session",
      heading: "Session commands",
      rows: sessionRows(input),
    });
  }
  return groups;
}

function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every(
    (k) => Object.hasOwn(b, k) && sameData(a[k as keyof typeof a], b[k as keyof typeof b]),
  );
}

function sameRows(a: readonly object[], b: readonly object[]): boolean {
  return a === b || (a.length === b.length && a.every((row, i) => sameData(row, b[i])));
}

export function createPaletteCatalog() {
  const sessionsOf = createSessionCatalog();
  let entries: SessionEntry[] = [];
  let sessions: PaletteSessionRow[] = [];
  let previous: PaletteGroup[] = [];
  return (state: AppState, input: PaletteInput): PaletteGroup[] => {
    const catalog = sessionsOf(state);
    if (catalog !== entries) {
      entries = catalog;
      const updated = recentSessions(catalog).map(sessionRow);
      if (!sameRows(updated, sessions)) sessions = updated;
    }
    const groups = commandPalette(state, input, sessions).map((group) => {
      const old = previous.find((g) => g.id === group.id);
      return old && sameData(old, group) ? old : group;
    });
    if (groups.length === previous.length && groups.every((g, i) => g === previous[i]))
      return previous;
    previous = groups;
    return groups;
  };
}
