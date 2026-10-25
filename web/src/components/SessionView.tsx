import { isWorking } from "@shared/sessionProjection";
import type { ExtensionState } from "@shared/wire";
import { cn } from "cn";
import { MessagesSquareIcon } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Banner } from "@/components/Banner";
import { useSessionCommands } from "@/components/CommandHost";
import { Composer } from "@/components/Composer";
import { LocalFileContext } from "@/components/Markdown";
import { MessageList, SessionDestinationContext } from "@/components/MessageList";
import {
  PianoStripBar,
  PianoStripTab,
  PianoStripTabsList,
  PianoStripTabTrigger,
  Tabs,
} from "@/components/PianoTabs";
import { AddToChat } from "@/components/Quotes";
import { SessionHeader } from "@/components/SessionHeader";
import { SessionPanel, SurfaceTabIcon, surfaceTabNames } from "@/components/SessionPanel";
import { SessionPullRequestControl } from "@/components/SessionPullRequest";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import type { Client } from "@/lib/client";
import { drafts } from "@/lib/messageDraft";
import { type SurfaceTab, shownAreas, tabKey } from "@/lib/navigation";
import { AGENT_MIN_WIDTH, PANEL_WIDTH, singleArea } from "@/lib/panelLayout";
import { sessionDestination } from "@/lib/sessionCatalog";
import {
  completionTarget,
  sessionActivity,
  sessionContext,
  sessionPane,
  sessionReference,
} from "@/lib/sessionContext";
import { type SessionNotice, sessionNotices } from "@/lib/sessionNotices";
import { useMessagesOnly } from "@/lib/useMessagesOnly";
import { useNavigation } from "@/lib/useNavigation";
import { useSessionPullRequest } from "@/lib/useSessionPullRequest";
import { TranscriptViewportContext, useNewTranscriptViewport } from "@/lib/useTranscriptViewport";
import { type AppState, sessionKey } from "@/store";

interface Props {
  state: AppState;
  send: Client["send"];
}

/** The session's areas share one tab list one at a time; these name its parts for each other. */
const AREA_ID = { agent: "session-agent-area", surface: "session-surface-area" } as const;
const tabId = (value: string) => `session-area-tab-${encodeURIComponent(value)}`;

