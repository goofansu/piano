import type { RenderMsg, ToolExecution } from "@shared/wire";
import { cn } from "cn";
import {
  ArrowDownIcon,
  ArrowUpRightIcon,
  CheckIcon,
  ChevronDownIcon,
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
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import { MessageAttachments } from "@/components/Attachments";
import { BranchLabel } from "@/components/BranchLabel";
import { DisclosureChevron } from "@/components/Disclosure";
import { IconButton } from "@/components/IconButton";
import { Markdown } from "@/components/Markdown";
import { PianoButton } from "@/components/PianoButton";
import { Keys } from "@/components/PianoMark";
import { StatusBadge as Badge } from "@/components/StatusBadge";
import { StatusDot } from "@/components/StatusDot";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Item, ItemContent, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { abbrevHome, clamp, stripAnsi, toolArgsText } from "@/lib/format";
import type { MessageError } from "@/lib/messageError";
import { routePath } from "@/lib/routes";
import type { SessionDestination } from "@/lib/sessionCatalog";
import { disclosureRow } from "@/lib/styles";
import {
  BOTTOM_ENTRY,
  type ContextFacts,
  contextFacts,
  type DispatchFacts,
  messageAnchorId,
  nestedStatus,
  type QuestionAnswers,
  type ToolOutcome,
  type ToolRow,
  type TranscriptRow,
  transcriptRows,
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

/**
 * Where a session the transcript names opens, from the session catalog (`sessionDestination`):
 * a dispatch row offers a session the sidebar and palette list (not archived) whose history is
 * there. Without a provider, as in module tests, no session is offered.
 */
export const SessionDestinationContext = createContext<
  (sessionId: string) => SessionDestination | "unlisted"
>(() => "unlisted");

// Initial prompt measurements run together in the parent's layout effect, after every
// Markdown child has finished writing its DOM and before initial scroll pinning.
const PromptMeasurementsContext = createContext<Set<() => void> | null>(null);
/** Re-measures a transcript row now, so a fold that changed its height in this commit moves the
 * rows below it before the browser paints; the virtualizer's own ResizeObserver lands a frame
 * later, which paints the old spacing once: a gap under a collapsed tool, an overlap under an
 * opened one. */
const TranscriptMeasure = createContext<((row: HTMLElement) => void) | null>(null);

interface Props {
  workspaceId?: string;
  messages: ReadonlyArray<RenderMsg>;
  pending: RenderMsg | null;
  /** Local first input awaiting authoritative history; not a transcript message. */
  submittedInput?: Pick<RenderMsg, "text" | "attachments"> | null;
  tools: Record<string, ToolExecution>;
  /** Startup or Pi work awaiting reply text: the keys play in the reply area. */
  activity?: "starting" | "working";
  /** Agent lifecycle, independent of whether the working indicator is visible. */
  working?: boolean;
  /** Shown above an empty transcript; the caller decides when (see `sessionPane`). */
  placeholder?: string;
  className?: string;
  /** Show only jump-list messages and errors without changing authoritative history. */
  showTools?: boolean;
  /** The session that dispatched this one; "unlisted" when the catalog cannot open it. */
  dispatchedFrom?: SessionDestination | "unlisted";
}

/**
 * The transcript. Every row is a glyph in a narrow gutter followed by its content:
 * `›` for what you said, `•` for what Pi said, a dot for each tool call whose colour is its outcome.
 * Tool results are folded under the call that produced them.
 */
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
  const rows = useMemo(
    () => transcriptRows(messages, { pending, tools, showTools, working }),
    [messages, pending, tools, showTools, working],
  );
  const { virtual, jumping } = useVirtualTranscript(rows, ref, list, viewport);
  const measureRow = useCallback(
    (row: HTMLElement) => {
      // After the commit that asked: Radix removes closed content in a nested commit right after
      // it. flushSync re-renders the rows' positions in this task, before the browser paints.
      // `resizeItem`, not `measureElement`: without a ResizeObserver entry the latter answers
      // from its cache.
      queueMicrotask(() => {
        if (!row.isConnected) return;
        flushSync(() => virtual.resizeItem(virtual.indexFromElement(row), row.offsetHeight));
      });
    },
    [virtual],
  );
  const window = virtual.getVirtualItems();
  // Geometry stays urgent; mounting fresh Markdown can yield between rows. During a fast
  // thumb drag, height-preserving placeholders cover the new window rather than blank space.
  const deferredWindow = useDeferredValue(window);
  const readyKeys = new Set(deferredWindow.map((item) => item.key));

  return (
    <div className={cn("relative min-h-0 flex-1", className)}>
      <div
        ref={ref}
        // Read intent before the virtualizer's native scroll listener can synchronously render.
        onScrollCapture={viewport.scrolled}
        data-slot="transcript"
        data-message-count={messages.length}
        data-window-pending={
          virtual.isScrolling && !jumping && window.some((item) => !readyKeys.has(item.key))
            ? ""
            : undefined
        }
        // The scroller spans the area, so its scrollbar keeps the pane's edge beside the rail.
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
                  {/* Custom geometry hosts: shadcn has no variable-height virtual transcript.
                    A row taller than its estimate is clipped until measured: its overflow would
                    grow the scroll height, a pinned view would follow it, and the scroll would
                    unmount the row again, a loop Firefox never leaves. The margin keeps focus
                    rings and the jump highlight (6px) whole; Chromium honours it only when both
                    axes clip. */}
                  <div
                    ref={list}
                    className="relative overflow-clip [overflow-clip-margin:6px]"
                    style={{ height: virtual.getTotalSize() }}
                  >
                    {window.map((item) => {
                      const row = rows[item.index];
                      const next = rows[item.index + 1];
                      const adjacentTools =
                        row.kind === "reply" &&
                        row.tools.length > 0 &&
                        next?.kind === "reply" &&
                        !next.text &&
                        next.tools.length > 0;
                      const ready = jumping || !virtual.isScrolling || readyKeys.has(item.key);
                      const gap = next ? (adjacentTools ? 12 : 24) : 0;
                      return (
                        <div
                          key={item.key}
                          ref={ready ? virtual.measureElement : undefined}
                          data-index={item.index}
                          className="absolute left-0 top-0 flex w-full flex-col gap-6"
                          style={{
                            // Layout coordinates keep a tool's sticky top at the scrollport;
                            // a transform would translate the sticky header's pinning line too.
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
                                {/* Fill even a measured, very tall row: its first lines may already
                                  be above the viewport during a fast scroll. */}
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
  /** Phrasing content when the whole row sits inside a disclosure button. */
  as?: "div" | "span";
}) {
  return (
    <Tag className={cn("flex gap-3", className)}>
      {/* Exactly one line tall, so the glyph centres on the first line of text beside it. Content
          must not pad its first line (a folding row keeps its padding out of flow); the
          transcript-rows journey measures every row kind. */}
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
  // Saved replies parse once rather than mounting a parser per streaming block. A live reply
  // retains its streaming block identities when it completes, until this window unmounts it.
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
              {/* Labels and controls are select-none, so copied or quoted text is only what was said. */}
              <span className="sr-only select-none">Pi said</span>
              <Markdown
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

/**
 * A transcript row that folds: a gutter glyph, a header that opens and closes it, and a body under
 * the header. Context rows, tool calls, dispatched sessions and skill expansions all fold through it,
 * so the disclosure, chevron and body indent are decided here once. Tool headers include their
 * gutter and in-flow padding in the button; other disclosures keep padding out of flow to align
 * with their outer gutter. Without a glyph the row sits inside another
 * row's content (a skill in its prompt bubble), so neither header nor body takes a gutter.
 */
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
  /** What the row is: its title, a quiet note, a badge. The chevron follows it. */
  header: React.ReactNode;
  /** The group's accessible name. */
  label: string;
  defaultOpen?: boolean;
  /** False when there is nothing to show: the header stays, without a chevron or a body. */
  canOpen?: boolean;
  headerClassName?: string;
  /** The body sits under a rule; a tool call's body draws its own boxes instead. */
  ruled?: boolean;
  bodyClassName?: string;
  /** `data-*` attributes for tests and evidence scripts. */
  data?: Record<`data-${string}`, string | undefined>;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
  /** A control beside the header, outside the button that folds the row. */
  action?: React.ReactNode;
  /** One disclosure for a tool's entire output; only tall, top-level tools pin their header. */
  toolOutput?: boolean;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useTranscriptDisclosure(stateKey ?? label, defaultOpen);
  const root = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(false);
  const [tall, setTall] = useState(false);
  const viewport = useTranscriptViewport();
  const measureRow = useContext(TranscriptMeasure);
  const wasOpen = useRef(open);
  // A tool fold changes height without an animation: move the rows below before the paint.
  useLayoutEffect(() => {
    if (!toolOutput || wasOpen.current === open) return;
    wasOpen.current = open;
    const row = root.current?.closest<HTMLElement>("[data-index]");
    if (row) measureRow?.(row);
  }, [toolOutput, open, measureRow]);
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
    // Opening holds the view on the header the reader clicked; collapsing keeps that header where
    // they see it. The viewport decides both, before the fold changes height.
    if (toolOutput && open !== next) {
      viewport?.fold(next, () => {
        const el = root.current;
        const head = heading.current;
        return el && head ? domFoldEdges(el, head) : undefined;
      });
    }
    // Closing removes the bottom shortcut: when it held focus, move focus to the persistent
    // header disclosure, without a browser scrollIntoView. A header that was activated keeps
    // the focus it has; focusing it again from script would paint a focus ring in browsers
    // whose clicks do not focus buttons (WebKit).
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
  // A horizontal drag that starts on a header still opens the mobile sidebar; a tap folds.
  const title = (
    <>
      {header}
      {canOpen && <DisclosureChevron open={open} className="ml-auto" />}
    </>
  );
  const trigger = (
    <CollapsibleTrigger asChild disabled={!canOpen}>
      <button
        type="button"
        data-sidebar-swipe="true"
        className={cn(
          disclosureRow,
          // Keep the original header's 4px padding in flow, including while pinned. The gutter
          // and padding belong to the button too; output stays outside it. The chevron keeps
          // its 8px inset from the content edge, where the out-of-flow header left it.
          toolOutput && "m-0 w-full py-1 pr-2 pl-0",
          action && "w-auto flex-1",
          !toolOutput && headerClassName,
        )}
      >
        {toolOutput ? (
          <Row as="span" glyph={glyph} className="w-full">
            <span className={cn("flex min-w-0 items-center gap-2", headerClassName)}>{title}</span>
          </Row>
        ) : (
          title
        )}
      </button>
    </CollapsibleTrigger>
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
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="xs" className="mt-2 -ml-2 self-start">
            Collapse
          </Button>
        </CollapsibleTrigger>
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
        // A normal-flow header bounded by this Collapsible, not a floating overlay. Nested
        // tool details are plain content and never acquire their own sticky header.
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
        // Tool collapse is immediate so virtual-row measurement cannot chase an exit animation.
        <CollapsibleContent className={toolOutput ? undefined : "disclosure-content"}>
          {glyph === undefined ? (
            <div className="pt-2">{body}</div>
          ) : (
            <Row glyph={null} className="pt-2">
              {body}
            </Row>
          )}
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}

/** Context Pi inserted rather than said: a compaction or branch summary, shell output, or an
 * extension's note. It starts open: after a compaction it is the transcript's only earlier record. */
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
        <Markdown text={msg.text} className="prose-chat" />
      ) : (
        <pre className="whitespace-pre-wrap break-words text-xs">{msg.text}</pre>
      )}
    </FoldRow>
  );
}

function ErrorMessage({ error, id }: { error: MessageError; id?: string }) {
  const [open, setOpen] = useTranscriptDisclosure("error");
  return (
    // A transcript error is a standalone row, not a boxed callout inside an assistant message.
    <div id={id}>
      <Row glyph={<span className="text-err">!</span>}>
        <p role="alert" className="break-words text-err">
          {error.summary}
        </p>
        {error.details && (
          <Collapsible open={open} onOpenChange={setOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="xs" className="-ml-2">
                Error details
                <DisclosureChevron open={open} />
              </Button>
            </CollapsibleTrigger>
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

/** A prompt shows at most this many lines until opened; pasted logs and long briefs stay out of the way. */
const USER_LINES = 6;

function CopyResponse({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <Button
      variant="ghost"
      size="xs"
      aria-label={copied ? "Response copied" : "Copy response"}
      className={cn(
        "mt-2 -ml-2 text-ink-3 opacity-0 select-none group-hover/reply:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100",
        copied && "text-brand opacity-100",
      )}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        } catch {
          setCopied(false);
          toast.error("Couldn’t copy. Select the reply text to copy it.");
        }
      }}
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
  // A read here would interleave with adjacent Markdown layout effects' writes, forcing a
  // transcript layout per prompt. The parent batches these reads; ResizeObserver handles local
  // expansion and column resizing, including changes that don't render the parent.
  // biome-ignore lint/correctness/useExhaustiveDependencies: text and expansion change the measured DOM; a capped element may gain overflow without resizing.
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
  // A long prompt opens and closes from its toggle button, or by clicking anywhere on it.
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the click is a pointer shortcut for the toggle button below, which keyboard users reach.
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
            <Markdown text={text} mode="static" className="prose-chat" />
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
              <ChevronDownIcon className={cn(open && "rotate-180")} aria-hidden />
            </Button>
          </div>
        )}
        <MessageAttachments items={attachments} />
      </Row>
    </article>
  );
}

/**
 * A `/skill:name` prompt. It is part of what was said, so it sits inside the prompt bubble; the
 * row names the command the way it was typed, and the skill file Pi put in its place is reference
 * material, so it stays folded until the reader asks for it.
 */
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
      // The bubble's line height, so the prompt's › glyph centres on this first line.
      headerClassName="leading-6"
      // Clicks here open the skill, never the prompt's own long-text disclosure around it.
      onClick={(e) => e.stopPropagation()}
    >
      <p className="mb-2 truncate font-mono text-xs text-ink-3">{abbrevHome(skill.location)}</p>
      <Markdown text={skill.body} className="prose-chat text-ink-2" />
    </FoldRow>
  );
}

/** A session a dispatch tool started or waited on: the call's arguments, what the parent observed, and a way
 * to open it beside the header, so reaching the session never needs the row unfolded. */
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
      glyph={<span className={cn("block size-2 rounded-full", DOT[outcome])} />}
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
        // The scroll container wraps the <pre>, as in PreviewDetailsDialog, where a scrollable
        // <pre> broke drag selection in Firefox.
        <div className="overflow-x-auto rounded-lg bg-fill">
          <pre className="whitespace-pre-wrap break-words px-3 py-2 text-ink-2">
            {clamp(params, 8000)}
          </pre>
        </div>
      )}
      {answer && <Markdown text={clamp(answer, 20000)} className="prose-chat" />}
    </FoldRow>
  );
}

