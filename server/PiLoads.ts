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
  readonly home: string | undefined;
}
type Reply =
  | { readonly id: number; readonly entries: ReadonlyArray<readonly [string, string]> }
  | { readonly id: number; readonly error: string };

const WORKER_FLAG = "piano/PiLoads";

const real = (path: string) => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

const within = (path: string, dir: string) => {
  const rest = relative(real(dir), real(path));
  return rest !== ".." && !rest.startsWith(`..${sep}`) && !isAbsolute(rest);
};

async function resolveHere(
  kind: LibraryKind,
  agentDir: string,
  piano: string,
): Promise<Array<[string, string]>> {
  const { DefaultPackageManager, loadSkills, parseFrontmatter, SettingsManager } =
    await import("@earendil-works/pi-coding-agent");
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
    for (const skill of loadSkills({ cwd, agentDir, skillPaths: paths, includeDefaults: false })
      .skills)
      if (!within(skill.filePath, piano)) found.set(skill.name, skill.filePath);
    return [...found];
  }
  // Pi does not export its prompt loader; replace this shim when it does.
  for (const path of paths) {
    if (!path.endsWith(".md")) continue;
    const name = basename(path).slice(0, -3);
    if (found.has(name)) continue;
    try {
      if (!statSync(path).isFile()) continue;
      parseFrontmatter(await readFile(path, "utf8"));
      found.set(name, path);
    } catch {}
  }
  return [...found];
}

if (!isMainThread && workerData === WORKER_FLAG && parentPort) {
  const port = parentPort;
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
  readonly owner: Worker;
  readonly resolve: (found: ReadonlyMap<string, string>) => void;
  readonly reject: (cause: Error) => void;
  readonly timer: NodeJS.Timeout;
}
let worker: Worker | undefined;
const pending = new Map<number, Pending>();
let nextId = 0;

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
    if (![...pending.values()].some((other) => other.owner === started)) started.unref();
  });
  started.on("error", (cause) =>
    retire(started, cause instanceof Error ? cause : new Error(String(cause))),
  );
  started.on("exit", () => retire(started, new Error("Pi's resolver stopped.")));
  return started;
};

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
