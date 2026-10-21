/**
 * Sessions' status by ID, for orchestrators that did not start them or lost what a start
 * returned: one bounded read, never a wait. Facts come from what Piano already holds: SessionHosts'
 * live host or the saved Pi history it reads (INV-01), the registry's reference, Git's view of the
 * checkout as Changes shows it, and GitHub for a linked pull request. Nothing is stored and Pi is
 * never started.
 */
import { Context, Data, Effect, Layer, Stream } from "effect";
import { dispositionOf, lastAnswerOf } from "../shared/sessionStatus.ts";
import type { SessionStatusFacts, Snapshot } from "../shared/wire.ts";
import { GitHubPullRequests, pullRequestIdentity } from "./GitHubPullRequests.ts";
import { Registry, type SessionEntry } from "./Registry.ts";
import { SessionHosts } from "./SessionHosts.ts";
import { WorkspaceChanges } from "./WorkspaceChanges.ts";

/** A status request that names nothing Piano lists; `detail` is written for people. */
export class SessionStatusError extends Data.TaggedError("SessionStatusError")<{
  readonly detail: string;
}> {}

export type StatusTarget = { readonly sessionId: string } | { readonly projectId: string };

/** How long a linked pull request's state may take before the status reports it unknown. */
const PULL_REQUEST_TIMEOUT = "5 seconds";

export class SessionStatus extends Context.Service<
  SessionStatus,
  {
    /** One session by ID, or every active session of a project, in registry order. */
    readonly read: (
      target: StatusTarget,
    ) => Effect.Effect<ReadonlyArray<SessionStatusFacts>, SessionStatusError>;
  }
>()("piano/SessionStatus") {}

export const SessionStatusLive = Layer.effect(
  SessionStatus,
  Effect.gen(function* () {
    const registry = yield* Registry;
    const hosts = yield* SessionHosts;
    const changes = yield* WorkspaceChanges;
    const github = yield* GitHubPullRequests;

    /** The live snapshot, or the saved one; undefined when neither can be read. */
    const snapshotOf = (entry: SessionEntry) =>
      hosts.read(entry.cwd, entry.sessionId).pipe(
        Effect.flatMap((view) =>
          view._tag === "saved"
            ? Effect.succeed({ snapshot: view.snapshot, live: false })
            : view.session.events.pipe(
                Stream.take(1),
                Stream.runHead,
                Effect.map((frame) =>
                  frame._tag === "Some" && frame.value._tag === "snapshot"
                    ? { snapshot: frame.value.snapshot as Snapshot, live: true }
                    : undefined,
                ),
              ),
        ),
        Effect.orElseSucceed(() => undefined),
      );

    const changesOf = Effect.fn("SessionStatus.changesOf")(function* (entry: SessionEntry) {
      const workspace = (yield* registry.get).workspaces.find((w) => w.path === entry.cwd);
      if (!workspace) return null;
      const observed = yield* changes.preview(workspace);
      if (observed.result.status !== "ready") return null;
      const link = entry.pullRequest;
      const identity = link ? pullRequestIdentity(link.url) : null;
      const state =
        link && identity
          ? yield* github.view(link, entry.cwd).pipe(
              Effect.timeout(PULL_REQUEST_TIMEOUT),
              Effect.map((pr): string | null => pr.state),
              Effect.orElseSucceed(() => null),
            )
          : null;
      return {
        branch: observed.result.branch,
        files: observed.result.files.length,
        pullRequest: identity && { number: identity.number, url: identity.url, state },
      };
    });

    const statusOf = Effect.fn("SessionStatus.statusOf")(function* (
      entry: SessionEntry,
    ): Effect.fn.Return<SessionStatusFacts> {
      const [read, changed] = yield* Effect.all([snapshotOf(entry), changesOf(entry)], {
        concurrency: 2,
      });
      const { disposition, dialog } = read
        ? dispositionOf(read.snapshot, read.live)
        : { disposition: "unknown" as const, dialog: undefined };
      return {
        sessionId: entry.sessionId,
        cwd: entry.cwd,
        projectId: entry.projectId ?? null,
        disposition,
        since: dialog ? new Date(dialog.receivedAt).toISOString() : entry.updatedAt,
        needs: dialog
          ? {
              title:
                dialog.title ?? dialog.message ?? `Pi is waiting for a ${dialog.method} answer.`,
              kind: dialog.method,
            }
          : null,
        lastAnswer: read ? lastAnswerOf(read.snapshot) : null,
        changes: changed,
      };
    });

    const read = Effect.fn("SessionStatus.read")(function* (target: StatusTarget) {
      const data = yield* registry.get;
      if ("sessionId" in target) {
        // An ID names one session; an active reference wins over an archived one.
        const matches = data.sessions.filter((s) => s.sessionId === target.sessionId);
        const entry = matches.find((s) => !s.archived) ?? matches[0];
        if (!entry)
          return yield* new SessionStatusError({
            detail: `Piano lists no session ${target.sessionId}.`,
          });
        return [yield* statusOf(entry)];
      }
      if (!data.projects.some((p) => p.id === target.projectId))
        return yield* new SessionStatusError({
          detail: `Piano has no project ${target.projectId}.`,
        });
      const members = data.sessions.filter((s) => s.projectId === target.projectId && !s.archived);
      return yield* Effect.forEach(members, statusOf, { concurrency: 4 });
    });

    return SessionStatus.of({ read });
  }),
);
