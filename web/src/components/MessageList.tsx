import type { RenderMsg, ToolExecution } from "@shared/wire";
import { cn } from "cn";
import {
  ArrowDownIcon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  GitBranchIcon,
  HistoryIcon,
  PuzzleIcon,
  SparklesIcon,
  TerminalIcon,
} from "lucide-react";
import {
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
import { DisclosureChevron } from "@/components/Disclosure";
import { Markdown } from "@/components/Markdown";
import { PianoButton } from "@/components/PianoButton";
import { Keys } from "@/components/PianoMark";
import { StatusBadge as Badge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { abbrevHome, clamp } from "@/lib/format";
import type { MessageError } from "@/lib/messageError";
import { disclosureRow } from "@/lib/styles";
import {
  BOTTOM_ENTRY,
  type ContextFacts,
  contextFacts,
  messageAnchorId,
  nestedStatus,
  type SubagentFacts,
  type ToolOutcome,
  type ToolRow,
  type TranscriptRow,
  transcriptRows,
} from "@/lib/transcript";
import { domViewportElement } from "@/lib/transcriptViewport";
import { useNewTranscriptViewport, useTranscriptViewport } from "@/lib/useTranscriptViewport";

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
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
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
            {submittedInput && (
              <UserMessage text={submittedInput.text} attachments={submittedInput.attachments} />
            )}
            {rows.map((row) => (
              <TranscriptRowView key={row.key} row={row} />
            ))}
            {activity && (
              <Row glyph={<Keys playing className="text-brand" />}>
                <span className="sr-only">
                  {activity === "starting" ? "Starting" : "Pi is working"}
                </span>
                <span
                  aria-hidden
                  className="inline-block h-[1em] w-0.5 animate-caret bg-brand align-[-0.15em]"
                />
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
          onClick={() => viewport.jump(BOTTOM_ENTRY)}
          className="absolute inset-x-0 bottom-4 mx-auto rounded-full shadow-2 animate-in fade-in-0 zoom-in-95 motion-reduce:animate-none [&_svg:not([class*='size-'])]:size-5"
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
  if (row.kind === "subagent")
    return <SubagentCardView {...row.subagent} markdown={row.msg.role === "context"} />;
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
 * A row for what Pi inserted or expanded rather than said: a gutter icon, a label, a quiet
 * monospace note and, once opened, a body under a rule. Context rows and skill expansions share
 * it, so they fold the same way.
 */
function FoldRow({
  glyph,
  title,
  note,
  label,
  open,
  onOpenChange,
  data,
  children,
}: {
  glyph: React.ReactNode;
  title: string;
  note?: string;
  /** The group's accessible name. */
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `data-*` attributes for tests and evidence scripts. */
  data?: Record<`data-${string}`, string | undefined>;
  children: React.ReactNode;
}) {
  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      role="group"
      aria-label={label}
      className="text-sm"
      {...data}
    >
      <Row glyph={glyph}>
        <CollapsibleTrigger asChild>
          <button type="button" className={disclosureRow}>
            <span className="shrink-0 font-medium text-ink">{title}</span>
            {note && <span className="min-w-0 flex-1 truncate font-mono text-ink-3">{note}</span>}
            <DisclosureChevron open={open} className="ml-auto" />
          </button>
        </CollapsibleTrigger>
      </Row>
      <CollapsibleContent className="disclosure-content">
        <Row glyph={null} className="pt-2">
          <div className="border-l-2 border-line pl-3 text-ink-2">{children}</div>
        </Row>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Context Pi inserted rather than said: a compaction or branch summary, shell output, or an
 * extension's note. It starts open: after a compaction it is the transcript's only earlier record. */
function ContextCard({ msg }: { msg: RenderMsg }) {
  const [open, setOpen] = useState(true);
  const facts = contextFacts(msg.label);
  const Icon = CONTEXT_ICON[facts.kind];
  return (
    <FoldRow
      glyph={<Icon className="size-3.5 text-ink-3" aria-hidden />}
      title={facts.title}
      note={facts.note}
      label={facts.title}
      open={open}
      onOpenChange={setOpen}
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
        "mt-2 -ml-2 text-ink-3 opacity-0 transition-opacity select-none group-hover/reply:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100",
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
      {copied ? <CheckIcon className="control-enter" /> : <CopyIcon />}
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
  // Measure against the cap while closed; re-measure when the column resizes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: text and expansion change the measured DOM; a capped element may gain overflow without resizing.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, open]);
  const clamped = !open && overflows;
  const long = overflows || open;
  const toggle = () => setOpen((o) => !o);
  // A long prompt opens and closes from its toggle button, or by clicking anywhere on it.
  const bubble = text || !skill || (attachments && attachments.length > 0);
  return (
    <div
      id={id ? messageAnchorId(id) : undefined}
      data-slot={id ? undefined : "submitted-input"}
      className="flex flex-col gap-3"
    >
      {/* Labels and controls are select-none, so copied or quoted text is only what was said. */}
      <span className="sr-only select-none">You said</span>
      {/* The skill Pi put in place of the command is a row of its own, folded, not part of the bubble. */}
      {skill && <SkillExpansion skill={skill} />}
      {bubble && (
        // biome-ignore lint/a11y/useKeyWithClickEvents: the click is a pointer shortcut for the toggle button below, which keyboard users reach.
        <article
          className={cn(
            "rounded-2xl border border-line bg-fill px-4 py-3.5 transition-colors",
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
            <div
              ref={ref}
              id={textId}
              className={cn(
                "break-words",
                !open && "overflow-hidden",
                clamped && "[mask-image:linear-gradient(to_bottom,black_60%,transparent)]",
              )}
              style={open ? undefined : { maxHeight: `${USER_LINES * 1.55}em` }}
            >
              <Markdown text={text} className="prose-chat" />
            </div>
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
                  <ChevronDownIcon
                    className={cn("transition-transform duration-200", open && "rotate-180")}
                    aria-hidden
                  />
                </Button>
              </div>
            )}
            <MessageAttachments items={attachments} />
          </Row>
        </article>
      )}
    </div>
  );
}

/**
 * A `/skill:name` prompt. The row names the command the way it was typed; the skill file Pi
 * put in its place is reference material, so it stays folded until the reader asks for it.
 */
function SkillExpansion({ skill }: { skill: NonNullable<RenderMsg["skill"]> }) {
  const [open, setOpen] = useState(false);
  return (
    <FoldRow
      glyph={<SparklesIcon className="size-3.5 text-brand" aria-hidden />}
      title="Skill"
      note={`/skill:${skill.name}`}
      label={`${skill.name} skill`}
      open={open}
      onOpenChange={setOpen}
    >
      <p className="mb-2 truncate font-mono text-xs text-ink-3">{abbrevHome(skill.location)}</p>
      <Markdown text={skill.body} className="prose-chat" />
    </FoldRow>
  );
}

const SUBAGENT_DOT: Record<SubagentFacts["dot"], string> = {
  err: "bg-err",
  ok: "bg-ok",
  idle: "bg-ink-3",
};

/** Structured pi-subagent facts use the standard disclosure primitive. The
 * transcript row itself is intentionally quiet; identity and output stay on demand. */
function SubagentCardView({
  card,
  title,
  ariaLabel,
  isResult,
  profile,
  runId,
  statusLabel,
  badge,
  dot,
  failed,
  output,
  details,
  hasDetails,
  markdown = false,
}: SubagentFacts & { markdown?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      role="group"
      aria-label={ariaLabel}
      data-slot={card.kind === "delegation" ? "delegation-card" : "subagent-result-card"}
      data-run-id={runId}
      className="text-sm"
    >
      <Row glyph={<span className={cn("block size-2 rounded-full", SUBAGENT_DOT[dot])} />}>
        <CollapsibleTrigger asChild disabled={!hasDetails}>
          <button type="button" className={cn(disclosureRow, "max-sm:flex-wrap")}>
            <span className="min-w-0 flex-1 truncate font-medium text-ink">
              {isResult && <span className="font-normal text-ink-3">Result · </span>}
              {title}
            </span>
            {profile && <span className="max-w-28 shrink truncate text-ink-3">{profile}</span>}
            <Badge
              variant={badge}
              className="max-w-full min-w-0 whitespace-normal max-sm:order-last max-sm:basis-full sm:max-w-56"
            >
              <span className="min-w-0 break-words">{statusLabel}</span>
            </Badge>
            {hasDetails && <DisclosureChevron open={open} />}
          </button>
        </CollapsibleTrigger>
      </Row>
      {hasDetails && (
        <CollapsibleContent className="disclosure-content">
          <Row glyph={null} className="pt-2">
            <div className="flex flex-col gap-3 border-l-2 border-line pl-3 text-ink-2">
              {details.map((detail) =>
                detail.kind === "identity" ? (
                  <dl
                    key="identity"
                    className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs"
                  >
                    {detail.subagentId && (
                      <>
                        <dt className="text-ink-3">Subagent</dt>
                        <dd className="break-all font-mono">{detail.subagentId}</dd>
                      </>
                    )}
                    {detail.runId && (
                      <>
                        <dt className="text-ink-3">Run</dt>
                        <dd className="break-all font-mono">{detail.runId}</dd>
                      </>
                    )}
                  </dl>
                ) : detail.kind === "text" ? (
                  <div key={detail.label}>
                    <p className="mb-1 text-xs text-ink-3">{detail.label}</p>
                    <pre className="whitespace-pre-wrap break-words">
                      {clamp(detail.text, 8000)}
                    </pre>
                  </div>
                ) : (
                  <p
                    key={`${detail.kind}:${detail.text}`}
                    className={cn(
                      "text-xs",
                      detail.kind === "run" ? "break-all font-mono" : "text-ink-3",
                    )}
                  >
                    {detail.text}
                  </p>
                ),
              )}
              {output &&
                (markdown ? (
                  <Markdown text={output} className="prose-chat" />
                ) : (
                  <pre className={cn("whitespace-pre-wrap break-words", failed && "text-err")}>
                    {clamp(output, 20000)}
                  </pre>
                ))}
            </div>
          </Row>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}

const PREVIEW_LINES = 5;

const DOT: Record<ToolOutcome, string> = {
  running: "animate-live bg-busy",
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
  subagent,
}: ToolRow) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  if (subagent) return <SubagentCardView {...subagent} />;
  const failed = outcome === "failed";
  const lines = (output ?? "").split("\n");
  const shown = all ? lines : lines.slice(0, PREVIEW_LINES);
  const hidden = lines.length - shown.length;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      role="group"
      aria-label={`${call.name} tool call`}
      className="text-sm"
    >
      <Row
        glyph={
          <span
            className={cn("block size-2 rounded-full transition-colors duration-300", DOT[outcome])}
          />
        }
      >
        <CollapsibleTrigger asChild>
          <button type="button" data-sidebar-swipe="true" className={disclosureRow}>
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
            <DisclosureChevron open={open} className="ml-auto" />
          </button>
        </CollapsibleTrigger>
      </Row>
      {call.args && (
        <CollapsibleContent className="disclosure-content">
          <Row glyph={null} className="pt-2">
            <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-fill px-3 py-2 text-ink-2">
              {clamp(call.args, 4000)}
            </pre>
          </Row>
        </CollapsibleContent>
      )}
      {output && open && (
        <Row glyph={null} className="mt-1">
          <pre
            className={cn(
              "border-l-2 border-line py-1 pl-3 whitespace-pre-wrap break-all",
              failed ? "text-err" : "text-ink-2",
            )}
          >
            {clamp(shown.join("\n"), all ? 20000 : 2000)}
          </pre>
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
        </Row>
      )}
      {open &&
        nested.map((child) => (
          /* biome-ignore lint/a11y/useSemanticElements: a <fieldset> is for form controls. */ <div
            key={child.id}
            role="group"
            aria-label={`${child.name} tool call`}
            className="ml-7 mt-2 border-l border-line pl-3 text-xs"
          >
            <p className="flex items-center gap-2">
              {child.name}{" "}
              <Badge variant={nestedStatus(child.status).badge}>
                {nestedStatus(child.status).label}
              </Badge>
            </p>
            <pre className="whitespace-pre-wrap break-words">{clamp(child.args, 2000)}</pre>
            {child.outputKind === "unavailable" && <p className="text-ink-3">Output unavailable</p>}
            {child.text && (
              <pre className="whitespace-pre-wrap break-words">{clamp(child.text, 4000)}</pre>
            )}
          </div>
        ))}
      {open && !nestedComplete && (
        <p className="pl-7 text-xs text-warning">Some tool details are unavailable.</p>
      )}
    </Collapsible>
  );
}
