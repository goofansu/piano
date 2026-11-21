import { LIBRARY_KINDS, LIBRARY_REACH, type LibraryResult } from "@shared/library";
import type { RenderMsg, ToolExecution } from "@shared/wire";
import { cn } from "cn";
import {
  ArrowDownIcon,
  ArrowUpRightIcon,
  CheckIcon,
  CopyIcon,
  CornerDownRightIcon,
  GitBranchIcon,
  HistoryIcon,
  PuzzleIcon,
  SparklesIcon,
  TerminalIcon,
} from "lucide-react";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useDeferredValue,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { flushSync } from "react-dom";
import { MessageAttachments } from "@/components/Attachments";
import { BranchLabel } from "@/components/BranchLabel";
import { useCopy } from "@/components/CopyButton";
import { DisclosureChevron } from "@/components/Disclosure";
import { DraftFileView } from "@/components/DraftDialogs";
import { IconLink } from "@/components/IconButton";
import { Markdown } from "@/components/Markdown";
import { PianoButton } from "@/components/PianoButton";
import { Keys } from "@/components/PianoMark";
import { QuestionText } from "@/components/QuestionText";
import { StatusBadge as Badge } from "@/components/StatusBadge";
import { StatusDot, type StatusTone } from "@/components/StatusDot";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Item, ItemContent, ItemGroup } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { abbrevHome, clamp, stripAnsi, toolArgsText } from "@/lib/format";
import type { MessageError } from "@/lib/messageError";
import { routePath } from "@/lib/routes";
import { createScrollRenderBudget } from "@/lib/scrollRenderBudget";
import type { SessionDestination } from "@/lib/sessionCatalog";
import { disclosureRow } from "@/lib/styles";
import {
  BOTTOM_ENTRY,
  type ContextFacts,
  contextFacts,
  createTranscriptProjector,
  type DispatchFacts,
  messageAnchorId,
  type NestedCall as NestedCallLine,
  type NestedView,
  type QuestionAnswers,
  type ToolOutcome,
  type ToolRow,
  type TranscriptRow,
} from "@/lib/transcript";
import { domFoldEdges } from "@/lib/transcriptViewport";
import { useMarkdownImages } from "@/lib/useMarkdownImages";
import { NavigationContext } from "@/lib/useNavigation";
import {
  TranscriptDisclosures,
  TranscriptRowKey,
  useTranscriptDisclosure,
} from "@/lib/useTranscriptDisclosure";
import { useNewTranscriptViewport, useTranscriptViewport } from "@/lib/useTranscriptViewport";
import { useVirtualTranscript } from "@/lib/useVirtualTranscript";

export const SessionDestinationContext = createContext<
  (sessionId: string) => SessionDestination | "unlisted"
>(() => "unlisted");

const PromptMeasurementsContext = createContext<Set<() => void> | null>(null);
const TranscriptMeasure = createContext<((row: HTMLElement) => void) | null>(null);

function useRowRemeasure(
  inside: React.RefObject<HTMLElement | null>,
  value: unknown,
  enabled = true,
) {
  const measureRow = useContext(TranscriptMeasure);
  const was = useRef(value);
  useLayoutEffect(() => {
    if (!enabled || Object.is(was.current, value)) return;
    was.current = value;
    const row = inside.current?.closest<HTMLElement>("[data-index]");
    if (row) measureRow?.(row);
  }, [inside, value, enabled, measureRow]);
}

interface Props {
  workspaceId?: string;
  messages: ReadonlyArray<RenderMsg>;
  pending: RenderMsg | null;
  submittedInput?: Pick<RenderMsg, "text" | "attachments"> | null;
  tools: Record<string, ToolExecution>;
  activity?: "starting" | "working";
  working?: boolean;
  placeholder?: string;
  className?: string;
  showTools?: boolean;
  dispatchedFrom?: SessionDestination | "unlisted";
}

