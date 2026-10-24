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
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { toast } from "sonner";
import { MessageAttachments } from "@/components/Attachments";
import { BranchLabel } from "@/components/BranchLabel";
import { DisclosureChevron } from "@/components/Disclosure";
import { IconButton } from "@/components/IconButton";
import { Markdown } from "@/components/Markdown";
import { PianoButton } from "@/components/PianoButton";
import { Keys } from "@/components/PianoMark";
import { StatusBadge as Badge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
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
  type ToolOutcome,
  type ToolRow,
  type TranscriptRow,
  transcriptRows,
} from "@/lib/transcript";
import { domViewportElement } from "@/lib/transcriptViewport";
import { NavigationContext } from "@/lib/useNavigation";
import { useNewTranscriptViewport, useTranscriptViewport } from "@/lib/useTranscriptViewport";

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

interface Props {
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
  const content = useRef<HTMLDivElement>(null);
  const [promptMeasurements] = useState(() => new Set<() => void>());
  useLayoutEffect(() => {
    for (const measure of promptMeasurements) measure();
    promptMeasurements.clear();
  });
  const own = useNewTranscriptViewport();
  const viewport = useTranscriptViewport() ?? own;
  const atBottom = useSyncExternalStore(viewport.subscribe, viewport.atBottom, () => true);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    viewport.attach(domViewportElement(el));
    return () => viewport.attach(null);
  }, [viewport]);
  // Keep the view pinned to the bottom unless the reader scrolled up.
  // biome-ignore lint/correctness/useExhaustiveDependencies: these inputs change rendered transcript height; reading the DOM after each change preserves scroll pinning.
  useEffect(() => {
    viewport.rendered();
  }, [viewport, messages, pending, submittedInput, tools, activity, showTools, working]);
  // Content can grow without a scroll event (a prompt opens, output expands), and the container
  // can shrink (a banner appears below, the composer grows); the viewport decides who follows.
  useEffect(() => {
    const el = ref.current;
    const inner = content.current;
    if (!el || !inner) return;
    const ro = new ResizeObserver((entries) =>
      viewport.resized({ container: entries.some((entry) => entry.target === el) }),
    );
    ro.observe(inner);
    ro.observe(el);
    return () => ro.disconnect();
  }, [viewport]);

  const rows = useMemo(
    () => transcriptRows(messages, { pending, tools, showTools, working }),
    [messages, pending, tools, showTools, working],
  );

  return (
    <div className={cn("relative min-h-0 flex-1", className)}>
      <div
        ref={ref}
        onScroll={viewport.scrolled}
        data-slot="transcript"
        className="h-full overflow-y-auto px-4 md:px-6"
      >
        <div ref={content} className="mx-auto w-full max-w-3xl py-6 md:py-8">
          {placeholder && (
            <Empty className="py-16">
              <EmptyHeader>
                <EmptyDescription className="text-base">{placeholder}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          {/* Adjacent tool rows keep one gap, even when the previous message also had text. */}
          <div className="flex flex-col gap-6 [&>[data-ends-with-tools]+[data-tools-only]]:-mt-3">
            {dispatchedFrom && <DispatchedFrom parent={dispatchedFrom} />}
            <PromptMeasurementsContext value={promptMeasurements}>
              {submittedInput && (
                <UserMessage text={submittedInput.text} attachments={submittedInput.attachments} />
              )}
              {rows.map((row) => (
                <TranscriptRowView key={row.key} row={row} />
              ))}
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
          className="absolute inset-x-0 bottom-4 mx-auto rounded-full shadow-2 [&_svg:not([class*='size-'])]:size-5"
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
}: {
  glyph: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex gap-3", className)}>
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
      <div data-slot="row-content" className="min-w-0 flex-1">
        {children}
      </div>
    </div>
  );
}

function TranscriptRowView({ row }: { row: TranscriptRow }) {
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
              <Markdown text={text} className={cn("prose-chat", streaming && "streaming-caret")} />
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
}

const CONTEXT_ICON: Record<ContextFacts["kind"], typeof HistoryIcon> = {
  compaction: HistoryIcon,
  branch: GitBranchIcon,
  shell: TerminalIcon,
  extension: PuzzleIcon,
};

/**
 * A transcript row that folds: a gutter glyph, a header that opens and closes it, and a body under
 * the header. Context rows, tool calls, dispatched sessions and skill expansions all fold through it,
 * so the header's out-of-flow padding (`disclosureRow`), the chevron, the body's indent and its
 * open and close animation are decided here once. Without a glyph the row sits inside another
 * row's content (a skill in its prompt bubble), so neither header nor body takes a gutter.
 */
function FoldRow({
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
  children,
}: {
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
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  // A horizontal drag that starts on a header still opens the mobile sidebar; a tap folds.
  const trigger = (
    <CollapsibleTrigger asChild disabled={!canOpen}>
      <button
        type="button"
        data-sidebar-swipe="true"
        className={cn(disclosureRow, action && "w-auto flex-1", headerClassName)}
      >
        {header}
        {canOpen && <DisclosureChevron open={open} className="ml-auto" />}
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
    </div>
  );
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      role="group"
      aria-label={label}
      className="text-sm"
      onClick={onClick}
      {...data}
    >
      {glyph === undefined ? head : <Row glyph={glyph}>{head}</Row>}
      {canOpen && (
        <CollapsibleContent className="disclosure-content">
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
  const [open, setOpen] = useState(false);
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
  const [open, setOpen] = useState(false);
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
            <Markdown text={text} className="prose-chat" />
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
function DispatchRow({ session, outcome }: { session: DispatchFacts; outcome: ToolOutcome }) {
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
      canOpen={!!(params || answer || detail)}
      bodyClassName="flex flex-col gap-3"
      data={{ "data-slot": "dispatch-row", "data-session-id": sessionId ?? undefined }}
      action={destination !== "unlisted" && <OpenSession {...destination} />}
    >
      {detail && <p className="text-xs text-ink-3">{detail}</p>}
      {params && (
        <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-fill px-3 py-2 text-ink-2">
          {clamp(params, 8000)}
        </pre>
      )}
      {answer && <FoldedOutput text={answer} markdown failed={false} />}
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
    <IconButton asChild label="Open session" size="icon-xs" className="-my-1 shrink-0 text-ink-3">
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

const PREVIEW_LINES = 5;

/** Output folded to its first lines, with the rest on demand: a tool's text as it came, or a
 * session's answer as Markdown. */
function FoldedOutput({
  text,
  markdown,
  failed,
  className,
}: {
  text: string;
  markdown: boolean;
  failed: boolean;
  className?: string;
}) {
  const [all, setAll] = useState(false);
  const lines = text.split("\n");
  const shown = all ? lines : lines.slice(0, PREVIEW_LINES);
  const hidden = lines.length - shown.length;
  const visible = clamp(shown.join("\n"), all ? 20000 : 2000);
  // A block, never a fragment: inside a flex column the fold button would stretch and centre.
  return (
    <div>
      {markdown ? (
        <Markdown text={visible} className={cn("prose-chat", className)} />
      ) : (
        <pre
          className={cn(
            "whitespace-pre-wrap break-all",
            failed ? "text-err" : "text-ink-2",
            className,
          )}
        >
          {visible}
        </pre>
      )}
      {hidden > 0 && (
        <Button
          variant="link"
          size="xs"
          onClick={() => setAll(true)}
          className="mt-0.5 h-auto px-0 text-ink-3"
        >
          … {hidden} more {hidden === 1 ? "line" : "lines"}
        </Button>
      )}
      {all && lines.length > PREVIEW_LINES && (
        <Button
          variant="link"
          size="xs"
          onClick={() => setAll(false)}
          className="mt-0.5 h-auto px-0 text-ink-3"
        >
          Show less
        </Button>
      )}
    </div>
  );
}

const DOT: Record<ToolOutcome, string> = {
  running: "bg-busy",
  failed: "bg-err",
  done: "bg-ok",
  incomplete: "bg-ink-3",
  pending: "bg-ink-3",
};

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
}: ToolRow) {
  if (dispatch)
    return dispatch.map((session, i) => (
      <DispatchRow key={session.sessionId ?? i} session={session} outcome={outcome} />
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
      ruled={false}
    >
      {details && (
        <pre className="overflow-x-auto whitespace-pre rounded-lg bg-fill px-3 py-2 text-ink-2">
          {clamp(details, 4000)}
        </pre>
      )}
      {output && (
        <div data-slot="tool-output" className={cn(details && "mt-1")}>
          <FoldedOutput
            text={output}
            markdown={false}
            failed={failed}
            className="border-l-2 border-line py-1 pl-3"
          />
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