export function SessionView({ state, send }: Props) {
  // The selected session's PR popover; hidden while Settings covers the view. Its Changes and
  // open file live in the Surface area (SessionPanel).
  const navigation = useNavigation();
  const {
    settings,
    pullRequest: pullRequestOpened,
    openPullRequest,
    closePullRequest,
    openFile,
    single,
    setSingle,
    surface,
    showAgent,
  } = navigation;
  const pullRequestOpen = !settings && pullRequestOpened;
  const onPullRequestOpenChange = (open: boolean) =>
    open ? openPullRequest() : closePullRequest();
  // The width left after navigation and insets decides the layout, not the viewport alone. A
  // hidden session (under Settings) measures nothing and keeps its layout.
  const areas = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = areas.current;
    if (!element) return;
    const measure = () => {
      const next = singleArea(element.getBoundingClientRect().width);
      if (next !== undefined) setSingle(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [setSingle]);
  const agentHidden = !shownAreas(navigation).agent;
  const agent = useRef<HTMLDivElement>(null);
  const [messagesOnly] = useMessagesOnly();
  const t = state.session;
  // The transcript looks executions up by tool call ID.
  const tools = useMemo(
    () => Object.fromEntries((t?.tools ?? []).map((tool) => [tool.id, tool])),
    [t?.tools],
  );
  const input = state.pendingCreate;
  const { workspace, draftKey } = sessionContext(state);
  // Changes opens through its session command, whose rule Views and the palette follow too.
  const { commands, run } = useSessionCommands();
  const changes = commands.find((c) => c.id === "changes");
  const openChanges = changes?.enabled ? () => run(changes) : undefined;
  // Ask adds to the draft and never sends; one area at a time, it returns to the draft.
  const onAsk = draftKey
    ? (text: string) => {
        drafts.paragraph(draftKey, text);
        toast.success("Added to your message");
        if (single) showAgent();
        requestAnimationFrame(() => agent.current?.querySelector("textarea")?.focus());
      }
    : undefined;
  // The registry's workspace for the directory, like Changes: it outlives a closed folder. Its
  // reference says whether the session is linked, so an unlinked one asks GitHub nothing.
  const pullRequest = useSessionPullRequest(
    workspace?.id,
    t?.sessionId,
    t?.sessionId
      ? sessionReference(state, { cwd: t.cwd, sessionId: t.sessionId })?.pullRequest
      : undefined,
    !!t && isWorking(t.state),
    {
      open: pullRequestOpen,
      onOpenChange: onPullRequestOpenChange,
    },
  );
  const { status, replyActivity } = sessionActivity(state, messagesOnly);
  const parentId = t?.state.dispatchedFrom;
  const dispatchedFrom = parentId ? sessionDestination(state, parentId) : undefined;
  // Dispatch rows offer to open a session only where the catalog can open it.
  const destination = (sessionId: string) => sessionDestination(state, sessionId);
  const pane = sessionPane(state);
  const notices = sessionNotices(state, messagesOnly);
  const readOnly = notices.find((n) => n.placement === "composer");
  const [usedEditorRequest, setUsedEditorRequest] = useState<string>();
  // The transcript reports where the reader is; the composer's jump list reads and moves it.
  const viewport = useNewTranscriptViewport();

  return (
    <TranscriptViewportContext value={viewport}>
      <SessionHeader
        state={state}
        status={status}
        pullRequest={(menuTrigger) =>
          t?.sessionId && (
            <SessionPullRequestControl
              key={sessionKey(t)}
              pr={pullRequest}
              menuTrigger={menuTrigger}
            />
          )
        }
      />
      {single && (openChanges || surface) && <AreaTabs openChanges={openChanges} />}
      <div
        ref={areas}
        className="relative flex min-h-0 min-w-0 flex-1"
        style={
          {
            "--agent-min": `${AGENT_MIN_WIDTH}px`,
            "--surface-min": `${PANEL_WIDTH.min}px`,
          } as React.CSSProperties
        }
      >
        <div
          ref={agent}
          id={AREA_ID.agent}
          data-slot="agent-area"
          // One area at a time it is the panel the Agent tab names; side by side, a plain region.
          {...(single && { role: "tabpanel", "aria-labelledby": tabId("agent") })}
          inert={agentHidden}
          aria-hidden={agentHidden || undefined}
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col",
            !single && "min-w-(--agent-min)",
            // Hidden in place, not display:none, so the transcript keeps its reading position.
            agentHidden && "invisible absolute inset-0",
          )}
        >
          {notices
            .filter((n) => n.placement === "banner")
            .map((n) => (
              <Banner
                key={n.id}
                variant={n.tone === "destructive" ? "destructive" : "warning"}
                title={n.title}
                action={
                  n.action && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => n.action && send(n.action.command)}
                    >
                      {n.action.label}
                    </Button>
                  )
                }
              >
                {n.details.length
                  ? n.details.map((detail) => (
                      <p key={detail} className="whitespace-pre-wrap break-words">
                        {detail}
                      </p>
                    ))
                  : undefined}
              </Banner>
            ))}
          <AddToChat draftKey={draftKey} className="relative flex min-h-0 flex-1 flex-col">
            {pane.list && (
              <LocalFileContext value={(path) => openFile(path, "agent")}>
                <SessionDestinationContext value={destination}>
                  <MessageList
                    showTools={!messagesOnly}
                    messages={t?.messages ?? []}
                    pending={t?.pending ?? null}
                    submittedInput={input}
                    tools={tools}
                    activity={replyActivity}
                    working={!!t && isWorking(t.state)}
                    placeholder={pane.placeholder}
                    dispatchedFrom={dispatchedFrom}
                  />
                </SessionDestinationContext>
              </LocalFileContext>
            )}
            {pane.skeleton && <TranscriptSkeleton />}
            {!state.connected && (
              <div
                role="status"
                className="late-enter pointer-events-none absolute inset-x-0 top-3 flex justify-center"
              >
                <span className="flex items-center gap-2 rounded-full border border-line bg-surface-2 px-3 py-1.5 text-sm text-ink-2 shadow-2">
                  <Spinner className="size-3.5" /> Reconnecting…
                </span>
              </div>
            )}
          </AddToChat>
          {notices
            .filter((n) => n.placement === "status")
            .map((n) =>
              n.extension ? (
                <ExtensionBlock
                  key={n.id}
                  extension={n.extension}
                  used={usedEditorRequest}
                  onAppend={
                    draftKey
                      ? (request) => {
                          drafts.paragraph(draftKey, request.text);
                          setUsedEditorRequest(request.id);
                        }
                      : undefined
                  }
                />
              ) : (
                <StatusLine key={n.id} notice={n} />
              ),
            )}
          <Composer
            session={t}
            draftKey={draftKey}
            completion={completionTarget(state)}
            disabled={!draftKey || input?.outcome === "starting"}
            actionsDisabled={pane.composerDisabled}
            readOnly={readOnly}
            send={send}
          />
        </div>
        <SessionPanel
          state={state}
          single={single}
          onAsk={onAsk}
          id={AREA_ID.surface}
          labelledBy={single && surface ? tabId(surface.active) : undefined}
        />
      </div>
    </TranscriptViewportContext>
  );
}

/**
 * One area at a time, the tabs between them: Agent, then the open views in the order they were
 * opened, then Changes while it is not open yet and can open. Choosing Agent never focuses
 * the composer, so a phone keeps its keyboard down; choosing a view shows it as it was left. A
 * file closes from its own toolbar.
 */
