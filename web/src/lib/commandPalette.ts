/**
 * The command palette's contents, decided once: its name, which groups it shows, in what order,
 * what each shows before a search, the projects-only scope, and each row's name, search text and
 * marks. Search only ranks and pages; the component only renders. Search runs outside cmdk, so
 * only a bounded page becomes components.
 */

import { defaultFilter } from "cmdk";
import { type AppState, sessionKey } from "../store.ts";
import type { GlobalCommand } from "./globalCommands.ts";
import {
  isProjectDone,
  openProjectCommand,
  type ProjectCommand,
  projectDestinations,
  type SessionProjectMenu,
} from "./projectCommands.ts";
import { recentSessions, type SessionEntry } from "./sessionCatalog.ts";
import { type SessionCommand, type SessionMenuSection, sessionRowMenu } from "./sessionCommands.ts";

/**
 * A row's own search text always outranks a match that needs a hidden alias. Keep cmdk's fuzzy
 * label search, but require word prefixes for aliases: "dark theme" works, while "path" cannot
 * stitch letters from "appearance theme". The search worker uses this policy once per row.
 */
export function paletteFilter(value: string, search: string, keywords?: string[]): number {
  const query = search.trim().toLowerCase();
  const label = defaultFilter(value, query);
  if (label > 0) return 0.5 + label / 2;
  const parts = query.split(/\s+/);
  const matchesWords = (text: string) => {
    const words = text.toLowerCase().split(/\s+/);
    return parts.every((part) => words.some((word) => word.startsWith(part)));
  };
  // Word order should not depend on whether a row happens to have aliases.
  if (matchesWords(value)) return 0.75;
  return keywords?.length && matchesWords([value, ...keywords].join(" ")) ? 0.5 : 0;
}

/** The palette's one name: its dialog title, its search field and the sidebar button that opens it. */
export const PALETTE_NAME = "Search sessions, projects and commands";

const PROJECTS_TOKEN = "!p";
/** The project filter: its name, scope token and replacement input text. */
export const PROJECTS_ONLY = {
  label: "Projects only",
  token: PROJECTS_TOKEN,
  text: `${PROJECTS_TOKEN} `,
} as const;
const PALETTE_FILTERS = [PROJECTS_ONLY] as const;

/** A filter row: choosing it writes its `text` into the input, never runs a command. */
export interface PaletteFilterRow {
  key: string;
  value: string;
  keywords: undefined;
  label: string;
  token: string;
  text: string;
}

/** The palette's answer to a trimmed `!`: the filters, as rows like any other group's. */
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

/**
 * What the input asks for. A trimmed `!` discovers filters; a leading, standalone lowercase
 * `!p` scopes to Projects and the rest is the query. Any other text, `!pizza` or `!P` included,
 * is a plain query over every group. Discovery answers with `PALETTE_FILTER_GROUP`, whose rows
 * edit the input, never navigation commands.
 */
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

/** Before a search the palette offers this many recent sessions; a search reaches every one. */
const RECENT_SESSION_LIMIT = 8;

/**
 * A group as it shows before a search: Sessions as the few most recent, and every group without
 * the rows only a search reaches (a project destination).
 */
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
  /** Search text: the title, folder, branch, project and session ID. */
  value: string;
  keywords: string[];
  /** What the session is called on screen, as the catalog labels it. */
  label: string;
  untitled: boolean;
  /** Why the session cannot be used normally, from the catalog. Every row opens: the catalog's
   * `recentSessions` holds only sessions that can be opened. */
  hint: string | undefined;
  /** The session on screen, which the row names in bold. */
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
  /** Secondary text after the label: a path. */
  detail: string | undefined;
  /** The current choice of its kind (appearance, grouping, sort, session display). */
  checked: boolean;
  enabled: boolean;
  /** Left out of the list before a search, as one of an unbounded set (a project destination). */
  searchOnly?: boolean;
  command: C;
}

/** A Session commands row: one of the session's own commands, or one of its project membership rows. */
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
  /** Global commands as the host provides them, with the same context as the sidebar's View menu. */
  globalCommands: readonly GlobalCommand[];
  /** The selected session's commands. */
  sessionCommands: readonly SessionCommand[];
  /** The selected session's project membership, as its header menu offers it. */
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

/**
 * The membership rows, named as the header menu's buttons: the header's project link ("Open
 * project: Launch"), the picker's entry and the choice ("Move to project: Billing"), and Remove
 * from project. Projects are unbounded, so before a search
 * New project stands for the picker and the destinations wait for a search.
 */
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

/**
 * Session commands in descriptor order, with the row menu's sections in its own order: those before
 * its project slot where the first of their commands sits, the membership rows in the slot, and the
 * ones after it (Archive and Delete) last, as both session menus end. A command this screen does
 * not have (`hidden`) is left out rather than greyed.
 */
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

/**
 * Full searchable catalog, with sessions newest first. Search/paging chooses the visible rows;
 * this preparation does not depend on a query. Closed-folder sessions remain reachable.
 */
export function commandPalette(
  state: AppState,
  input: PaletteInput,
  sessions = recentSessions(state).map(sessionRow),
): PaletteGroup[] {
  const groups: PaletteGroup[] = [];
  if (sessions.length > 0)
    groups.push({
      id: "sessions",
      heading: "Sessions",
      rows: sessions,
    });
  const projects = projectDestinations(state, undefined, { keepCurrent: true }).filter(
    (project) => !isProjectDone(project),
  );
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

/**
 * Whether two values hold the same data: primitives by identity, arrays element by element, plain
 * objects key by key. Rows are plain data, so every field a row type gains takes part without
 * listing it here.
 */
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

/** Whether a refresh changed nothing a row shows, searches by or acts on. */
function sameRows(a: readonly object[], b: readonly object[]): boolean {
  return a === b || (a.length === b.length && a.every((row, i) => sameData(row, b[i])));
}

/** Cache catalog preparation across input and streaming updates, without retaining another history. */
export function createPaletteCatalog() {
  let dependencies: unknown[] = [];
  let sessions: PaletteSessionRow[] = [];
  let previous: PaletteGroup[] = [];
  return (state: AppState, input: PaletteInput): PaletteGroup[] => {
    const current = state.session ?? state.selecting;
    // Host activity/done markers are not shown in the palette. Metadata and selection are.
    const next = [
      state.sessionReferences,
      state.folders,
      state.projects,
      current?.cwd,
      current?.sessionId,
    ];
    if (next.some((value, i) => value !== dependencies[i])) {
      dependencies = next;
      const updated = recentSessions(state).map(sessionRow);
      // Registry refreshes replace arrays even when nothing searchable changed. Do not restart
      // the worker or reset pagination/selection on those refreshes (or stats-only changes).
      if (!sameRows(updated, sessions)) sessions = updated;
    }
    const groups = commandPalette(state, input, sessions).map((group) => {
      const old = previous.find((g) => g.id === group.id);
      // Streaming often changes the source objects of commands without changing any searchable
      // value, action, or availability.
      return old && sameData(old, group) ? old : group;
    });
    if (groups.length === previous.length && groups.every((g, i) => g === previous[i]))
      return previous;
    previous = groups;
    return groups;
  };
}
