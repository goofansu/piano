import { PlusIcon } from "lucide-react";
import { useRef } from "react";
import { BranchLabel } from "@/components/BranchLabel";
import { useCommands } from "@/components/CommandHost";
import { ShowSidebarButton } from "@/components/ShowSidebarButton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
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
import { projectCommand } from "@/lib/projectCommands";
import { projectHome, stableOrder } from "@/lib/projectHome";
import { useNavigation } from "@/lib/useNavigation";
import { type AppState, sessionKey } from "@/store";

/** Rows keep their place while the page is open: a new key appends, a gone one drops. */
function useStableOrder(keys: readonly string[]): string[] {
  const order = useRef<string[]>([]);
  order.current = stableOrder(order.current, keys);
  return order.current;
}

const page =
  "flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-2 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:px-6 md:py-12";

/**
 * The home's geometry while the registry loads, like the sidebar's skeleton: hidden from screen
 * readers and late to appear, so a quick load shows the home without it and nothing is announced.
 */
function ProjectHomeSkeleton() {
  return (
    <div className={page}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <div className="flex min-w-0 items-center gap-2">
          <ShowSidebarButton className="-ml-2" />
          <div aria-hidden className="late-enter flex h-9 flex-1 items-center">
            <Skeleton className="h-5 w-48" />
          </div>
        </div>
        <div aria-hidden className="late-enter flex flex-col gap-2">
          <Skeleton className="h-14 w-full rounded-lg" />
          <Skeleton className="h-14 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}

/**
 * A project's home: its member sessions, newest activity first, each with its title, folder,
 * branch, saved pull request number and last activity. Everything comes from the session catalog the browser already holds.
 */
export function ProjectHome({ state, projectId }: { state: AppState; projectId: string }) {
  const { select, openNew } = useNavigation();
  const { run } = useCommands();
  const home = projectHome(state, projectId);
  const order = useStableOrder(home.kind === "home" ? home.sessions.map(sessionKey) : []);

  if (home.kind === "loading") return <ProjectHomeSkeleton />;
  if (home.kind === "missing")
    return (
      <>
        <ShowSidebarButton className="absolute top-2 left-2" />
        <Empty className="flex-1 px-4" role="alert">
          <EmptyHeader>
            <EmptyTitle>Project not found</EmptyTitle>
            <EmptyDescription>This project is not in Piano's database.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </>
    );

  const { project } = home;
  const create = projectCommand(state, project, "new-session");
  const unarchive = projectCommand(state, project, "unarchive");
  const byKey = new Map(home.sessions.map((s) => [sessionKey(s), s]));
  const sessions = order.flatMap((key) => byKey.get(key) ?? []);
  const now = Date.now();

  return (
    <div className={page}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <div className="flex min-w-0 items-center gap-2">
          <ShowSidebarButton className="-ml-2" />
          <h1 className="min-w-0 flex-1 truncate text-xl font-medium tracking-tight">
            {project.name}
          </h1>
          {create && (
            // On a phone the name keeps the width: the button shows its icon and keeps its name for screen readers.
            <Button
              className="max-md:size-11 max-md:px-0"
              disabled={!create.enabled}
              onClick={() => openNew(undefined, project.id)}
            >
              <PlusIcon data-icon="inline-start" />
              <span className="max-md:sr-only">{create.label}</span>
            </Button>
          )}
        </div>
        {unarchive && (
          <Alert>
            <AlertDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>This project is archived.</span>
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0"
                disabled={!unarchive.enabled}
                onClick={() => run(unarchive)}
              >
                {unarchive.label}
              </Button>
            </AlertDescription>
          </Alert>
        )}
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
    </div>
  );
}