function AreaTabs({
  openChanges,
}: {
  /** Runs the Changes command; omitted while it is disabled, which leaves Changes out. */
  openChanges: (() => void) | undefined;
}) {
  const navigation = useNavigation();
  const { surface, showAgent, selectTab } = navigation;
  const tabs = surface?.tabs ?? [];
  const value = surface && shownAreas(navigation).surface ? surface.active : "agent";
  // The Surface area's strip tabs, so the session's tabs look alike at every width.
  const trigger = (key: string, icon: React.ReactNode, label: string, controls: string) => (
    <PianoStripTab key={key} selected={key === value}>
      <PianoStripTabTrigger value={key} id={tabId(key)} aria-controls={controls} icon={icon}>
        {label}
      </PianoStripTabTrigger>
    </PianoStripTab>
  );
  const view = (tab: SurfaceTab) =>
    trigger(tabKey(tab), <SurfaceTabIcon tab={tab} />, surfaceTabNames(tab).name, AREA_ID.surface);
  return (
    <PianoStripBar variant="pills">
      <Tabs
        value={value}
        onValueChange={(next) =>
          next === "agent"
            ? showAgent()
            : next === "changes" && !tabs.includes("changes")
              ? openChanges?.()
              : selectTab(next)
        }
        className="min-w-0 flex-1 gap-0 self-stretch"
      >
        <PianoStripTabsList aria-label="Session views">
          {trigger("agent", <MessagesSquareIcon className="size-3.5" />, "Agent", AREA_ID.agent)}
          {tabs.map(view)}
          {/* Not open yet, Changes waits at the end, where opening it adds its tab. */}
          {openChanges && !tabs.includes("changes") && view("changes")}
        </PianoStripTabsList>
      </Tabs>
    </PianoStripBar>
  );
}

/** A status line under the transcript: the last dialog's or input's outcome. Hand-written: no shadcn component is a plain live line. */
function StatusLine({ notice }: { notice: SessionNotice }) {
  return (
    <section
      aria-label={notice.id === "dialog-resolution" ? "Last dialog" : "Last input"}
      role="status"
      className={cn(
        "px-(--gutter) pt-2 text-sm",
        notice.tone === "warning" ? "text-warning" : "text-ink-2",
      )}
    >
      <div className="mx-auto max-w-3xl break-words">
        <p>{notice.title}</p>
        {notice.details.map((detail) => (
          <p key={detail} className="mt-1">
            {detail}
          </p>
        ))}
      </div>
    </section>
  );
}

/** What Pi's extensions report: title, statuses, widgets and a suggested message to append. */
function ExtensionBlock({
  extension,
  used,
  onAppend,
}: {
  extension: ExtensionState;
  used: string | undefined;
  /** Omitted while the draft takes no additions, which hides Append. */
  onAppend: ((request: { id: string; text: string }) => void) | undefined;
}) {
  return (
    <section
      aria-label="Extension state"
      className="mx-auto w-full max-w-3xl max-h-40 overflow-auto px-(--gutter) pt-2 text-xs text-ink-2"
    >
      {extension.title && <p>Extension title: {extension.title}</p>}
      {extension.statuses.map((status) => (
        <p key={status.key}>
          {status.key}: {status.text}
        </p>
      ))}
      {extension.widgets.map((widget) => (
        <div key={widget.key}>
          <p>
            {widget.key} · {widget.placement === "aboveEditor" ? "above editor" : "below editor"}
          </p>
          <pre className="whitespace-pre-wrap break-words">{widget.lines.join("\n")}</pre>
        </div>
      ))}
      {extension.editorRequest && (
        <div>
          <p>Suggested message</p>
          <pre className="whitespace-pre-wrap break-words">{extension.editorRequest.text}</pre>
          {onAppend && (
            <Button
              size="sm"
              variant="outline"
              disabled={used === extension.editorRequest.id}
              onClick={() => {
                if (extension.editorRequest) onAppend(extension.editorRequest);
              }}
            >
              Append to draft
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * A skeleton in the transcript's own geometry: a prompt card, a reply with three lines and a
 * tool row. `sessionPane` decides when it shows; it leaves at once when the transcript or its
 * empty state can show, since loading placeholders have no motion.
 */
function TranscriptSkeleton() {
  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden bg-conversation px-(--gutter)">
      {/* The lines wait like the sidebar's, so a quick load shows the transcript without them. */}
      <div className="late-enter mx-auto flex w-full max-w-3xl flex-col gap-6 py-6 md:py-8">
        <div className="rounded-2xl border border-line bg-fill px-4 py-3.5">
          <div className="flex gap-3">
            <span className="flex h-[1lh] w-4 items-center justify-center">
              <Skeleton className="h-3 w-1.5 rounded-sm" />
            </span>
            <Skeleton className="h-4 w-[52%]" />
          </div>
        </div>
        <div className="flex gap-3">
          <span className="flex h-[1lh] w-4 items-center justify-center">
            <Skeleton className="size-1.5 rounded-full" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-2.5 pt-0.5">
            <Skeleton className="h-4 w-[88%]" />
            <Skeleton className="h-4 w-[72%]" />
            <Skeleton className="h-4 w-[44%]" />
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="flex h-[1lh] w-4 items-center justify-center">
            <Skeleton className="size-2 rounded-full" />
          </span>
          <Skeleton className="h-3.5 w-10" />
          <Skeleton className="h-3.5 w-36" />
        </div>
      </div>
    </div>
  );
}
