/**
 * What Pi loads before Piano's own folders. Every Pi child Piano starts loads Piano's prompts and
 * skills folders last (`--prompt-template`, `--skill`), and Pi keeps the first of a name, so a name
 * Pi loads from anywhere else hides Piano's. Pi's own resolver decides that set (INV-12): the
 * `skills` and `prompts` entries in Pi's settings, installed Pi packages, Pi's folders and
 * `~/.agents/skills`, with their `-name` overrides. Piano only reads it: a package that is not
 * installed is skipped, never installed. A repository's resources are not included, since which
 * ones apply depends on the session's folder.
 *
 * Pi's resolver can run the package manager synchronously (`npm root -g` for an `npm:` package
 * not in Pi's own folder), so it runs on one worker thread, never on Piano's event loop, and an
 * answer that takes longer than `timeout` is a failure; that worker is then replaced.
 */
import { realpathSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, sep } from "node:path";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";

export type LibraryKind = "skill" | "prompt";

interface Request {
  readonly id: number;
  readonly kind: LibraryKind;
  readonly agentDir: string;
  readonly piano: string;
  /** Pi reads `~/.agents/skills` from `HOME`; the worker's environment is its own copy. */
  readonly home: string | undefined;
}
type Reply =
  | { readonly id: number; readonly entries: ReadonlyArray<readonly [string, string]> }
  | { readonly id: number; readonly error: string };

const WORKER_FLAG = "piano/PiLoads";

/** `path` with its links resolved, or as given when it does not exist. */
const real = (path: string) => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

/** Whether `path` is `dir` or inside it, once links are resolved. */
const within = (path: string, dir: string) => {
  const rest = relative(real(dir), real(path));
  return rest !== ".." && !rest.startsWith(`..${sep}`) && !isAbsolute(rest);
};

/** The answer itself, computed on the worker thread. */
async function resolveHere(
  kind: LibraryKind,
  agentDir: string,
  piano: string,
): Promise<Array<[string, string]>> {
  const { DefaultPackageManager, loadSkills, parseFrontmatter, SettingsManager } = await import(
    "@earendil-works/pi-coding-agent"
  );
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
    return [...found];
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
  return [...found];
}

if (!isMainThread && workerData === WORKER_FLAG && parentPort) {
  const port = parentPort;
  // One request at a time, since each sets this thread's `HOME`.
  let queue: Promise<void> = Promise.resolve();
  port.on("message", (request: Request) => {
    queue = queue.then(async () => {
      if (request.home === undefined) delete process.env.HOME;
      else process.env.HOME = request.home;
      try {
        const entries = await resolveHere(request.kind, request.agentDir, request.piano);
        port.postMessage({ id: request.id, entries } satisfies Reply);
      } catch (cause) {
        port.postMessage({ id: request.id, error: String(cause) } satisfies Reply);
      }
    });
  });
}

interface Pending {
  /** The worker that owes the answer. */
  readonly owner: Worker;
  readonly resolve: (found: ReadonlyMap<string, string>) => void;
  readonly reject: (cause: Error) => void;
  readonly timer: NodeJS.Timeout;
}
let worker: Worker | undefined;
const pending = new Map<number, Pending>();
let nextId = 0;

/** Ends `current` and fails what it still owed, so the next request starts a new worker. */
const retire = (current: Worker, cause: Error) => {
  if (worker === current) worker = undefined;
  for (const [id, request] of pending) {
    if (request.owner !== current) continue;
    clearTimeout(request.timer);
    request.reject(cause);
    pending.delete(id);
  }
  void current.terminate();
};

const start = () => {
  const started = new Worker(new URL(import.meta.url), { workerData: WORKER_FLAG });
  started.on("message", (reply: Reply) => {
    const request = pending.get(reply.id);
    if (!request) return;
    pending.delete(reply.id);
    clearTimeout(request.timer);
    if ("error" in reply) request.reject(new Error(reply.error));
    else request.resolve(new Map(reply.entries));
    // An idle worker never keeps Piano, or a test, running.
    if (![...pending.values()].some((other) => other.owner === started)) started.unref();
  });
  started.on("error", (cause) =>
    retire(started, cause instanceof Error ? cause : new Error(String(cause))),
  );
  started.on("exit", () => retire(started, new Error("Pi's resolver stopped.")));
  return started;
};

/**
 * The names of the skills or prompts Pi loads from outside `piano`, Piano's folder for that kind,
 * each with the file Pi loads it from. Pi's settings are read from `agentDir`; `~/.agents/skills`
 * from `HOME`, as Pi itself reads it. Fails when Pi's resolver fails or takes over `timeout` ms.
 */
export function loadedBeforePiano(
  kind: LibraryKind,
  agentDir: string,
  piano: string,
  timeout = 10_000,
): Promise<ReadonlyMap<string, string>> {
  worker ??= start();
  const current = worker;
  current.ref();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => retire(current, new Error("Pi's resolver did not answer in time.")),
      timeout,
    );
    pending.set(id, { owner: current, resolve, reject, timer });
    current.postMessage({
      id,
      kind,
      agentDir,
      piano,
      home: process.env.HOME,
    } satisfies Request);
  });
}
