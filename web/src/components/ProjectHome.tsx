import { type ComponentProps, useRef } from "react";
import { BranchLabel } from "@/components/BranchLabel";
import { useCommands } from "@/components/CommandHost";
import { NewSessionComposer } from "@/components/NewSession";
import { PaneBody, PaneHeader, PaneHeading, PaneNotFound } from "@/components/Pane";
import { ProjectCommandsMenu } from "@/components/Projects";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { timeAgo } from "@/lib/format";
import { projectCommands } from "@/lib/projectCommands";
import { projectHome, stableOrder } from "@/lib/projectHome";
import { useNavigation } from "@/lib/useNavigation";
import { type AppState, sessionKey } from "@/store";

/** Rows keep their place while the page is open: a new key appends, a gone one drops. */
function useStableOrder(keys: readonly string[]): string[] {
  const order = useRef<string[]>([]);
  order.current = stableOrder(order.current, keys);
  return order.current;
}

/**
 * The home's geometry while the registry loads, like the sidebar's skeleton: hidden from screen
 * readers and late to appear, so a quick load shows the home without it and nothing is announced.
 */
function ProjectHomeSkeleton() {
  return (
    <>
      <PaneHeader>
        <PaneHeading>
          <div aria-hidden className="late-enter flex flex-col gap-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-20" />
          </div>
        </PaneHeading>
      </PaneHeader>
      <PaneBody>
        <div aria-hidden className="late-enter mx-auto flex w-full max-w-3xl flex-col gap-2">
          <Skeleton className="h-14 w-full rounded-lg" />
          <Skeleton className="h-14 w-full rounded-lg" />
        </div>
      </PaneBody>
    </>
  );
}

/**
 * A project's home: its member sessions, newest activity first, each with its title, folder,
 * branch, saved pull request number and last activity. Everything comes from the session catalog the browser already holds.
 */
export function ProjectHome({
  state,
  client,
  chooseDirectory,
  projectId,
}: {
  state: AppState;
  client: ComponentProps<typeof NewSessionComposer>["client"];
  chooseDirectory: (cwd: string) => void;
  projectId: string;
}) {
  const { select } = useNavigation();
  const { run } = useCommands();
  const home = projectHome(state, projectId);
  const order = useStableOrder(home.kind === "home" ? home.sessions.map(sessionKey) : []);

  if (home.kind === "loading") return <ProjectHomeSkeleton />;
  if (home.kind === "missing")
    return (
      <PaneNotFound
        title="Project not found"
        description="This project is not in Piano's database."
      />
    );

  const { project } = home;
  const byKey = new Map(home.sessions.map((s) => [sessionKey(s), s]));
  const sessions = order.flatMap((key) => byKey.get(key) ?? []);
  const now = Date.now();

  const count = sessions.length;
  return (
    <>
      <PaneHeader
        actions={
          <ProjectCommandsMenu
            project={project}
            commands={projectCommands(state, project)}
            run={run}
            size="icon-sm"
          />
        }
      >
        <PaneHeading>
          <h1 className="truncate text-sm font-medium">{project.name}</h1>
          {/* Plain project metadata has no dedicated UI primitive. */}
          <p className="truncate text-xs text-ink-3">
            {count === 1 ? "1 session" : `${count} sessions`}
          </p>
        </PaneHeading>
      </PaneHeader>
      <PaneBody>
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
          {/* A session started here joins this project. */}
          <NewSessionComposer state={state} client={client} chooseDirectory={chooseDirectory} />
          {sessions.length > 0 && (
            <ItemGroup aria-label="Sessions" className="gap-2">
              {sessions.map((s) => (
                <Item
                  key={sessionKey(s)}
                  asChild
                  role="listitem"
                  variant="outline"
                  size="sm"
                  className="flex-nowrap bg-surface-1 text-left hover:bg-fill-hover"
                >
                  <button
                    type="button"
                    disabled={s.disabled}
                    title={s.hint}
                    onClick={() => select(s.cwd, s.sessionId)}
                  >
                    <ItemContent className="min-w-0">
                      <ItemTitle className="w-full min-w-0">
                        <span className="min-w-0 flex-1 truncate">{s.title || "Untitled"}</span>
                      </ItemTitle>
                      <ItemDescription className="flex min-w-0 items-center gap-1.5 text-xs">
                        {/* The folder keeps its name (up to half the line); a long branch truncates first. */}
                        <span className="max-w-1/2 shrink-0 truncate">{s.folder}</span>
                        {s.branch && <BranchLabel branch={s.branch} />}
                        {s.pullRequest && <span className="shrink-0">#{s.pullRequest}</span>}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions className="self-start text-xs text-ink-3">
                      <time dateTime={s.updatedAt}>{timeAgo(s.updatedAt, now)}</time>
                    </ItemActions>
                  </button>
                </Item>
              ))}
            </ItemGroup>
          )}
        </div>
      </PaneBody>
    </>
  );
}
