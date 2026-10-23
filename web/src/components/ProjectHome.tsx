import { type ComponentProps, useRef } from "react";
import { BranchLabel } from "@/components/BranchLabel";
import { NewSessionComposer } from "@/components/NewSession";
import { ShowSidebarButton } from "@/components/ShowSidebarButton";
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
  "flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:px-6 md:py-8";

/** The pane's header, shaped like the session header: the name with a line beneath it, actions at the end. */
function ProjectHeader({
  children,
  actions,
}: {
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex min-h-16 shrink-0 items-center gap-3 border-b border-line px-4 py-3 md:px-6">
      <ShowSidebarButton className="-ml-2" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">{children}</div>
      {actions}
    </header>
  );
}

/**
 * The home's geometry while the registry loads, like the sidebar's skeleton: hidden from screen
 * readers and late to appear, so a quick load shows the home without it and nothing is announced.
 */
function ProjectHomeSkeleton() {
  return (
    <>
      <ProjectHeader>
        <div aria-hidden className="late-enter flex flex-col gap-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-20" />
        </div>
      </ProjectHeader>
      <div className={page}>
        <div aria-hidden className="late-enter mx-auto flex w-full max-w-3xl flex-col gap-2">
          <Skeleton className="h-14 w-full rounded-lg" />
          <Skeleton className="h-14 w-full rounded-lg" />
        </div>
      </div>
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
  const byKey = new Map(home.sessions.map((s) => [sessionKey(s), s]));
  const sessions = order.flatMap((key) => byKey.get(key) ?? []);
  const now = Date.now();

  const count = sessions.length;
  return (
    <>
      <ProjectHeader>
        <h1 className="truncate text-sm font-medium">{project.name}</h1>
        {/* Plain project metadata has no dedicated UI primitive. */}
        <p className="truncate text-xs text-ink-3">
          {count === 1 ? "1 session" : `${count} sessions`}
        </p>
      </ProjectHeader>
      <div className={page}>
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
          {/* A session started here joins this project. */}
          <NewSessionComposer
            state={state}
            client={client}
            chooseDirectory={chooseDirectory}
            projectId={project.id}
            placeholder={`New session in ${project.name}`}
          />
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
    </>
  );
}
