import { isWorking } from "@shared/sessionProjection";
import type { ExtensionState } from "@shared/wire";
import { cn } from "cn";
import { MessagesSquareIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AnsweredQuestion } from "@/components/AnsweredQuestion";
import { Banner } from "@/components/Banner";
import { useSessionCommands } from "@/components/CommandHost";
import { Composer } from "@/components/Composer";
import { InlineQuestion } from "@/components/InlineQuestion";
import { LocalFileContext } from "@/components/Markdown";
import {
  PianoStripBar,
  PianoStripTab,
  PianoStripTabsList,
  PianoStripTabTrigger,
  Tabs,
} from "@/components/PianoTabs";
import { AddToChat } from "@/components/Quotes";
import { SessionHeader } from "@/components/SessionHeader";
import { SessionPanel, SurfaceTabTrigger } from "@/components/SessionPanel";
import { SessionRail } from "@/components/SessionRail";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Transcript, TranscriptProvider } from "@/features/transcript";
import type { Client } from "@/lib/client";
import { tabKey } from "@/lib/navigation";
import { AGENT_MIN_WIDTH, PANEL_WIDTH, RAIL_WIDTH, singleArea } from "@/lib/panelLayout";
import { answeredQuestion, pendingDialogs } from "@/lib/piDialogs";
import { sessionDestination } from "@/lib/sessionCatalog";
import {
  completionTarget,
  sessionActivity,
  sessionContext,
  sessionPane,
  sessionProject,
  sessionReferenceChangeable,
  sessionWorking,
} from "@/lib/sessionContext";
import { type SessionNotice, sessionNotices } from "@/lib/sessionNotices";
import { useLibraryToasts } from "@/lib/useLibraryToasts";
import { useMessagesOnly } from "@/lib/useMessagesOnly";
import { useNavigation } from "@/lib/useNavigation";
import { useDrafts } from "@/lib/usePageStores";
import { useSessionPullRequest } from "@/lib/useSessionPullRequest";
import { type AppState, sessionKey } from "@/store";

interface Props {
  state: AppState;
  send: Client["send"];
}

const AREA_ID = { agent: "session-agent-area", surface: "session-surface-area" } as const;
const tabId = (value: string) => `session-area-tab-${encodeURIComponent(value)}`;

