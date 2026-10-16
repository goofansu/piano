/**
 * The command palette's contents, decided once: which groups it shows, in what order, and each row's
 * name, search text and marks. `CommandPalette` only renders them; cmdk filters rows by `value` and
 * `keywords` with `paletteFilter`, the same scores that order rows and groups here.
 */

import { defaultFilter } from "cmdk";
import type { AppState } from "../store.ts";
import { abbrevHome } from "./format.ts";
import type { GlobalCommand } from "./globalCommands.ts";
import { recentSessions, type SessionEntry } from "./sessionCatalog.ts";
import type { SessionCommand } from "./sessionCommands.ts";
import { displayPath, type SessionFile, sessionFiles, splitPath } from "./sessionFiles.ts";
import { displayUrl, type SessionLink, sessionLinks } from "./sessionLinks.ts";

/**
 * A row's own search text always outranks a match that needs a hidden alias. Keep cmdk's fuzzy
 * label search, but require word prefixes for aliases: "dark theme" works, while "path" cannot
 * stitch letters from "appearance theme". cmdk and `commandPalette`'s ranking use this same filter.
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
  /** cmdk's search text: the title, folder, branch, project and session ID. */
  value: string;
  keywords: string[];
  /** The title, or "Untitled". */
  label: string;
  untitled: boolean;
  /** The session on screen, which the row names in bold. */
  selected: boolean;
  folder: string;
  /** The branch, shown only for a session in one of its folder's worktrees. */
  branch: string | undefined;
  session: SessionEntry;
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
  /** cmdk's search text: the label and the URL. */
  value: string;
  keywords: string[];
  /** The URL as shown, without its scheme. */
  display: string;
  link: SessionLink;
}

export interface PaletteFileRow {
  key: string;
  /** cmdk's search text: the path as shown. */
  value: string;
  keywords: string[];
  /** The file name, and the directory as shown: relative to the session's directory when inside it. */
  name: string;
  dir: string;
  file: SessionFile;
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
  search: string;
  /** Global commands as the host provides them, with the same context as the sidebar's View menu. */
  globalCommands: readonly GlobalCommand[];
  /** The selected session's commands. */
  sessionCommands: readonly SessionCommand[];
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
    selected: t.selected,
    folder: t.folder,
    branch: t.branch && t.inWorktree ? t.branch : undefined,
    session: t,
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
    link,
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
    file,
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
 * The palette's groups: sessions (the most recent few, titled "Recent sessions", until a search
 * reaches them all), Global commands, then, only while a session is selected, Session commands and
 * Files (the latest few the session wrote, until a search reaches them all; `FILES_QUERY` lists
 * only them) and Links (likewise for the links the conversation mentions, on `LINKS_QUERY`). Every session
 * that is not archived is reachable, including those whose folder is closed. A search ranks rows
 * within each group, and groups by their best row; ties keep that order.
 */
export function commandPalette(state: AppState, input: PaletteInput): PaletteGroup[] {
  const searching = !!input.search.trim();
  const sessions = recentSessions(state);
  const groups: PaletteGroup[] = [];
  if (sessions.length > 0)
    groups.push({
      id: "sessions",
      heading: searching ? "Sessions" : "Recent sessions",
      rows: (searching ? sessions : sessions.slice(0, RECENT_SESSION_LIMIT)).map(sessionRow),
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
    const files = sessionFiles(state.session.messages).reverse();
    if (files.length > 0)
      groups.push({
        id: "files",
        heading: "Files",
        rows: (searching ? files : files.slice(0, RECENT_FILE_LIMIT)).map((file) =>
          fileRow(file, state.session?.cwd),
        ),
      });
    const links = sessionLinks(state.session.messages).reverse();
    if (links.length > 0)
      groups.push({
        id: "links",
        heading: "Links",
        rows: (searching ? links : links.slice(0, RECENT_LINK_LIMIT)).map(linkRow),
      });
  }
  if (!searching) return groups;
  // cmdk sorts the mounted DOM before newly matching items appear, and leaves groups in React's
  // order. Rank both here, so a row revealed by this query is already in the right place.
  const best = new Map<PaletteGroup["id"], number>();
  for (const group of groups) {
    const scores = new Map(
      group.rows.map((row) => [row.key, paletteFilter(row.value, input.search, row.keywords)]),
    );
    group.rows.sort((a, b) => scores.get(b.key)! - scores.get(a.key)!);
    best.set(group.id, Math.max(0, ...scores.values()));
  }
  return groups.sort((a, b) => best.get(b.id)! - best.get(a.id)!);
}
