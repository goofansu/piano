/** The production router over the production services, in a scratch directory; only the Pi child is faked. */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { DirectoryFactsLive } from "../../server/DirectoryFacts.ts";
import { PiCli } from "../../server/PiCli.ts";
import { PiSessionsLive } from "../../server/PiSessions.ts";
import { PiSettingsLive } from "../../server/PiSettings.ts";
import { ProviderLoginLive } from "../../server/ProviderLogin.ts";
import { RadiusSetupLive } from "../../server/RadiusSetup.ts";
import { Registry, RegistryDatabasePath, RegistryLive } from "../../server/Registry.ts";
import { AppRouter } from "../../server/Router.ts";
import { SessionHostsLive } from "../../server/SessionHosts.ts";
import { SessionPullRequestsLive } from "../../server/SessionPullRequests.ts";
import { SidebarViewLive } from "../../server/SidebarView.ts";
import { WorkspaceChangesLive } from "../../server/WorkspaceChanges.ts";
import { WorkspaceCommandsLive } from "../../server/WorkspaceCommands.ts";
import { WorkspaceRevisionsLive } from "../../server/WorkspaceRevisions.ts";

export interface RouterFixture {
  readonly root: string;
  /** A registered folder: a git checkout whose README.md has one uncommitted added line. */
  readonly repo: string;
  readonly workspaceId: string;
  /** Answer a request as the server would; a relative URL resolves against the server's origin. */
  readonly handle: (input: string, init?: RequestInit) => Promise<Response>;
  readonly dispose: () => Promise<void>;
}

/** `services` replaces production services, to put a fake behind one of their interfaces. */
export async function startRouter<Fakes = never>(prefix: string, services?: Layer.Layer<Fakes>): Promise<RouterFixture> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  const repo = join(root, "repo");
  process.env.PI_CODING_AGENT_DIR = join(root, "agent");
  process.env.PI_CODING_AGENT_SESSION_DIR = join(root, "sessions");
  mkdirSync(join(root, "sessions"));
  mkdirSync(join(repo, "src"), { recursive: true });
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { stdio: "pipe" });
  git("init", "-q");
  writeFileSync(join(repo, "README.md"), "one\n");
  git("add", "."); git("commit", "-qm", "initial");
  writeFileSync(join(repo, "README.md"), "one\ntwo\n");

  const Config = Layer.mergeAll(
    Layer.succeed(PiCli, { node: process.execPath, cli: new URL("../fake-pi.mjs", import.meta.url).pathname, extraArgs: [] }),
    Layer.succeed(RegistryDatabasePath, join(root, "registry.db")),
    NodeServices.layer,
  );
  const Services = Layer.mergeAll(PiSettingsLive, ProviderLoginLive, RadiusSetupLive, WorkspaceRevisionsLive, WorkspaceChangesLive, SessionPullRequestsLive).pipe(
    Layer.provideMerge(DirectoryFactsLive), Layer.provideMerge(SessionHostsLive({ idleMs: 0 })), Layer.provideMerge(RegistryLive), Layer.provideMerge(PiSessionsLive), Layer.provide(Config));
  const Core = WorkspaceCommandsLive.pipe(Layer.provideMerge(SidebarViewLive()), Layer.provideMerge(Services));

  const workspaceId = await Effect.runPromise(Effect.gen(function* () {
    const registry = yield* Registry;
    yield* registry.addFolder(repo);
    return (yield* registry.get).workspaces.find(w => w.path === repo)!.id;
  }).pipe(Effect.provide(RegistryLive.pipe(Layer.provide(Config)))));
  const web = HttpRouter.toWebHandler(AppRouter.pipe(Layer.provideMerge(services ? Layer.merge(Core, services) : Core)), { disableLogger: true });
  return {
    root, repo, workspaceId,
    handle: (input, init) => web.handler(new Request(new URL(input, "http://piano.test"), init)),
    dispose: async () => {
      await web.dispose();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
