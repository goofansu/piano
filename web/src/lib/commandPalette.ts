/**
 * The command palette's contents, decided once: which groups it shows, in what order, and each row's
 * name, search text and marks. Search runs outside cmdk, so only a bounded page becomes components.
 */

import { defaultFilter } from "cmdk";
import type { AppState } from "../store.ts";
import { abbrevHome } from "./format.ts";
import type { GlobalCommand } from "./globalCommands.ts";
import { recentSessions, type SessionEntry } from "./sessionCatalog.ts";
import type { SessionCommand } from "./sessionCommands.ts";
import { displayPath, type SessionFile, splitPath } from "./sessionFiles.ts";
import { displayUrl, type SessionLink, sessionLinks } from "./sessionLinks.ts";

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

/** Before a search the palette offers this many recent sessions; a search reaches every one. */
export const RECENT_SESSION_LIMIT = 8;
/** Before a search the palette offers this many of the session's latest links; a search reaches every one. */
export const RECENT_LINK_LIMIT = 5;
/** The query that lists every link and only links; a plain word would also fuzzy-match sessions. */
export const LINKS_QUERY = "!links";
/** Before a search the palette offers this many of the session's latest files; a search reaches every one. */
export const RECENT_FILE_LIMIT = 5;
/** The query that lists every file the session wrote and only those. */
export const FILES_QUERY = "!files";

export interface PaletteSessionRow {
  key: string;
  /** Search text: the title, folder, branch, project and session ID. */
  value: string;
  keywords: string[];
  /** The title, or "Untitled". */
  label: string;
  untitled: boolean;
  /** Availability comes from the session catalog, just as it does for the sidebar. */
  enabled: boolean;
  hint: string | undefined;
  /** The session on screen, which the row names in bold. */
  selected: boolean;
  folder: string;
  /** The branch, shown only for a session in one of its folder's worktrees. */
  branch: string | undefined;
  session: Pick<SessionEntry, "cwd" | "sessionId">;
}

export interface PaletteCommandRow<C extends GlobalCommand | SessionCommand> {
  key: string;
  value: string;
  keywords: string[] | undefined;
  label: string;
  /** Secondary text after the label: a path. */
  detail: string | undefined;
  /** The current choice of its kind (appearance, grouping, sort, session display). */
  checked: boolean;
  enabled: boolean;
  command: C;
}

export interface PaletteLinkRow {
  key: string;
  /** Search text: the label and the URL. */
  value: string;
  keywords: string[];
  /** The URL as shown, without its scheme. */
  display: string;
  link: Pick<SessionLink, "url" | "label">;
}

export interface PaletteFileRow {
  key: string;
  /** cmdk's search text: the path as shown. */
  value: string;
  keywords: string[];
  /** The file name, and the directory as shown: relative to the session's directory when inside it. */
  name: string;
  dir: string;
  file: Pick<SessionFile, "path">;
}

export type PaletteGroup =
  | { id: "sessions"; heading: "Recent sessions" | "Sessions"; rows: PaletteSessionRow[] }
  | { id: "global"; heading: "Global commands"; rows: PaletteCommandRow<GlobalCommand>[] }
  | { id: "session"; heading: "Session commands"; rows: PaletteCommandRow<SessionCommand>[] }
  /** The selected session's web links, each opened in a new tab. */
  /** The files the selected session wrote or edited, each opened in the file viewer. */
  | { id: "files"; heading: "Files"; rows: PaletteFileRow[] }
  | { id: "links"; heading: "Links"; rows: PaletteLinkRow[] };

export interface PaletteInput {
  /** Global commands as the host provides them, with the same context as the sidebar's View menu. */
  globalCommands: readonly GlobalCommand[];
  /** The selected session's commands. */
  sessionCommands: readonly SessionCommand[];
  /** The files the selected session wrote, in conversation order, as `useSessionFiles` resolves them. */
  files: readonly SessionFile[];
}

function sessionRow(t: SessionEntry): PaletteSessionRow {
  const project = t.project?.name ?? "";
  const label = t.title || "Untitled";
  return {
    key: `${t.cwd}\n${t.sessionId}`,
    value: `${label} ${t.folder} ${t.branch} ${project} ${t.sessionId}`,
    keywords: [t.folder, t.branch, project],
    label,
    untitled: !t.title,
    enabled: !t.disabled,
    hint: t.hint,
    selected: t.selected,
    folder: t.folder,
    branch: t.branch && t.inWorktree ? t.branch : undefined,
    session: { cwd: t.cwd, sessionId: t.sessionId },
  };
}

