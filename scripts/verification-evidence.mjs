import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { release } from "node:os";
import { isAbsolute, join, relative } from "node:path";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const decode = (bytes) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
const git = (cwd, ...args) => execFileSync("git", args, { cwd, maxBuffer: 32 * 1024 * 1024 });
const limitation =
  "Live checkout, not an immutable snapshot. Endpoint captures cannot exclude transient edits, " +
  "including edits during capture. No claim of complete race detection or automatic evidence reuse.";

export function captureRevision(cwd, { production = false } = {}) {
  const problems = [];
  const entries = [];
  let paths = new Set();
  const visit = (path, recursive = false) => {
    try {
      const stat = lstatSync(join(cwd, path));
      const mode = stat.mode & 0o777;
      if (stat.isSymbolicLink()) {
        entries.push({
          path,
          mode,
          kind: "symlink",
          target: decode(readlinkSync(join(cwd, path), { encoding: "buffer" })),
        });
        try {
          const target = relative(realpathSync(cwd), realpathSync(join(cwd, path)));
          if (
            isAbsolute(target) ||
            target.startsWith("..") ||
            ![...paths].some((p) => p === target || p.startsWith(`${target}/`))
          )
            problems.push(`Symlink target outside captured paths: ${path}`);
        } catch (error) {
          problems.push(`Unresolved symlink ${path}: ${error.message}`);
        }
      } else if (stat.isFile()) {
        entries.push({ path, mode, kind: "file", sha256: hash(readFileSync(join(cwd, path))) });
      } else if (stat.isDirectory() && recursive) {
        entries.push({ path, mode, kind: "directory" });
        for (const name of readdirSync(join(cwd, path)).sort()) visit(`${path}/${name}`, true);
      } else {
        entries.push({ path, mode, kind: "unsupported" });
        problems.push(`Unsupported input (including submodules): ${path}`);
      }
    } catch (error) {
      if (error.code === "ENOENT") entries.push({ path, kind: "missing" });
      else problems.push(`${path}: ${error.message}`);
    }
  };
  try {
    const head = git(cwd, "rev-parse", "HEAD").toString().trim();
    const index = decode(git(cwd, "ls-files", "--stage", "-z"));
    if (index.split("\0").some((entry) => entry.startsWith("160000 ")))
      problems.push("Submodule working state is not captured (including uninitialized submodules)");
    paths = new Set(
      decode(git(cwd, "ls-files", "--cached", "--others", "--exclude-standard", "-z"))
        .split("\0")
        .filter(Boolean),
    );
    for (const dir of [".", "web"]) {
      try {
        for (const name of readdirSync(join(cwd, dir)))
          if (name === ".env" || name.startsWith(".env."))
            paths.add(dir === "." ? name : `${dir}/${name}`);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    for (const path of [...paths].sort()) visit(path);
    if (production) visit("web/dist", true);
    entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const scope = {
      version: 1,
      included: [
        "HEAD",
        "index entries/stages",
        "all tracked and non-ignored untracked paths",
        "root/web .env*",
        ...(production ? ["web/dist (recursive)"] : []),
      ],
      excluded: [
        "other ignored files",
        "node_modules bytes (lockfile and installed versions recorded instead)",
        "generated web/public/pdfjs (Vite copies from installed pdfjs-dist)",
        "external configuration and symlink targets outside captured paths",
      ],
      limitation,
    };
    return {
      head,
      identity: hash(JSON.stringify({ scope, head, index, entries })),
      indexSha256: hash(index),
      scope,
      entries,
      problems,
    };
  } catch (error) {
    return {
      identity: null,
      problems: [...problems, String(error)],
      scope: { version: 1, limitation },
    };
  }
}

export function executionEnvironment(cwd, commands = ["npm", "git", "wt"]) {
  const tools = Object.fromEntries(
    commands.map((command) => {
      try {
        return [
          command,
          execFileSync(command, ["--version"], {
            cwd,
            encoding: "utf8",
            timeout: 5000,
            stdio: ["ignore", "pipe", "pipe"],
          }).trim(),
        ];
      } catch (error) {
        return [command, { unavailable: error.message }];
      }
    }),
  );
  const packages = {};
  for (const file of ["package.json", "web/package.json"]) {
    try {
      const manifest = JSON.parse(readFileSync(join(cwd, file), "utf8"));
      for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) {
        try {
          packages[name] = JSON.parse(
            readFileSync(join(cwd, "node_modules", name, "package.json"), "utf8"),
          ).version;
        } catch {
          packages[name] = "unavailable";
        }
      }
    } catch {}
  }
  return {
    node: process.version,
    executable: process.execPath,
    platform: process.platform,
    arch: process.arch,
    osRelease: release(),
    tools,
    packages,
    variables: Object.fromEntries(
      ["CI", "NODE_ENV", "TZ", "LANG", "PIANO_BROWSER_PRODUCTION"]
        .filter((key) => process.env[key] !== undefined)
        .map((key) => [key, process.env[key]]),
    ),
    limitations:
      "Allowlisted environment only; no credentials captured. Installed package bytes, browser extensions, external config and host services are not snapshotted. Use npm ci and an uncontended checkout; report overrides separately.",
  };
}

export function revisionOutcome(before, after) {
  if (!before.identity || !after.identity || before.problems.length || after.problems.length)
    return "unknown";
  return before.identity === after.identity ? "endpoints-match" : "unstable";
}

export function saveRun(evidence, record) {
  const file = join(evidence, "run.json");
  writeFileSync(`${file}.tmp`, JSON.stringify(record, null, 2) + "\n");
  renameSync(`${file}.tmp`, file);
}
