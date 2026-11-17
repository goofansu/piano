import { Clock, Context, Data, Effect, Layer, Option, Stream } from "effect";
import { STATUS_CHANGES_MS } from "../shared/dispatch.ts";
import { pullRequestIdentity } from "../shared/pullRequestIdentity.ts";
import { dialogAsks, dispositionOf, lastAnswerOf } from "../shared/sessionStatus.ts";
import type { ClientMessage, SessionStatusFacts, Snapshot } from "../shared/wire.ts";
import { GitHubPullRequests } from "./GitHubPullRequests.ts";
import { Registry, type SessionEntry, sessionById } from "./Registry.ts";
import { SessionHosts } from "./SessionHosts.ts";
import { WorkspaceChanges } from "./WorkspaceChanges.ts";

export class SessionStatusError extends Data.TaggedError("SessionStatusError")<{
  readonly detail: string;
}> {}

export type StatusTarget = Extract<ClientMessage, { _tag: "session_status" }>["target"];

const PULL_REQUEST_TIMEOUT = "5 seconds";
export const StatusChangesMs = Context.Reference<number>("piano/StatusChangesMs", {
  defaultValue: () => STATUS_CHANGES_MS,
});

export class SessionStatus extends Context.Service<
  SessionStatus,
  {
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

    const readSnapshot = (entry: SessionEntry) =>
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

    const snapshots = new Map<string, ReturnType<typeof readSnapshot>>();
    const snapshotOf = Effect.fn("SessionStatus.snapshotOf")(function* (entry: SessionEntry) {
      const key = JSON.stringify([entry.cwd, entry.sessionId]);
      let pending = snapshots.get(key);
      if (!pending) {
        pending = yield* Effect.cached(
          readSnapshot(entry).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                if (snapshots.get(key) === pending) snapshots.delete(key);
              }),
            ),
          ),
        );
        snapshots.set(key, pending);
      }
      return yield* pending;
    });

    const changesOf = Effect.fn("SessionStatus.changesOf")(function* (
      entry: SessionEntry,
      deadline: number,
    ) {
      const workspace = (yield* registry.get).workspaces.find((w) => w.path === entry.cwd);
      if (!workspace) return null;
      const remaining = Math.max(0, deadline - (yield* Clock.currentTimeMillis));
      const observed = yield* changes
        .summary(workspace, { scope: "uncommitted" })
        .pipe(Effect.timeoutOption(remaining), Effect.map(Option.getOrNull));
      if (observed?.result.status !== "ready") return null;
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
      deadline: number,
    ): Effect.fn.Return<SessionStatusFacts> {
      const [read, changed] = yield* Effect.all([snapshotOf(entry), changesOf(entry, deadline)], {
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
              title: dialogAsks(dialog),
              kind: dialog.method,
            }
          : null,
        lastAnswer: read ? lastAnswerOf(read.snapshot) : null,
        changes: changed,
      };
    });

    const read = Effect.fn("SessionStatus.read")(function* (target: StatusTarget) {
      const data = yield* registry.get;
      const deadline = (yield* Clock.currentTimeMillis) + (yield* StatusChangesMs);
      if ("sessionId" in target) {
        const found = sessionById(data, target.sessionId);
        if (found._tag === "unlisted")
          return yield* new SessionStatusError({
            detail: `Piano lists no session ${target.sessionId}.`,
          });
        if (found._tag === "ambiguous")
          return yield* new SessionStatusError({
            detail: `Piano lists session ${target.sessionId} under more than one directory (${found.cwds.join(", ")}) and does not guess which one is meant.`,
          });
        return [yield* statusOf(found.entry, deadline)];
      }
      if (!data.projects.some((p) => p.id === target.projectId))
        return yield* new SessionStatusError({
          detail: `Piano has no project ${target.projectId}.`,
        });
      const members = data.sessions.filter((s) => s.projectId === target.projectId && !s.archived);
      return yield* Effect.forEach(members, (entry) => statusOf(entry, deadline), {
        concurrency: 4,
      });
    });

    return SessionStatus.of({ read });
  }),
);