export function SessionView({ state, send }: Props) {
  const drafts = useDrafts();
  const navigation = useNavigation();
  const {
    pullRequest: pullRequestOpen,
    openPullRequest,
    closePullRequest,
    openFile,
    single,
    setSingle,
    surface,
    showAgent,
  } = navigation;
  const onPullRequestOpenChange = (open: boolean) =>
    open ? openPullRequest() : closePullRequest();
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
  const agentHidden = !navigation.layout.agent;
  const railInside = navigation.layout.rail;
  const agent = useRef<HTMLDivElement>(null);
  const [messagesOnly] = useMessagesOnly();
  const t = state.session;
  useLibraryToasts(t?.tools);
  const input = state.pendingCreate;
  const context = sessionContext(state);
  const { workspace, pullRequestTarget, draftKey, pullRequest: link } = context;
  const place = {
    project: sessionProject(state, t?.sessionId ? { cwd: t.cwd, sessionId: t.sessionId } : null)
      ?.name,
    folder: context.folderName,
    branch: context.branch,
    session: context.title,
  };
  const { commands } = useSessionCommands();
  const areaTabs = !!commands.find((c) => c.id === "agent")?.enabled;
  const onAsk = draftKey
    ? (text: string) => {
        drafts.paragraph(draftKey, text);
        toast.success("Added to your message");
        if (single) showAgent();
        requestAnimationFrame(() =>
          agent.current
            ?.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')
            ?.focus(),
        );
      }
    : undefined;
  const changesVisible = navigation.shownTab === "changes";
  const pullRequest = useSessionPullRequest(
    pullRequestTarget,
    link,
    !!t?.sessionId && sessionWorking(state, { cwd: t.cwd, sessionId: t.sessionId }),
    {
      visible: changesVisible,
      dialog: { open: pullRequestOpen, onOpenChange: onPullRequestOpenChange },
      changeable:
        !!t?.sessionId && sessionReferenceChangeable(state, { cwd: t.cwd, sessionId: t.sessionId }),
    },
  );
  const { status, replyActivity } = sessionActivity(state, messagesOnly);
  const parentId = t?.state.dispatchedFrom;
  const dispatchedFrom = parentId ? sessionDestination(state, parentId) : undefined;
  const destination = (sessionId: string) => sessionDestination(state, sessionId);
  const pane = sessionPane(state);
  const notices = sessionNotices(state, messagesOnly);
  const answerReceipt = answeredQuestion(state);
  const readOnly = notices.find((n) => n.placement === "composer");
  const [usedEditorRequest, setUsedEditorRequest] = useState<string>();

  return (
    <TranscriptProvider
      messages={t?.messages ?? []}
      pending={t?.pending ?? null}
      tools={t?.tools}
      working={!!t && isWorking(t.state)}
      showTools={!messagesOnly}
    >
      <SessionHeader state={state} status={status} pullRequest={pullRequest} />
      {areaTabs && <AreaTabs />}
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
          {...(areaTabs && { role: "tabpanel", "aria-labelledby": tabId("agent") })}
          inert={agentHidden}
          aria-hidden={agentHidden || undefined}
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col",
            !single && "min-w-(--agent-min)",
            agentHidden && "invisible absolute inset-0",
          )}
          style={
            railInside ? ({ "--rail-inset": `${RAIL_WIDTH}px` } as React.CSSProperties) : undefined
          }
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
          <div className="relative flex min-h-0 flex-1 flex-col">
            <AddToChat draftKey={draftKey} className="relative flex min-h-0 flex-1 flex-col">
              {(pane.list || pane.skeleton) && (
                <LocalFileContext value={(path) => openFile(path, "agent")}>
                  <Transcript
                    key={t ? sessionKey(t) : draftKey}
                    loading={pane.skeleton}
                    workspaceId={workspace?.id}
                    submittedInput={input}
                    activity={replyActivity}
                    placeholder={pane.placeholder}
                    dispatchedFrom={dispatchedFrom}
                    destinationOf={destination}
                  />
                </LocalFileContext>
              )}
              {!state.connected && (
                <div
                  role="status"
                  className="late-enter pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center"
                >
                  <span className="flex items-center gap-2 rounded-full border border-line bg-surface-2 px-3 py-1.5 text-sm text-ink-2 shadow-2">
                    <Spinner className="size-3.5" /> Reconnecting…
                  </span>
                </div>
              )}
            </AddToChat>
            <div className="pr-(--rail-inset)">
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
              <LocalFileContext value={(path) => openFile(path, "agent")}>
                {answerReceipt && <AnsweredQuestion resolution={answerReceipt} />}
                <InlineQuestion pending={pendingDialogs(state)} send={send} />
              </LocalFileContext>
              <Composer
                session={t}
                draftKey={draftKey}
                completion={completionTarget(state)}
                place={place}
                disabled={pane.editorDisabled}
                actionsDisabled={pane.composerDisabled}
                readOnly={readOnly}
                send={send}
              />
            </div>
            {railInside && <SessionRail state={state} />}
          </div>
        </div>
        <SessionPanel
          state={state}
          onAsk={onAsk}
          pullRequest={pullRequest}
          id={AREA_ID.surface}
          labelledBy={areaTabs && surface ? tabId(surface.active) : undefined}
        />
      </div>
    </TranscriptProvider>
  );
}

function AreaTabs() {
  const navigation = useNavigation();
  const { surface, showAgent, selectTab } = navigation;
  const tabs = surface?.tabs ?? [];
  const value = surface && navigation.layout.surface ? surface.active : "agent";
  return (
    <PianoStripBar variant="pills">
      <Tabs
        value={value}
        onValueChange={(next) => (next === "agent" ? showAgent() : selectTab(next))}
        className="min-w-0 flex-1 gap-0 self-stretch"
      >
        <PianoStripTabsList aria-label="Session views">
          <PianoStripTab selected={value === "agent"}>
            <PianoStripTabTrigger
              value="agent"
              id={tabId("agent")}
              aria-controls={AREA_ID.agent}
              icon={<MessagesSquareIcon className="size-3.5" />}
            >
              Agent
            </PianoStripTabTrigger>
          </PianoStripTab>
          {tabs.map((tab) => {
            const key = tabKey(tab);
            return (
              <PianoStripTab key={key} selected={key === value}>
                <SurfaceTabTrigger tab={tab} id={tabId(key)} controls={AREA_ID.surface} />
              </PianoStripTab>
            );
          })}
        </PianoStripTabsList>
      </Tabs>
    </PianoStripBar>
  );
}

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

function ExtensionBlock({
  extension,
  used,
  onAppend,
}: {
  extension: ExtensionState;
  used: string | undefined;
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