/** A link that opens a session in place; its address keeps a new tab or a copied link working. */
function useSessionLink(cwd: string, sessionId: string) {
  // Absent where the transcript renders outside the app, as in module tests.
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
    <IconButton asChild label="Open session" size="inline" className="-my-1 shrink-0 text-ink-3">
      <a {...link}>
        {/* Go there, beside the chevron's expand here: its size, and no box, unlike leaving Piano. */}
        <ArrowUpRightIcon className="size-3.5" />
      </a>
    </IconButton>
  );
}

/** The dispatched session's way back: the session that started it, above the brief it was sent. */
function DispatchedFrom({ parent }: { parent: NonNullable<Props["dispatchedFrom"]> }) {
  return (
    // The row, not the line, takes the size: the gutter is one of the row's own lines tall.
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
  // An inline link inside a sentence: no shadcn component reads as running text.
  return (
    <a
      {...link}
      className="font-medium text-ink-2 underline-offset-4 outline-none hover:text-ink hover:underline focus-visible:underline"
    >
      {label}
    </a>
  );
}

const DOT: Record<ToolOutcome, string> = {
  running: "bg-busy",
  failed: "bg-err",
  done: "bg-ok",
  incomplete: "bg-ink-3",
  pending: "bg-ink-3",
};

/** Human replies belong in the transcript, paired with their questions rather than raw tool JSON. */
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
              <ItemTitle className="line-clamp-none whitespace-pre-wrap break-words">
                {question}
              </ItemTitle>
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

function Tool({
  call,
  outcome,
  output,
  nested,
  nestedComplete,
  verb,
  knownTool,
  summary,
  dispatch,
  answers,
}: ToolRow) {
  if (answers) return <QuestionAnswersRow answers={answers} stateKey={call.id} />;
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
  const details = toolArgsText(call.args);

  return (
    <FoldRow
      glyph={<span className={cn("block size-2 rounded-full", DOT[outcome])} />}
      header={
        <>
          <span className={cn("shrink-0 font-medium", failed ? "text-err" : "text-ink")}>
            {verb}
            {!knownTool && (
              <span className="ml-1 font-mono font-normal text-ink-2">{call.name}</span>
            )}
          </span>
          {summary && (
            <span className="min-w-0 flex-1 truncate font-mono text-ink-2">{summary}</span>
          )}
          {knownTool && !summary && <span className="font-mono text-ink-2">{call.name}</span>}
        </>
      }
      label={`${call.name} tool call`}
      stateKey={call.id}
      toolOutput
      ruled={false}
    >
      {details && (
        // The scroll container wraps the <pre>, as in PreviewDetailsDialog, where a scrollable
        // <pre> broke drag selection in Firefox.
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
            {clamp(output, 20000)}
          </pre>
        </div>
      )}
      {nested.map((child) => (
        /* biome-ignore lint/a11y/useSemanticElements: a <fieldset> is for form controls. */ <div
          key={child.id}
          role="group"
          aria-label={`${child.name} tool call`}
          className="mt-2 border-l border-line pl-3 text-xs"
        >
          <p className="flex items-center gap-2">
            {child.name}{" "}
            <Badge variant={nestedStatus(child.status).badge}>
              {nestedStatus(child.status).label}
            </Badge>
          </p>
          <pre className="whitespace-pre-wrap break-words">
            {clamp(toolArgsText(child.args), 2000)}
          </pre>
          {child.outputKind === "unavailable" && <p className="text-ink-3">Output unavailable</p>}
          {child.text && (
            <pre className="whitespace-pre-wrap break-words">
              {clamp(stripAnsi(child.text), 4000)}
            </pre>
          )}
        </div>
      ))}
      {!nestedComplete && (
        <p className="text-xs text-warning">Some tool details are unavailable.</p>
      )}
    </FoldRow>
  );
}