/**
 * The words a URL is searched by after `LINKS_QUERY`, where aliases match by word prefix: the shown
 * URL ("github.com/…", "localhost:3036/…"), its host, port and path segments ("vite-dev"), and each
 * run of letters or digits ("dev", "26674"), so "!link localhost" and "!link vite" each reach their
 * link.
 */
function urlWords(url: string): string[] {
  const shown = displayUrl(url);
  const segments = shown.split(/[/:?#&=]+/);
  return [shown, ...segments, ...shown.split(/[^\p{L}\p{N}]+/u)].filter(Boolean);
}

function linkRow(link: SessionLink): PaletteLinkRow {
  return {
    key: link.url,
    value: `${link.label ?? ""} ${link.url}`,
    // "!link" reaches every row and nothing else: no title, folder or command contains "!".
    keywords: [LINKS_QUERY, link.url, ...urlWords(link.url)],
    display: displayUrl(link.url),
    link: { url: link.url, label: link.label },
  };
}

/** The words a file is searched by after `FILES_QUERY`: the shown path, its segments and each run of
 * letters or digits, so "!files app" and "!files src" each reach src/app.ts. */
function fileRow(file: SessionFile, cwd: string | undefined): PaletteFileRow {
  const shown = displayPath(file.path, cwd, abbrevHome);
  const { name, dir } = splitPath(shown);
  return {
    key: file.path,
    value: shown,
    keywords: [FILES_QUERY, ...shown.split("/"), ...shown.split(/[^\p{L}\p{N}]+/u)].filter(Boolean),
    name,
    dir,
    file: { path: file.path },
  };
}

function commandRow<C extends GlobalCommand | SessionCommand>(c: C): PaletteCommandRow<C> {
  return {
    key: c.id,
    value: c.label,
    keywords: c.keywords ? [...c.keywords] : undefined,
    label: c.label,
    detail: "detail" in c ? c.detail : undefined,
    checked: !!c.checked,
    enabled: c.enabled,
    command: c,
  };
}

/**
 * Full searchable catalog, with sessions newest first. Search/paging chooses the visible rows;
 * this preparation does not depend on a query. Closed-folder sessions remain reachable.
 */
export function commandPalette(
  state: AppState,
  input: PaletteInput,
  sessions = recentSessions(state).map(sessionRow),
  links = sessionLinks(state.session?.messages ?? [])
    .reverse()
    .map(linkRow),
): PaletteGroup[] {
  const groups: PaletteGroup[] = [];
  if (sessions.length > 0)
    groups.push({
      id: "sessions",
      heading: "Sessions",
      rows: sessions,
    });
  groups.push({
    id: "global",
    heading: "Global commands",
    rows: input.globalCommands.map(commandRow),
  });
  if (state.view.kind === "session" && state.session) {
    groups.push({
      id: "session",
      heading: "Session commands",
      rows: input.sessionCommands.map(commandRow),
    });
    // Newest first, like Recent sessions; the popovers keep conversation order.
    const files = [...input.files].reverse();
    if (files.length > 0)
      groups.push({
        id: "files",
        heading: "Files",
        rows: files.map((file) => fileRow(file, state.session?.cwd)),
      });
    if (links.length > 0)
      groups.push({
        id: "links",
        heading: "Links",
        rows: links,
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
  let messages: unknown;
  let links: PaletteLinkRow[] = [];
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
    if (messages !== state.session?.messages) {
      messages = state.session?.messages;
      links = sessionLinks(state.session?.messages ?? [])
        .reverse()
        .map(linkRow);
    }
    const groups = commandPalette(state, input, sessions, links).map((group) => {
      const old = previous.find((g) => g.id === group.id);
      // Streaming often changes the source objects of commands, files and links without
      // changing any searchable value, action, or availability.
      return old && old.heading === group.heading && sameRows(old.rows, group.rows) ? old : group;
    });
    if (groups.length === previous.length && groups.every((g, i) => g === previous[i]))
      return previous;
    previous = groups;
    return groups;
  };
}
