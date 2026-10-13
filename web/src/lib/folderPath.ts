/**
 * The folder picker's path model: one text input names both the directory to list and a
 * filter over its subfolders. A trailing slash browses inside that directory; text after the
 * last slash filters the listing by case-insensitive name prefix.
 */
import type { DirListing } from "../../../shared/wire.ts";

type DirEntry = DirListing["entries"][number];

/** Rows rendered at once; the rest are counted so the user knows to keep typing. */
export const MAX_VISIBLE = 500;

/**
 * Splits picker input into the directory to list and the name prefix to filter it by.
 * Input without a slash filters the home directory (`~`).
 */
export function parsePathInput(input: string): { dirPath: string; prefix: string } {
  if (input.endsWith("/")) return { dirPath: input.slice(0, -1) || "/", prefix: "" };
  const i = input.lastIndexOf("/");
  if (i === -1) return { dirPath: "~", prefix: input };
  if (i === 0) return { dirPath: "/", prefix: input.slice(1) };
  return { dirPath: input.slice(0, i), prefix: input.slice(i + 1) };
}

/** Input that browses inside `path`, listing all of its subfolders. */
export function browseInput(path: string): string {
  return path.endsWith("/") ? path : `${path}/`;
}

/** Subfolders matching the prefix, and how many of them fall past the visible cap. */
export function listing(
  entries: readonly DirEntry[],
  prefix: string,
): { matches: readonly DirEntry[]; visible: readonly DirEntry[]; hidden: number } {
  const needle = prefix.toLowerCase();
  const matches = needle ? entries.filter((e) => e.name.toLowerCase().startsWith(needle)) : entries;
  const visible = matches.slice(0, MAX_VISIBLE);
  return { matches, visible, hidden: matches.length - visible.length };
}

/** The folder Enter picks: the single prefix match when there is one, else the listed directory. */
export function pickTarget(dirPath: string, matches: readonly DirEntry[], prefix: string): string {
  return prefix && matches.length === 1 ? matches[0].path : dirPath;
}

/** The path of a new folder `name` inside `parent`, or why the name cannot be used. */
export function childPath(parent: string, name: string): { path: string } | { error: string } {
  const trimmed = name.trim();
  if (!trimmed) return { error: "Folder name cannot be empty" };
  if (/[\\/]/.test(trimmed)) return { error: "Folder name cannot contain slashes" };
  return { path: `${parent.endsWith("/") ? parent : `${parent}/`}${trimmed}` };
}
