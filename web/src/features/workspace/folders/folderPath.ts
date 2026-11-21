import type { DirListing } from "../../../../../shared/wire.ts";

type DirEntry = DirListing["entries"][number];

export const MAX_VISIBLE = 500;

export function parsePathInput(input: string): { dirPath: string; prefix: string } {
  if (input.endsWith("/")) return { dirPath: input.slice(0, -1) || "/", prefix: "" };
  const i = input.lastIndexOf("/");
  if (i === -1) return { dirPath: "~", prefix: input };
  if (i === 0) return { dirPath: "/", prefix: input.slice(1) };
  return { dirPath: input.slice(0, i), prefix: input.slice(i + 1) };
}

export function browseInput(path: string): string {
  return path.endsWith("/") ? path : `${path}/`;
}

export function listing(
  entries: readonly DirEntry[],
  prefix: string,
): { matches: readonly DirEntry[]; visible: readonly DirEntry[]; hidden: number } {
  const needle = prefix.toLowerCase();
  const matches = needle ? entries.filter((e) => e.name.toLowerCase().startsWith(needle)) : entries;
  const visible = matches.slice(0, MAX_VISIBLE);
  return { matches, visible, hidden: matches.length - visible.length };
}

export function pickTarget(dirPath: string, matches: readonly DirEntry[], prefix: string): string {
  return prefix && matches.length === 1 ? matches[0].path : dirPath;
}

export function childPath(parent: string, name: string): { path: string } | { error: string } {
  const trimmed = name.trim();
  if (!trimmed) return { error: "Folder name cannot be empty" };
  if (/[\\/]/.test(trimmed)) return { error: "Folder name cannot contain slashes" };
  return { path: `${parent.endsWith("/") ? parent : `${parent}/`}${trimmed}` };
}
