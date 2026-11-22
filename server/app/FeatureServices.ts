import { Effect, Stream } from "effect";
import { sessionStatusLayer } from "../../features/dispatch/server/index.ts";
import {
  sidebarViewLayer,
  type SidebarViewOptions,
} from "../../features/navigation/server/index.ts";
import { RadiusAuthenticationError, RadiusClient } from "../../features/radius/server/index.ts";
import {
  PiSessions,
  SessionHosts,
  SessionReferences,
} from "../../features/sessions/server/index.ts";
import { sessionSharingLayer } from "../../features/sharing/server/index.ts";
import {
  WorkspaceChanges,
  directoryFactsLayer,
  GitHubPullRequests,
  listWorktrees,
} from "../../features/workspace/server/index.ts";
import type { SessionEntry } from "../shared/registry/Registry.ts";

export const SessionStatusLive = sessionStatusLayer(
  Effect.gen(function* () {
    const hosts = yield* SessionHosts;
    const changes = yield* WorkspaceChanges;
    const github = yield* GitHubPullRequests;
    return {
      readSnapshot: (entry: SessionEntry) =>
        hosts.read(entry.cwd, entry.sessionId).pipe(
          Effect.flatMap((view) =>
            view._tag === "saved"
              ? Effect.succeed({ snapshot: view.snapshot, live: false })
              : view.session.events.pipe(
                  Stream.take(1),
                  Stream.runHead,
                  Effect.map((frame) =>
                    frame._tag === "Some" && frame.value._tag === "snapshot"
                      ? { snapshot: frame.value.snapshot, live: true }
                      : undefined,
                  ),
                ),
          ),
          Effect.orElseSucceed(() => undefined),
        ),
      changesSummary: (workspace) =>
        changes
          .summary(workspace, { scope: "uncommitted" })
          .pipe(
            Effect.map(({ result }) =>
              result.status === "ready"
                ? { branch: result.branch, files: result.files.length }
                : null,
            ),
          ),
      pullRequestState: (link, cwd) => github.view(link, cwd).pipe(Effect.map((pr) => pr.state)),
    };
  }),
);

export const SidebarViewLive = (options: SidebarViewOptions) =>
  sidebarViewLayer(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts;
      const references = yield* SessionReferences;
      return {
        list: hosts.list,
        lifecycleChanges: hosts.lifecycleChanges,
        availability: references.availability,
      };
    }),
    options.discover ?? listWorktrees,
  );

export const DirectoryFactsLive = directoryFactsLayer(
  Effect.map(PiSessions, (sessions) => sessions.probe),
);

export const SessionSharingLive = sessionSharingLayer(
  Effect.gen(function* () {
    const references = yield* SessionReferences;
    const { history } = yield* PiSessions;
    return {
      resolve: references.resolve,
      savedJsonl: history.savedJsonl,
      openClient: (token, signal) => new RadiusClient(token, signal),
      isAuthenticationError: (error) => error instanceof RadiusAuthenticationError,
    };
  }),
);
