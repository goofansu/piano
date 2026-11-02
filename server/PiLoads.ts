/**
 * What Pi loads before Piano's own folders. Every Pi child Piano starts loads Piano's prompts and
 * skills folders last (`--prompt-template`, `--skill`), and Pi keeps the first of a name, so a name
 * Pi loads from anywhere else hides Piano's. Pi's own resolver decides that set (INV-12): the
 * `skills` and `prompts` entries in Pi's settings, installed Pi packages, Pi's folders and
 * `~/.agents/skills`, with their `-name` overrides. Piano only reads it: a package that is not
 * installed is skipped, never installed. A repository's resources are not included, since which
 * ones apply depends on the session's folder.
 */
import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, sep } from "node:path";
import {
  DefaultPackageManager,
  loadSkills,
  parseFrontmatter,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

export type LibraryKind = "skill" | "prompt";

/** Whether `path` is `dir` or inside it. */
const within = (path: string, dir: string) => {
  const rest = relative(dir, path);
  return rest !== ".." && !rest.startsWith(`..${sep}`) && !isAbsolute(rest);
};

/**
 * The names of the skills or prompts Pi loads from outside `piano`, Piano's folder for that kind,
 * each with the file Pi loads it from. Pi's settings are read from `agentDir`; `~/.agents/skills`
 * from `HOME`, as Pi itself reads it.
 */
export async function loadedBeforePiano(
  kind: LibraryKind,
  agentDir: string,
  piano: string,
): Promise<ReadonlyMap<string, string>> {
  // Piano's folder's parent as the working directory, untrusted, so no project's resources count.
  const cwd = dirname(piano);
  const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: false });
  const resolved = await new DefaultPackageManager({ cwd, agentDir, settingsManager }).resolve(
    async () => "skip",
  );
  const paths = (kind === "skill" ? resolved.skills : resolved.prompts)
    .filter((resource) => resource.enabled && !within(resource.path, piano))
    .map((resource) => resource.path);
  const found = new Map<string, string>();
  if (kind === "skill") {
    // Pi's own skill loader, which keeps the first skill of a name.
    for (const skill of loadSkills({ cwd, agentDir, skillPaths: paths, includeDefaults: false })
      .skills)
      if (!within(skill.filePath, piano)) found.set(skill.name, skill.filePath);
    return found;
  }
  // Pi does not export its prompt loader; its rule for a resolved file: `<name>.md`, a file or a
  // link to one, whose front matter parses, the first of a name kept.
  for (const path of paths) {
    if (!path.endsWith(".md")) continue;
    const name = basename(path).slice(0, -3);
    if (found.has(name)) continue;
    try {
      if (!statSync(path).isFile()) continue;
      parseFrontmatter(await readFile(path, "utf8"));
      found.set(name, path);
    } catch {
      // Not a prompt Pi loads.
    }
  }
  return found;
}