export function MessageList({
  workspaceId,
  messages,
  pending,
  submittedInput,
  tools,
  activity,
  working = false,
  placeholder,
  className,
  showTools = true,
  dispatchedFrom,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [disclosures] = useState(() => new Map<string, boolean>());
  const [promptMeasurements] = useState(() => new Set<() => void>());
  useLayoutEffect(() => {
    for (const measure of promptMeasurements) measure();
    promptMeasurements.clear();
  });
  const own = useNewTranscriptViewport();
  const viewport = useTranscriptViewport() ?? own;
  const atBottom = useSyncExternalStore(viewport.subscribe, viewport.atBottom, () => true);
  const [project] = useState(createTranscriptProjector);
  const projection = useMemo(
    () => project(messages, { pending, tools, showTools, working }),
    [project, messages, pending, tools, showTools, working],
  );
  const rowAt = (index: number) =>
    projection.history[index] ??
    (index === projection.history.length ? projection.pending : undefined);
  const { virtual, jumping } = useVirtualTranscript(projection, ref, list, viewport);
  const [unmeasured] = useState(() => new Set<HTMLElement>());
  const [budget] = useState(() => createScrollRenderBudget());
  const measureRow = useCallback(
    (row: HTMLElement) => {
      if (unmeasured.size === 0)
        // Base UI unmounts a closed panel in a nested commit; measure in the next microtask.
        queueMicrotask(() => {
          const rows = [...unmeasured].filter((row) => row.isConnected);
          unmeasured.clear();
          flushSync(() => {
            for (const row of rows)
              virtual.resizeItem(virtual.indexFromElement(row), row.offsetHeight);
          });
          budget.settled();
        });
      unmeasured.add(row);
    },
    [virtual, unmeasured, budget],
  );
  const measureElement = useCallback(
    (row: HTMLDivElement | null) => {
      virtual.measureElement(row);
      if (!row) return;
      if (virtual.isScrolling) budget.mounted();
      // TanStack defers new-row measurements while scrolling; settle them before paint.
      measureRow(row);
    },
    [virtual, measureRow, budget],
  );
  const window = virtual.getVirtualItems();
  const deferredWindow = useDeferredValue(window);
  const readyKeys = new Set(deferredWindow.map((item) => item.key));
  const top = virtual.scrollOffset ?? 0;
  const bottom = top + (virtual.scrollRect?.height ?? 0);
  const isReady = (item: (typeof window)[number]) =>
    jumping ||
    !virtual.isScrolling ||
    readyKeys.has(item.key) ||
    (budget.affordable() && item.end > top && item.start < bottom);

  return (
    <div className={cn("relative min-h-0 flex-1", className)}>
      <div
        ref={ref}
        onScrollCapture={() => {
          budget.scrolled();
          viewport.scrolled();
        }}
        onWheelCapture={budget.input}
        onTouchMoveCapture={budget.input}
        onKeyDownCapture={budget.input}
        data-slot="transcript"
        data-message-count={messages.length}
        data-window-pending={window.some((item) => !isReady(item)) ? "" : undefined}
        className="h-full overflow-y-auto pl-(--gutter) pr-[calc(var(--gutter)+var(--rail-inset))] [overflow-anchor:none]"
      >
        <div className="mx-auto w-full max-w-3xl py-6 md:py-8">
          {placeholder && (
            <Empty className="py-16">
              <EmptyHeader>
                <EmptyDescription className="text-base">{placeholder}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          <div className="flex flex-col gap-6">
            {dispatchedFrom && <DispatchedFrom parent={dispatchedFrom} />}
            <PromptMeasurementsContext value={promptMeasurements}>
              {submittedInput && (
                <UserMessage text={submittedInput.text} attachments={submittedInput.attachments} />
              )}
              <TranscriptDisclosures value={disclosures}>
                <TranscriptMeasure value={measureRow}>
                  {/* Clip unmeasured rows to avoid Firefox's scroll/unmount loop. Chromium needs both axes clipped for overflow-clip-margin. */}
                  <div
                    ref={list}
                    className="relative overflow-clip [overflow-clip-margin:6px]"
                    style={{ height: virtual.getTotalSize() }}
                  >
                    {window.map((item) => {
                      const row = rowAt(item.index)!;
                      const next = rowAt(item.index + 1);
                      const adjacentTools =
                        row.kind === "reply" &&
                        row.tools.length > 0 &&
                        next?.kind === "reply" &&
                        !next.text &&
                        next.tools.length > 0;
                      const ready = isReady(item);
                      const gap = next ? (adjacentTools ? 12 : 24) : 0;
                      return (
                        <div
                          key={item.key}
                          ref={ready ? measureElement : undefined}
                          data-index={item.index}
                          className="absolute left-0 top-0 flex w-full flex-col gap-6"
                          style={{
                            top: item.start - virtual.options.scrollMargin,
                            paddingBottom: gap,
                          }}
                        >
                          {ready ? (
                            <TranscriptRowKey value={row.key}>
                              <TranscriptRowView row={row} workspaceId={workspaceId} />
                            </TranscriptRowKey>
                          ) : (
                            <div
                              data-slot="transcript-placeholder"
                              aria-hidden
                              style={{ height: Math.max(0, item.size - gap), overflow: "hidden" }}
                            >
                              <Row
                                className="h-full"
                                glyph={<Skeleton className="size-1.5 rounded-full" />}
                              >
                                <Skeleton className="h-full w-[88%] rounded-none [mask-image:repeating-linear-gradient(to_bottom,black_0,black_1rem,transparent_1rem,transparent_1.75rem)]" />
                              </Row>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </TranscriptMeasure>
              </TranscriptDisclosures>
            </PromptMeasurementsContext>
            {activity && (
              <Row glyph={<Keys playing className="text-brand" />}>
                <span className="sr-only">
                  {activity === "starting" ? "Starting" : "Pi is working"}
                </span>
                <span aria-hidden className="inline-block h-[1em] w-0.5 bg-brand align-[-0.15em]" />
              </Row>
            )}
          </div>
        </div>
      </div>
      {!atBottom && (
        <PianoButton
          type="button"
          variant="outline-solid"
          size="icon-lg"
          aria-label="Scroll to bottom"
          data-motion="enter"
          onClick={() => viewport.jump(BOTTOM_ENTRY)}
          className="absolute left-0 right-(--rail-inset) bottom-4 mx-auto rounded-full shadow-2 [&_svg:not([class*='size-'])]:size-5"
        >
          <ArrowDownIcon />
        </PianoButton>
      )}
    </div>
  );
}

function Row({
  glyph,
  children,
  className,
  as: Tag = "div",
}: {
  glyph: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  as?: "div" | "span";
}) {
  return (
    <Tag className={cn("flex gap-3", className)}>
      <span
        data-slot="gutter"
        className="flex h-[1lh] w-4 shrink-0 items-center justify-center select-none"
        aria-hidden
      >
        {glyph}
      </span>
      <Tag data-slot="row-content" className="min-w-0 flex-1">
        {children}
      </Tag>
    </Tag>
  );
}

const TranscriptRowView = memo(function TranscriptRowView({
  row,
  workspaceId,
}: {
  row: TranscriptRow;
  workspaceId?: string;
}) {
  const images = useMarkdownImages(workspaceId, row.kind === "reply" ? row.text : "");
  const [mode] = useState<"streaming" | "static">(() =>
    row.kind === "reply" && row.streaming ? "streaming" : "static",
  );
  if (row.kind === "context") return <ContextCard msg={row.msg} />;
  if (row.kind === "user")
    return (
      <UserMessage
        id={row.msg.id}
        text={row.text}
        skill={row.msg.skill}
        attachments={row.msg.attachments}
      />
    );
  if (row.kind === "orphan") return <Tool {...row.tool} />;
  const { msg, text, error, streaming } = row;
  const hasTools = row.tools.length > 0;
  return (
    <>
      {(text || hasTools) && (
        <article
          id={streaming ? undefined : messageAnchorId(msg.id)}
          data-tools-only={!text && hasTools ? "" : undefined}
          data-ends-with-tools={hasTools ? "" : undefined}
          className="group/reply flex flex-col gap-6 rounded-2xl"
        >
          {text && (
            <Row
              glyph={
                streaming ? (
                  <Keys playing className="text-brand" />
                ) : (
                  <span className="text-ink-3">•</span>
                )
              }
            >
              <span className="sr-only select-none">Pi said</span>
              <Markdown
                preserveLineBreaks
                images={images}
                text={text}
                streaming={streaming}
                mode={mode}
                className={cn("prose-chat", streaming && "streaming-caret")}
              />
              {row.jump && <CopyResponse text={text} />}
            </Row>
          )}
          {hasTools && (
            <div className="flex flex-col gap-3">
              {row.tools.map((tool) => (
                <Tool key={tool.call.id} {...tool} />
              ))}
            </div>
          )}
        </article>
      )}
      {error && (
        <ErrorMessage
          error={error}
          id={!streaming && !text && !hasTools ? messageAnchorId(msg.id) : undefined}
        />
      )}
    </>
  );
});

const CONTEXT_ICON: Record<ContextFacts["kind"], typeof HistoryIcon> = {
  compaction: HistoryIcon,
  branch: GitBranchIcon,
  shell: TerminalIcon,
  extension: PuzzleIcon,
};

function FoldRow({
  stateKey,
  glyph,
  header,
  label,
  defaultOpen = false,
  canOpen = true,
  headerClassName,
  ruled = true,
  bodyClassName,
  data,
  onClick,
  action,
  toolOutput = false,
  children,
}: {
  stateKey?: string;
  glyph?: React.ReactNode;
  header: React.ReactNode | ((open: boolean) => React.ReactNode);
  label: string;
  defaultOpen?: boolean;
  canOpen?: boolean;
  headerClassName?: string;
  ruled?: boolean;
  bodyClassName?: string;
  data?: Record<`data-${string}`, string | undefined>;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
  action?: React.ReactNode;
  toolOutput?: boolean;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useTranscriptDisclosure(stateKey ?? label, defaultOpen);
  const root = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(false);
  const [tall, setTall] = useState(false);
  const viewport = useTranscriptViewport();
  useRowRemeasure(root, open, toolOutput);
  useLayoutEffect(() => {
    const el = root.current;
    const scroller = el?.closest<HTMLElement>('[data-slot="transcript"]');
    if (!toolOutput || !open || !el || !scroller) return;
    const measure = () => setTall(el.offsetHeight > scroller.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [toolOutput, open]);
  useLayoutEffect(() => {
    if (!restoreFocus.current) return;
    restoreFocus.current = false;
    heading.current?.querySelector("button")?.focus({ preventScroll: true });
  });
  const changeOpen = (next: boolean) => {
    if (toolOutput && open !== next) {
      viewport?.fold(next, () => {
        const el = root.current;
        const head = heading.current;
        return el && head ? domFoldEdges(el, head) : undefined;
      });
    }
    // Refocusing a clicked header paints a spurious ring in WebKit, where clicks do not focus buttons.
    const active = document.activeElement;
    if (
      toolOutput &&
      active instanceof HTMLElement &&
      root.current?.contains(active) &&
      active !== heading.current?.querySelector("button")
    ) {
      restoreFocus.current = true;
    }
    setOpen(next);
  };
  const title = (
    <>
      {typeof header === "function" ? header(open) : header}
      {canOpen && (
        <DisclosureChevron open={open} className={cn("ml-auto", toolOutput && open && "mr-0.5")} />
      )}
    </>
  );
  const trigger = (
    <CollapsibleTrigger
      disabled={!canOpen}
      render={
        <button
          type="button"
          data-sidebar-swipe="true"
          className={cn(
            disclosureRow,
            toolOutput && "m-0 w-full px-0 py-1",
            action && "w-auto flex-1",
            !toolOutput && headerClassName,
          )}
        >
          {toolOutput ? (
            <Row as="span" glyph={glyph} className="w-full">
              <span className={cn("flex min-w-0 items-center gap-2", headerClassName)}>
                {title}
              </span>
            </Row>
          ) : (
            title
          )}
        </button>
      }
    />
  );
  const head = action ? (
    <div className="flex min-w-0 items-center gap-1">
      {trigger}
      {action}
    </div>
  ) : (
    trigger
  );
  const body = (
    <div className={cn(ruled && "border-l-2 border-line pl-3 text-ink-2", bodyClassName)}>
      {children}
      {toolOutput && tall && (
        <CollapsibleTrigger
          render={
            <Button variant="ghost" size="xs" className="mt-2 -ml-2 self-start">
              Collapse
            </Button>
          }
        />
      )}
    </div>
  );
  const headerRow = toolOutput || glyph === undefined ? head : <Row glyph={glyph}>{head}</Row>;
  return (
    <Collapsible
      ref={root}
      open={open}
      onOpenChange={changeOpen}
      role="group"
      aria-label={label}
      className="text-sm"
      onClick={onClick}
      {...data}
    >
      {toolOutput ? (
        <div
          ref={heading}
          data-slot="tool-header"
          className={cn("bg-conversation", open && tall && "sticky top-0 z-10")}
        >
          {headerRow}
        </div>
      ) : (
        headerRow
      )}
      {canOpen && (
        <CollapsibleContent className={toolOutput ? undefined : "disclosure-content"}>
          {glyph === undefined ? (
            <div className="pt-2">{body}</div>
          ) : (
            <Row glyph={null} className={cn("pt-2", toolOutput && "pr-1")}>
              {body}
            </Row>
          )}
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}

function ContextCard({ msg }: { msg: RenderMsg }) {
  const facts = contextFacts(msg.label);
  const Icon = CONTEXT_ICON[facts.kind];
  return (
    <FoldRow
      glyph={<Icon className="size-3.5 text-ink-3" aria-hidden />}
      header={
        <>
          <span className="shrink-0 font-medium text-ink">{facts.title}</span>
          {facts.note && (
            <span className="min-w-0 flex-1 truncate font-mono text-ink-3">{facts.note}</span>
          )}
        </>
      }
      label={facts.title}
      defaultOpen
      data={{ "data-slot": "context-card", "data-context": facts.kind }}
    >
      {facts.markdown ? (
        <Markdown text={msg.text} preserveLineBreaks className="prose-chat" />
      ) : (
        <pre className="whitespace-pre-wrap break-words text-xs">{msg.text}</pre>
      )}
    </FoldRow>
  );
}

function ErrorMessage({ error, id }: { error: MessageError; id?: string }) {
  const [open, setOpen] = useTranscriptDisclosure("error");
  return (
    <div id={id}>
      <Row glyph={<span className="text-err">!</span>}>
        <p role="alert" className="break-words text-err">
          {error.summary}
        </p>
        {error.details && (
          <Collapsible open={open} onOpenChange={setOpen}>
            <CollapsibleTrigger
              render={
                <Button variant="ghost" size="xs" className="-ml-2">
                  Error details
                  <DisclosureChevron open={open} />
                </Button>
              }
            />
            <CollapsibleContent className="disclosure-content">
              <pre className="whitespace-pre-wrap break-words text-sm text-ink-2">
                {error.details}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        )}
      </Row>
    </div>
  );
}

const USER_LINES = 6;

function CopyResponse({ text }: { text: string }) {
  const { copied, copy } = useCopy(text, "Could not copy. Select the reply text to copy it.");
  return (
    <Button
      variant="ghost"
      size="xs"
      aria-label={copied ? "Response copied" : "Copy response"}
      className={cn(
        "mt-2 -ml-2 text-ink-3 opacity-0 select-none group-hover/reply:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100",
        copied && "text-brand opacity-100",
      )}
      onClick={copy}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      <span role="status">{copied ? "Copied" : "Copy"}</span>
    </Button>
  );
}

function UserMessage({
  id,
  text,
  skill,
  attachments,
}: {
  id?: string;
  text: string;
  skill?: RenderMsg["skill"];
  attachments: RenderMsg["attachments"];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const textId = useId();
  const [open, setOpen] = useTranscriptDisclosure("prompt");
  const [overflows, setOverflows] = useState(false);
  const measurements = useContext(PromptMeasurementsContext);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      measurements?.delete(measure);
      setOverflows(el.scrollHeight > el.clientHeight + 1);
    };
    measurements?.add(measure);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      measurements?.delete(measure);
      ro.disconnect();
    };
  }, [text, open, measurements]);
  const clamped = !open && overflows;
  const long = overflows || open;
  const toggle = () => setOpen((o) => !o);
  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- the click is a pointer shortcut for the toggle button below, which keyboard users reach.
    <article
      id={id ? messageAnchorId(id) : undefined}
      data-slot={id ? undefined : "submitted-input"}
      className={cn(
        "rounded-2xl border border-line bg-fill px-4 py-3.5",
        long && "cursor-pointer select-text hover:border-line-strong",
      )}
      onClick={(event) =>
        long &&
        !(event.target as Element).closest("a, button, [role='dialog']") &&
        !window.getSelection()?.toString() &&
        toggle()
      }
    >
      <Row glyph={<span className="font-semibold text-brand">›</span>}>
        <span className="sr-only select-none">You said</span>
        {skill && <SkillExpansion skill={skill} />}
        {(text || !skill) && (
          <div
            ref={ref}
            id={textId}
            className={cn(
              "break-words",
              skill && "mt-2",
              !open && "overflow-hidden",
              clamped && "[mask-image:linear-gradient(to_bottom,black_60%,transparent)]",
            )}
            style={open ? undefined : { maxHeight: `${USER_LINES * 1.55}em` }}
          >
            <Markdown text={text} mode="static" preserveLineBreaks className="prose-chat" />
          </div>
        )}
        {long && (
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="xs"
              className="-mr-2 text-ink-3"
              aria-expanded={open}
              aria-controls={textId}
              onClick={(e) => {
                e.stopPropagation();
                toggle();
              }}
            >
              {open ? "Show less" : "Show more"}
            </Button>
          </div>
        )}
        <MessageAttachments items={attachments} />
      </Row>
    </article>
  );
}

function SkillExpansion({ skill }: { skill: NonNullable<RenderMsg["skill"]> }) {
  return (
    <FoldRow
      header={
        <>
          <SparklesIcon className="size-3.5 shrink-0 text-brand" aria-hidden />
          <span className="min-w-0 flex-1 truncate font-mono text-ink">/skill:{skill.name}</span>
        </>
      }
      label={`${skill.name} skill`}
      headerClassName="leading-6"
      onClick={(e) => e.stopPropagation()}
    >
      <p className="mb-2 truncate font-mono text-xs text-ink-3">{abbrevHome(skill.location)}</p>
      <Markdown text={skill.body} className="prose-chat text-ink-2" />
    </FoldRow>
  );
}

function DispatchRow({
  session,
  outcome,
  stateKey,
}: {
  session: DispatchFacts;
  outcome: ToolOutcome;
  stateKey: string;
}) {
  const { sessionId, title, branch, status, badge, params, answer, detail } = session;
  const destinationOf = useContext(SessionDestinationContext);
  const destination = sessionId ? destinationOf(sessionId) : "unlisted";
  return (
    <FoldRow
      glyph={<StatusDot tone={TONE[outcome]} />}
      header={
        <>
          <span className="min-w-20 flex-1 truncate font-medium text-ink">{title}</span>
          {branch && <BranchLabel branch={branch} className="max-w-40 shrink text-xs text-ink-3" />}
          <Badge variant={badge}>{status}</Badge>
        </>
      }
      label={`Dispatched session: ${title}`}
      stateKey={stateKey}
      toolOutput
      canOpen={!!(params || answer || detail)}
      bodyClassName="flex flex-col gap-3"
      data={{ "data-slot": "dispatch-row", "data-session-id": sessionId ?? undefined }}
      action={destination !== "unlisted" && <OpenSession {...destination} />}
    >
      {detail && <p className="text-xs text-ink-3">{detail}</p>}
      {params && (
        // A scrollable <pre> breaks drag selection in Firefox; scroll its wrapper instead.
        <div className="overflow-x-auto rounded-lg bg-fill">
          <pre className="whitespace-pre-wrap break-words px-3 py-2 text-ink-2">
            {clamp(params, 8000)}
          </pre>
        </div>
      )}
      {answer && <Markdown text={clamp(answer, 20000)} preserveLineBreaks className="prose-chat" />}
    </FoldRow>
  );
}

function useSessionLink(cwd: string, sessionId: string) {
  const navigation = useContext(NavigationContext);
  return {
    href: routePath({ kind: "session", sessionId }),
    onClick: (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (!navigation || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey)
        return;
      event.preventDefault();
      navigation.select(cwd, sessionId);
    },
  };
}

function OpenSession({ cwd, sessionId }: SessionDestination) {
  const link = useSessionLink(cwd, sessionId);
  return (
    <IconLink {...link} label="Open session" size="inline" className="-my-1 shrink-0 text-ink-3">
      <ArrowUpRightIcon className="size-3.5" />
    </IconLink>
  );
}

function DispatchedFrom({ parent }: { parent: NonNullable<Props["dispatchedFrom"]> }) {
  return (
    <Row
      glyph={<CornerDownRightIcon className="size-3.5 text-ink-3" aria-hidden />}
      className="text-sm"
    >
      <p data-slot="dispatched-from" className="truncate text-ink-3">
        Dispatched from {parent === "unlisted" ? "another session" : <ParentLink {...parent} />}
      </p>
    </Row>
  );
}

function ParentLink({ sessionId, cwd, label }: SessionDestination) {
  const link = useSessionLink(cwd, sessionId);
  return (
    <a
      {...link}
      className="font-medium text-ink-2 underline-offset-4 outline-none hover:text-ink hover:underline focus-visible:underline"
    >
      {label}
    </a>
  );
}

const TONE: Record<ToolOutcome, StatusTone> = {
  running: "busy",
  failed: "err",
  done: "ok",
  incomplete: "muted",
  pending: "muted",
};

function QuestionAnswersRow({ answers, stateKey }: { answers: QuestionAnswers; stateKey: string }) {
  return (
    <FoldRow
      glyph={<StatusDot tone={answers.status === "answered" ? "ok" : "muted"} />}
      header={<span className="font-medium text-ink">Answers</span>}
      label="Questions and answers"
      stateKey={`${stateKey}:answers`}
      defaultOpen
      ruled={false}
      data={{ "data-slot": "question-answers" }}
    >
      <ItemGroup>
        {answers.items.map(({ id, question, answer }) => (
          <Item key={id} role="listitem" className="p-0">
            <ItemContent className="min-w-0">
              <QuestionText text={question} className="text-ink" />
              <p className="whitespace-pre-wrap break-words text-ink-2">
                {answer === undefined ? (
                  <span className="text-ink-3">Not answered</span>
                ) : answer === "" ? (
                  <span className="text-ink-3">Empty answer</span>
                ) : (
                  answer
                )}
              </p>
            </ItemContent>
          </Item>
        ))}
      </ItemGroup>
    </FoldRow>
  );
}

function LibraryRow({ result, stateKey }: { result: LibraryResult; stateKey: string }) {
  const [viewing, setViewing] = useState(false);
  const { Noun: Kind } = LIBRARY_KINDS[result.kind];
  const saved = result.status === "saved";
  return (
    <>
      <FoldRow
        glyph={<StatusDot tone={saved ? "ok" : "muted"} />}
        header={
          <span className="min-w-0 truncate font-medium text-ink">
            {`${Kind} ${saved ? "saved" : "not saved"}: `}
            <span className="font-mono font-normal text-ink-2">{result.name}</span>
          </span>
        }
        label={`${Kind} ${result.name}`}
        stateKey={`${stateKey}:library`}
        canOpen={result.status !== "cancelled"}
        toolOutput
        data={{ "data-slot": "library-row", "data-status": result.status }}
        action={
          saved && (
            <Button
              variant="ghost"
              size="xs"
              className="-my-1 shrink-0"
              onClick={() => setViewing(true)}
            >
              View
            </Button>
          )
        }
      >
        <p className="text-ink-2">
          {saved ? LIBRARY_REACH : result.status === "refused" && result.detail}
        </p>
      </FoldRow>
      {saved && viewing && (
        <DraftFileView
          kind={result.kind}
          name={result.name}
          file={result.file}
          close={() => setViewing(false)}
        />
      )}
    </>
  );
}

function ToolDetails({
  args,
  output,
  failed,
  outputLimit = 20000,
}: {
  args: string;
  output: string | undefined;
  failed: boolean;
  outputLimit?: number;
}) {
  const details = toolArgsText(args);
  return (
    <>
      {details && (
        // A scrollable <pre> breaks drag selection in Firefox; scroll its wrapper instead.
        <div className="overflow-x-auto rounded-lg bg-fill">
          <pre className="whitespace-pre px-3 py-2 text-ink-2">{clamp(details, 4000)}</pre>
        </div>
      )}
      {output && (
        <div data-slot="tool-output" className={cn(details && "mt-1")}>
          <pre
            className={cn(
              "whitespace-pre-wrap break-all border-l-2 border-line py-1 pl-3",
              failed ? "text-err" : "text-ink-2",
            )}
          >
            {clamp(output, outputLimit)}
          </pre>
        </div>
      )}
    </>
  );
}

function NestedCalls({ parentId, nested }: { parentId: string; nested: NestedView }) {
  const [all, setAll] = useTranscriptDisclosure(`${parentId}:nested`);
  const root = useRef<HTMLDivElement>(null);
  useRowRemeasure(root, all);
  const { fold } = nested;
  const shown = all || !fold ? nested.calls : nested.folded;
  return (
    <div ref={root} data-slot="nested-calls" className="mt-2 flex flex-col gap-2">
      {fold && (
        <button
          type="button"
          aria-expanded={all}
          data-sidebar-swipe="true"
          className={cn(disclosureRow, "ml-0 w-full px-0 text-ink-3 hover:text-ink")}
          onClick={() => setAll(!all)}
        >
          <Row as="span" glyph={<DisclosureChevron open={all} />}>
            {all ? fold.showFewer : fold.showAll}
            {nested.failed > 0 && <span className="text-err"> · {nested.failed} failed</span>}
          </Row>
        </button>
      )}
      {shown.map((line) => (
        <NestedCall key={line.call.id} line={line} />
      ))}
    </div>
  );
}

function NestedCall({ line: { call, outcome, summary, inputNote } }: { line: NestedCallLine }) {
  return (
    <FoldRow
      glyph={<StatusDot tone={TONE[outcome]} />}
      header={
        <>
          <span
            className={cn("shrink-0 font-mono", outcome === "failed" ? "text-err" : "text-ink")}
          >
            {call.name}
          </span>
          {summary && (
            <span className="min-w-0 flex-1 truncate font-mono text-ink-2">{summary}</span>
          )}
        </>
      }
      label={`${call.name} tool call`}
      stateKey={call.id}
      ruled={false}
    >
      {inputNote && <p className="text-ink-3">{inputNote}</p>}
      <ToolDetails
        args={call.args}
        output={stripAnsi(call.text)}
        failed={outcome === "failed"}
        outputLimit={4000}
      />
      {call.outputKind === "unavailable" && <p className="mt-1 text-ink-3">Output unavailable</p>}
    </FoldRow>
  );
}

function Tool({
  call,
  outcome,
  output,
  nested,
  verb,
  knownTool,
  summary,
  dispatch,
  answers,
  library,
}: ToolRow) {
  if (answers) return <QuestionAnswersRow answers={answers} stateKey={call.id} />;
  if (library) return <LibraryRow result={library} stateKey={call.id} />;
  if (dispatch)
    return dispatch.map((session, i) => (
      <DispatchRow
        key={session.sessionId ?? i}
        stateKey={`${call.id}:${session.sessionId ?? i}`}
        session={session}
        outcome={outcome}
      />
    ));
  const failed = outcome === "failed";
  const { calls, failed: callsFailed, latest } = nested;

  return (
    <FoldRow
      glyph={<StatusDot tone={TONE[outcome]} />}
      header={(open) => (
        <>
          <span className={cn("shrink-0 font-medium", failed ? "text-err" : "text-ink")}>
            {verb}
            {!knownTool && (
              <span className="ml-2 font-mono font-normal text-ink-2">{call.name}</span>
            )}
          </span>
          {summary && (
            <span className="min-w-0 flex-1 truncate font-mono text-ink-2">{summary}</span>
          )}
          {knownTool && !summary && <span className="font-mono text-ink-2">{call.name}</span>}
          {calls.length > 0 && !open && (
            <>
              {!summary && latest && (
                <span className="min-w-0 flex-1 truncate font-mono text-ink-2">
                  {latest.call.name} {latest.summary}
                </span>
              )}
              <span className="shrink-0 text-ink-3">
                {calls.length} {calls.length === 1 ? "call" : "calls"}
                {callsFailed > 0 && <span className="text-err"> · {callsFailed} failed</span>}
              </span>
            </>
          )}
        </>
      )}
      label={`${call.name} tool call`}
      stateKey={call.id}
      toolOutput
      ruled={false}
    >
      <ToolDetails args={call.args} output={output} failed={failed} />
      {calls.length > 0 && <NestedCalls parentId={call.id} nested={nested} />}
      {nested.warning && <p className="text-xs text-warning">{nested.warning}</p>}
    </FoldRow>
  );
}
