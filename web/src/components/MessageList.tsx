import type { RenderMsg, SubagentCard, ToolExecution } from "@shared/wire";
import { cn } from "cn";
import { ArrowDownIcon, CheckIcon, ChevronDownIcon, CopyIcon, SparklesIcon } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { MessageAttachments } from "@/components/Attachments";
import { DisclosureChevron } from "@/components/Disclosure";
import { Markdown } from "@/components/Markdown";
import { Keys } from "@/components/PianoMark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { abbrevHome, clamp } from "@/lib/format";
import type { MessageError } from "@/lib/messageError";
import { disclosureRow } from "@/lib/styles";
import { messageAnchorId, STICK_EVENT, type SubagentFacts, type ToolOutcome, type ToolRow, type TranscriptRow, transcriptRows } from "@/lib/transcript";

interface Props {
  messages: ReadonlyArray<RenderMsg>;
  pending: RenderMsg | null;
  /** Local first input awaiting authoritative history; not a transcript message. */
  submittedInput?: Pick<RenderMsg, "text" | "attachments"> | null;
  tools: Record<string, ToolExecution>;
  /** Startup or Pi work awaiting reply text: the keys play in the reply area. */
  activity?: "starting" | "working";
  /** Shown while the transcript is empty; omitted while something is on its way. */
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
export function MessageList({ messages, pending, submittedInput, tools, activity, placeholder, className, showTools = true }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  // Keep the view pinned to the bottom unless the reader scrolled up.
  // biome-ignore lint/correctness/useExhaustiveDependencies: these inputs change rendered transcript height; reading the DOM after each change preserves scroll pinning.
  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, pending, submittedInput, tools, activity, showTools]);
  // Content can grow without a scroll event (a prompt opens, output expands). That only
  // changes whether the bottom is in view; it never moves the reader. The container itself
  // shrinking (a banner appears below, the composer grows) is not the reader's
  // doing, so a pinned view follows the bottom.
  useEffect(() => {
    const el = ref.current;
    const inner = content.current;
    if (!el || !inner) return;
    const measure = () => setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
    const ro = new ResizeObserver((entries) => {
      if (stick.current && entries.some((entry) => entry.target === el)) el.scrollTop = el.scrollHeight;
      measure();
    });
    ro.observe(inner);
    ro.observe(el);
    // A jump to the end pins the view there even if content grows while the scroll is in flight.
    const stickToBottom = () => { stick.current = true; };
    el.addEventListener(STICK_EVENT, stickToBottom);
    return () => { ro.disconnect(); el.removeEventListener(STICK_EVENT, stickToBottom); };
  }, []);
  const scrollToBottom = () => {
    const el = ref.current;
    if (!el) return;
    stick.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };

  const rows = useMemo(() => transcriptRows(messages, { pending, tools, showTools }), [messages, pending, tools, showTools]);

  return (
    <div className={cn("relative min-h-0 flex-1", className)}>
      <div
        ref={ref}
        onScroll={(e) => {
          const el = e.currentTarget;
          const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          stick.current = near;
          setAtBottom(near);
        }}
        data-slot="transcript"
        className="h-full overflow-y-auto px-4 md:px-6"
      >
      <div ref={content} className="mx-auto w-full max-w-3xl py-6 md:py-8">
        {placeholder && messages.length === 0 && !pending && !submittedInput && !activity && (
          <Empty className="py-16">
            <EmptyHeader>
              <EmptyDescription className="text-base">{placeholder}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {/* Adjacent tool rows keep one gap, even when the previous message also had text. */}
        <div className="flex flex-col gap-6 [&>[data-ends-with-tools]+[data-tools-only]]:-mt-3">
          {submittedInput && <UserMessage text={submittedInput.text} attachments={submittedInput.attachments} />}
          {rows.map(row => <TranscriptRowView key={row.key} row={row} />)}
          {activity && (
            <Row glyph={<Keys playing className="text-brand" />}>
              <span className="sr-only">{activity === "starting" ? "Starting" : "Pi is working"}</span>
              <span aria-hidden className="inline-block h-[1em] w-0.5 animate-caret bg-brand align-[-0.15em]" />
            </Row>
          )}
        </div>
      </div>
      </div>
      {!atBottom && (
        <Button
          type="button"
          variant="outline"
          size="icon-lg"
          aria-label="Scroll to bottom"
          onClick={scrollToBottom}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full shadow-2 animate-in fade-in-0 zoom-in-95 motion-reduce:animate-none [&_svg:not([class*='size-'])]:size-5"
        >
          <ArrowDownIcon />
        </Button>
      )}
    </div>
  );
}

function Row({ glyph, children, className }: { glyph: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex gap-3", className)}>
      {/* Exactly one line tall, so the glyph centres on the first line of text beside it. */}
      <span className="flex h-[1lh] w-4 shrink-0 items-center justify-center select-none" aria-hidden>
        {glyph}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function TranscriptRowView({ row }: { row: TranscriptRow }) {
  if (row.kind === "subagent") return <SubagentCardView {...row.subagent} markdown={row.msg.role === "context"} />;
  if (row.kind === "context") return <article><p className="text-xs text-ink-3">{row.msg.label}</p><pre className="whitespace-pre-wrap break-words text-sm">{row.msg.text}</pre></article>;
  if (row.kind === "user") return <UserMessage id={row.msg.id} text={row.text} skill={row.msg.skill} attachments={row.msg.attachments} />;
  if (row.kind === "orphan") return <Tool {...row.tool} />;
  const { msg, text, error, streaming } = row;
  const hasTools = row.tools.length > 0;
  return (
    <>
    {(text || hasTools) && <article
      id={streaming ? undefined : messageAnchorId(msg.id)}
      data-tools-only={!text && hasTools ? "" : undefined}
      data-ends-with-tools={hasTools ? "" : undefined}
      className="group/reply flex flex-col gap-6 rounded-2xl"
    >
      {text && (
        <Row glyph={streaming ? <Keys playing className="text-brand" /> : <span className="text-ink-3">•</span>}>
          <span className="sr-only">Pi said</span>
          <Markdown text={text} className={cn("prose-chat", streaming && "streaming-caret")} />
          {row.jump && <CopyResponse text={text} />}
        </Row>
      )}
      {hasTools && (
        <div className="flex flex-col gap-3">
          {row.tools.map(tool => <Tool key={tool.call.id} {...tool} />)}
        </div>
      )}
    </article>}
    {error && <ErrorMessage error={error} id={!streaming && !text && !hasTools ? messageAnchorId(msg.id) : undefined} />}
    </>
  );
}

function ErrorMessage({ error, id }: { error: MessageError; id?: string }) {
  const [open, setOpen] = useState(false);
  return (
    // A transcript error is a standalone row, not a boxed callout inside an assistant message.
    <div id={id}>
      <Row glyph={<span className="text-err">!</span>}>
        <p role="alert" className="break-words text-err">{error.summary}</p>
        {error.details && (
          <Collapsible open={open} onOpenChange={setOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="xs" className="-ml-2">
                Error details
                <DisclosureChevron open={open} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="disclosure-content">
              <pre className="whitespace-pre-wrap break-words text-sm text-ink-2">{error.details}</pre>
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
      className={cn("mt-2 -ml-2 text-ink-3 opacity-0 transition-opacity group-hover/reply:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100", copied && "text-brand opacity-100")}
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

function UserMessage({ id, text, skill, attachments }: { id?: string; text: string; skill?: RenderMsg["skill"]; attachments: RenderMsg["attachments"] }) {
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
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the click is a pointer shortcut for the toggle button below, which keyboard users reach.
    <article
      id={id ? messageAnchorId(id) : undefined}
      data-slot={id ? undefined : "submitted-input"}
      className={cn("rounded-2xl border border-line bg-fill px-4 py-3.5 transition-colors", long && "cursor-pointer select-text hover:border-line-strong")}
      onClick={(event) => long && !(event.target as Element).closest("a, button, [role='dialog']") && !window.getSelection()?.toString() && toggle()}
    >
      <Row glyph={<span className="font-semibold text-brand">›</span>}>
        <span className="sr-only">You said</span>
        {skill && <SkillExpansion skill={skill} />}
        {(text || !skill) && (
          <div
            ref={ref}
            id={textId}
            className={cn("break-words", skill && "mt-2", !open && "overflow-hidden", clamped && "[mask-image:linear-gradient(to_bottom,black_60%,transparent)]")}
            style={open ? undefined : { maxHeight: `${USER_LINES * 1.55}em` }}
          >
            <Markdown text={text} className="prose-chat" />
          </div>
        )}
        {long && (
          <div className="flex justify-end">
            <Button variant="ghost" size="xs" className="-mr-2 text-ink-3" aria-expanded={open} aria-controls={textId} onClick={(e) => { e.stopPropagation(); toggle(); }}>
              {open ? "Show less" : "Show more"}
              <ChevronDownIcon className={cn("transition-transform duration-200", open && "rotate-180")} aria-hidden />
            </Button>
          </div>
        )}
        <MessageAttachments items={attachments} />
      </Row>
    </article>
  );
}

/**
 * A `/skill:name` prompt. The row names the command the way it was typed; the skill file Pi
 * put in its place is reference material, so it stays folded until the reader asks for it.
 */
function SkillExpansion({ skill }: { skill: NonNullable<RenderMsg["skill"]> }) {
  const [open, setOpen] = useState(false);
  return (
    // Clicks here open the skill, never the prompt's own long-text disclosure around it.
    <Collapsible open={open} onOpenChange={setOpen} role="group" aria-label={`${skill.name} skill`} className="text-sm" onClick={(e) => e.stopPropagation()}>
      <CollapsibleTrigger asChild>
        <button type="button" className={disclosureRow}>
          <SparklesIcon className="size-3.5 shrink-0 text-brand" aria-hidden />
          <span className="min-w-0 flex-1 truncate font-mono text-ink">/skill:{skill.name}</span>
          <DisclosureChevron open={open} className="ml-auto" />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="disclosure-content">
        <div className="mt-2 border-l-2 border-line pl-3">
          <p className="mb-2 truncate font-mono text-xs text-ink-3">{abbrevHome(skill.location)}</p>
          <Markdown text={skill.body} className="prose-chat text-ink-2" />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function subagentTitle(card: SubagentCard): string {
  if (card.kind === "collection") return card.label ?? "Subagent results";
  if (card.kind === "cancellation") return "Subagent cancellation";
  if (card.kind === "control") return card.label ?? "Subagent guidance";
  return card.label ?? (card.kind === "delegation" ? card.action === "resume" ? "Resume subagent" : "Delegate task" : "Subagent result");
}

function subagentAria(card: SubagentCard, title: string): string {
  if (card.kind === "delegation") return `Delegation: ${title}`;
  if (card.kind === "result" || card.kind === "collection") return `Subagent result: ${title}`;
  return `Subagent operation: ${title}`;
}

/** Structured pi-subagent facts use the standard disclosure primitive. The
 * transcript row itself is intentionally quiet; identity and output stay on demand. */
function SubagentCardView({ card, terminal, statusLabel, badge, failed, output, hasDetails, markdown = false }: SubagentFacts & { markdown?: boolean }) {
  const [open, setOpen] = useState(false);
  const title = subagentTitle(card);
  const runId = "runId" in card ? card.runId : undefined;
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      role="group"
      aria-label={subagentAria(card, title)}
      data-slot={card.kind === "delegation" ? "delegation-card" : "subagent-result-card"}
      data-run-id={runId}
      className="text-sm"
    >
      <Row className="items-center" glyph={<span className={cn("block size-2 rounded-full", failed || terminal === "failed" ? "bg-err" : terminal === "completed" ? "bg-ok" : "bg-ink-3")} />}>
        <CollapsibleTrigger asChild disabled={!hasDetails}>
          <button type="button" className={disclosureRow}>
            <span className="min-w-0 flex-1 truncate font-medium text-ink">{(card.kind === "result" || card.kind === "collection") && <span className="font-normal text-ink-3">Result · </span>}{title}</span>
            {"profile" in card && card.profile && <span className="max-w-28 shrink truncate text-ink-3">{card.profile}</span>}
            <Badge variant={badge} className="max-w-56 truncate">{statusLabel}</Badge>
            {hasDetails && <DisclosureChevron open={open} />}
          </button>
        </CollapsibleTrigger>
      </Row>
      {hasDetails && (
        <CollapsibleContent className="disclosure-content">
          <Row glyph={null} className="pt-2">
            <div className="flex flex-col gap-3 border-l-2 border-line pl-3 text-ink-2">
              {("subagentId" in card && card.subagentId || runId) && (
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                  {"subagentId" in card && card.subagentId && <><dt className="text-ink-3">Subagent</dt><dd className="break-all font-mono">{card.subagentId}</dd></>}
                  {runId && <><dt className="text-ink-3">Run</dt><dd className="break-all font-mono">{runId}</dd></>}
                </dl>
              )}
              {card.kind === "delegation" && card.prompt && <div><p className="mb-1 text-xs text-ink-3">Prompt</p><pre className="whitespace-pre-wrap break-words">{clamp(card.prompt, 8000)}</pre></div>}
              {card.kind === "control" && card.message && <div><p className="mb-1 text-xs text-ink-3">Guidance</p><pre className="whitespace-pre-wrap break-words">{clamp(card.message, 8000)}</pre></div>}
              {card.kind === "result" && card.durationMillis !== undefined && <p className="text-xs text-ink-3">Duration {(card.durationMillis / 1000).toFixed(1)}s</p>}
              {card.kind === "collection" && <p className="text-xs text-ink-3">Delivered {card.runs.length} · Unavailable {card.unavailable} · Still running when checked {card.stillRunning} · Unknown {card.unknown}</p>}
              {card.kind === "collection" && card.runs.map(run => <p key={run.runId} className="break-all font-mono text-xs">{run.runId} · {run.profile} · {run.status}</p>)}
              {card.kind === "cancellation" && card.outcomes.map(outcome => <p key={`${outcome.kind}:${outcome.runId}`} className="break-all font-mono text-xs">{outcome.runId} · {outcome.kind}{outcome.kind === "already terminal" ? ` · ${outcome.phase}` : ""}</p>)}
              {output && (markdown ? <Markdown text={output} className="prose-chat" /> : <pre className={cn("whitespace-pre-wrap break-words", failed && "text-err")}>{clamp(output, 20000)}</pre>)}
            </div>
          </Row>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}

const PREVIEW_LINES = 5;

const DOT: Record<ToolOutcome, string> = { running: "animate-live bg-busy", failed: "bg-err", done: "bg-ok", incomplete: "bg-ink-3", pending: "bg-ink-3" };

function Tool({ call, outcome, output, nested, nestedComplete, verb, knownTool, summary, subagent }: ToolRow) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  if (subagent) return <SubagentCardView {...subagent} />;
  const failed = outcome === "failed";
  const lines = (output ?? "").split("\n");
  const shown = all ? lines : lines.slice(0, PREVIEW_LINES);
  const hidden = lines.length - shown.length;

  return (
    <Collapsible open={open} onOpenChange={setOpen} role="group" aria-label={`${call.name} tool call`} className="text-sm">
      <Row
        className="items-center"
        glyph={
          <span
            className={cn("block size-2 rounded-full transition-colors duration-300", DOT[outcome])}
          />
        }
      >
        <CollapsibleTrigger asChild>
          <button type="button" className={disclosureRow}>
            <span className={cn("shrink-0 font-medium", failed ? "text-err" : "text-ink")}>
              {verb}
              {!knownTool && <span className="ml-1 font-mono font-normal text-ink-2">{call.name}</span>}
            </span>
            {summary && <span className="min-w-0 flex-1 truncate font-mono text-ink-2">{summary}</span>}
            {knownTool && !summary && <span className="font-mono text-ink-2">{call.name}</span>}
            <DisclosureChevron open={open} className="ml-auto" />
          </button>
        </CollapsibleTrigger>
      </Row>
      {call.args && (
        <CollapsibleContent className="disclosure-content">
          <Row glyph={null} className="pt-2">
            <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-fill px-3 py-2 text-ink-2">{clamp(call.args, 4000)}</pre>
          </Row>
        </CollapsibleContent>
      )}
      {output && open && (
        <Row glyph={null} className="mt-1">
          <pre className={cn("border-l-2 border-line py-1 pl-3 whitespace-pre-wrap break-all", failed ? "text-err" : "text-ink-2")}>{clamp(shown.join("\n"), all ? 20000 : 2000)}</pre>
          {hidden > 0 && (
            <Button variant="link" size="xs" onClick={() => setAll(true)} className="mt-0.5 h-auto px-0 text-ink-3">
              … {hidden} more {hidden === 1 ? "line" : "lines"}
            </Button>
          )}
          {all && lines.length > PREVIEW_LINES && (
            <Button variant="link" size="xs" onClick={() => setAll(false)} className="mt-0.5 h-auto px-0 text-ink-3">
              Show less
            </Button>
          )}
        </Row>
      )}
      {open && nested.map(child => /* biome-ignore lint/a11y/useSemanticElements: a <fieldset> is for form controls. */ <div key={child.id} role="group" aria-label={`${child.name} tool call`} className="ml-7 mt-2 border-l border-line pl-3 text-xs">
        <p className="flex items-center gap-2">{child.name} <Badge variant={child.status === "error" ? "destructive" : child.status === "success" ? "success" : child.status === "running" ? "warning" : "secondary"}>{{ running: "Running", success: "Done", error: "Failed", incomplete: "Incomplete" }[child.status]}</Badge></p>
        <pre className="whitespace-pre-wrap break-words">{clamp(child.args, 2000)}</pre>
        {child.outputKind === "unavailable" && <p className="text-ink-3">Output unavailable</p>}
        {child.text && <pre className="whitespace-pre-wrap break-words">{clamp(child.text, 4000)}</pre>}
      </div>)}
      {open && !nestedComplete && <p className="pl-7 text-xs text-warning">Some tool details are unavailable.</p>}
    </Collapsible>
  );
}
