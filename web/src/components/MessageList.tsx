import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDownIcon, CheckIcon, ChevronRightIcon, CopyIcon, SparklesIcon } from "lucide-react";
import { toast } from "sonner";
import type { RenderMsg, ToolExecution } from "@shared/wire";
import { MessageAttachments } from "@/components/Attachments";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Keys } from "@/components/PianoMark";

type ToolCall = NonNullable<RenderMsg["toolCalls"]>[number];
import { abbrevHome, clamp } from "@/lib/format";
import { Markdown } from "@/components/Markdown";
import { messageAnchorId, STICK_EVENT } from "@/lib/transcript";
import { cn } from "cn";

interface Props {
  messages: RenderMsg[];
  pending: RenderMsg | null;
  tools: Record<string, ToolExecution>;
  /** Pi is working and no reply text has arrived yet: the keys play in a pending row. */
  working?: boolean;
  placeholder: string;
  className?: string;
}

/**
 * The transcript. Every row is a glyph in a narrow gutter followed by its content:
 * `›` for what you said, `•` for what Pi said, a dot for each tool call whose colour is its outcome.
 * Tool results are folded under the call that produced them.
 */
export function MessageList({ messages, pending, tools, working = false, placeholder, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  // Keep the view pinned to the bottom unless the reader scrolled up.
  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, pending, tools, working]);
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

  const results = new Map<string, RenderMsg>();
  for (const m of messages) if (m.role === "tool_result" && m.toolCallId) results.set(m.toolCallId, m);
  const active = new Set(Object.values(tools).filter(t => t.status === "running").map(t => t.id));

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
        {messages.length === 0 && !pending && !working && (
          <Empty className="py-16">
            <EmptyHeader>
              <EmptyDescription className="text-base">{placeholder}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {/* Adjacent tool rows keep one gap, even when the previous message also had text. */}
        <div className="flex flex-col gap-6 [&>[data-ends-with-tools]+[data-tools-only]]:-mt-3">
          {messages.map((m) => {
            if (m.role === "tool_result" && m.toolCallId && messages.some((x) => x.toolCalls?.some((c) => c.id === m.toolCallId))) {
              // A result that found its call is rendered under the call; an orphan is rendered on its own.
              return null;
            }
            return <Message key={m.id} msg={m} results={results} tools={tools} active={active} />;
          })}
          {pending && <Message msg={pending} results={results} tools={tools} active={active} streaming />}
          {working && (
            <Row glyph={<Keys playing className="text-brand" />}>
              <span className="sr-only">Pi is working</span>
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
          size="icon-sm"
          aria-label="Scroll to bottom"
          onClick={scrollToBottom}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full shadow-2 animate-in fade-in-0 zoom-in-95 motion-reduce:animate-none"
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

function Message({ msg, results, tools, active, streaming }: { msg: RenderMsg; results: Map<string, RenderMsg>; tools: Record<string, ToolExecution>; active: Set<string>; streaming?: boolean }) {
  if (msg.role === "context") return <article><p className="text-xs text-ink-3">{msg.label}</p><pre className="whitespace-pre-wrap break-words text-sm">{msg.text}</pre></article>;
  if (msg.role === "user") return <UserMessage id={msg.id} text={msg.text} skill={msg.skill} attachments={msg.attachments} />;
  if (msg.role === "assistant") {
    // Pi starts a message before its first visible text or tool block arrives.
    // An empty article would still consume the transcript's flex gap.
    if (!msg.text && !msg.errorMessage && !msg.toolCalls?.length) return null;
    return (
      <article
        id={streaming ? undefined : messageAnchorId(msg.id)}
        data-tools-only={!msg.text && !msg.errorMessage && !!msg.toolCalls?.length ? "" : undefined}
        data-ends-with-tools={msg.toolCalls?.length ? "" : undefined}
        className="group/reply flex flex-col gap-6 rounded-2xl"
      >
        {msg.text && (
          <Row glyph={streaming ? <Keys playing className="text-brand" /> : <span className="text-ink-3">•</span>}>
            <span className="sr-only">Pi said</span>
            <Markdown text={msg.text} className={cn("prose-chat", streaming && "streaming-caret")} />
            {!streaming && !msg.toolCalls?.length && <CopyResponse text={msg.text} />}
          </Row>
        )}
        {msg.errorMessage && <Alert variant="destructive" className="ml-7 w-auto"><AlertDescription className="break-words">{msg.stopReason}: {msg.errorMessage}</AlertDescription></Alert>}
        {!!msg.toolCalls?.length && (
          <div className="flex flex-col gap-3">
            {msg.toolCalls.map((tc) => <Tool key={tc.id} call={tc} result={results.get(tc.id)} executions={tools} running={active.has(tc.id) || (!!streaming && !results.has(tc.id))} />)}
          </div>
        )}
      </article>
    );
  }
  // An orphan result: its call never reached us.
  return <Tool call={{ id: msg.toolCallId ?? msg.id, name: msg.toolName ?? "tool", args: "" }} result={msg} executions={tools} running={false} />;
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

function UserMessage({ id, text, skill, attachments }: { id: string; text: string; skill: RenderMsg["skill"]; attachments: RenderMsg["attachments"] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  // Measure against the cap while closed; re-measure when the column resizes.
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
  // A long prompt is its own control: click or press Enter to open and close it.
  return (
    <article
      id={messageAnchorId(id)}
      className={cn("rounded-2xl border border-line bg-fill px-4 py-3.5 outline-none transition-colors", long && "cursor-pointer select-text hover:border-line-strong focus-visible:ring-2 focus-visible:ring-ring")}
      tabIndex={long ? 0 : undefined}
      aria-expanded={long ? open : undefined}
      onClick={() => long && !window.getSelection()?.toString() && toggle()}
      onKeyDown={(e) => {
        if (long && (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
          e.preventDefault();
          toggle();
        }
      }}
    >
      <Row glyph={<span className="font-semibold text-brand">›</span>}>
        <span className="sr-only">You said</span>
        {skill && <SkillExpansion skill={skill} />}
        {(text || !skill) && (
          <div
            ref={ref}
            className={cn("whitespace-pre-wrap break-words", skill && "mt-2", !open && "overflow-hidden", clamped && "[mask-image:linear-gradient(to_bottom,black_60%,transparent)]")}
            style={open ? undefined : { maxHeight: `${USER_LINES * 1.55}em` }}
          >
            {text}
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
        <button
          type="button"
          className="-ml-2 flex w-[calc(100%+0.5rem)] min-w-0 items-center gap-2 rounded-lg px-2 py-1 text-left outline-none transition-colors hover:bg-fill-hover focus-visible:ring-2 focus-visible:ring-ring"
        >
          <SparklesIcon className="size-3.5 shrink-0 text-brand" aria-hidden />
          <span className="min-w-0 flex-1 truncate font-mono text-ink">/skill:{skill.name}</span>
          <ChevronRightIcon className={cn("ml-auto size-3.5 shrink-0 text-ink-3 transition-transform duration-200", open && "rotate-90")} aria-hidden />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="disclosure-content">
        <div className="mt-2 border-l-2 border-line pl-3">
          <p className="mb-2 truncate font-mono text-xs text-ink-3" title={skill.location}>{abbrevHome(skill.location)}</p>
          <Markdown text={skill.body} className="prose-chat text-ink-2" />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

const VERBS: Record<string, [running: string, done: string]> = {
  bash: ["Running", "Ran"],
  read: ["Reading", "Read"],
  write: ["Writing", "Wrote"],
  edit: ["Editing", "Edited"],
  grep: ["Searching", "Searched"],
  find: ["Searching", "Searched"],
  glob: ["Searching", "Searched"],
  ls: ["Listing", "Listed"],
};

/** One line that says what a tool call did: the command, the path, or the pattern. */
function summarize(args: string): string {
  try {
    const a = JSON.parse(args) as Record<string, unknown>;
    const v = a.command ?? a.path ?? a.file_path ?? a.pattern ?? a.url ?? a.query;
    if (typeof v === "string") return abbrevHome(v.split("\n")[0]).slice(0, 160);
  } catch {
    /* partial JSON while streaming */
  }
  return "";
}

const PREVIEW_LINES = 5;

function Tool({ call, result, running, executions = {} }: { call: ToolCall; result: RenderMsg | undefined; running: boolean; executions?: Record<string, ToolExecution> }) {
  const execution = executions[call.id];
  const nested = new Map((result?.nestedCalls ?? []).map(c => [c.id, c]));
  for (const child of Object.values(executions)) if (child.parentId === call.id || child.id.startsWith(`${call.id}/`)) nested.set(child.id, child);
  const output = result?.text ?? execution?.text;
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const [verbRunning, verbDone] = VERBS[call.name] ?? ["Calling", "Called"];
  const failed = !!result?.isError || execution?.status === "error";
  const verb = running ? verbRunning : failed ? "Failed" : execution?.status === "incomplete" ? "Incomplete" : verbDone;
  const summary = summarize(call.args);
  const lines = (output ?? "").split("\n");
  const shown = all ? lines : lines.slice(0, PREVIEW_LINES);
  const hidden = lines.length - shown.length;

  return (
    <Collapsible open={open} onOpenChange={setOpen} role="group" aria-label={`${call.name} tool call`} className="text-sm">
      <Row
        className="items-center"
        glyph={
          <span
            className={cn("block size-2 rounded-full transition-colors duration-300", running ? "animate-live bg-busy" : failed ? "bg-err" : result ? "bg-ok" : "bg-ink-3")}
          />
        }
      >
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="-ml-2 flex w-[calc(100%+0.5rem)] min-w-0 items-center gap-2 rounded-lg px-2 py-1 text-left outline-none transition-colors hover:bg-fill-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className={cn("shrink-0 font-medium", failed ? "text-err" : "text-ink")}>
              {verb}
              {(VERBS[call.name] ?? null) === null && <span className="ml-1 font-mono font-normal text-ink-2">{call.name}</span>}
            </span>
            {summary && <span className="min-w-0 flex-1 truncate font-mono text-ink-2">{summary}</span>}
            {VERBS[call.name] && !summary && <span className="font-mono text-ink-2">{call.name}</span>}
            <ChevronRightIcon className={cn("ml-auto size-3.5 shrink-0 text-ink-3 transition-transform duration-200", open && "rotate-90")} aria-hidden />
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
      {open && [...nested.values()].map(child => <div key={child.id} role="group" aria-label={`${child.name} tool call`} className="ml-7 mt-2 border-l border-line pl-3 text-xs">
        <p className="flex items-center gap-2">{child.name} <Badge variant={child.status === "error" ? "destructive" : child.status === "success" ? "success" : child.status === "running" ? "warning" : "secondary"}>{{ running: "Running", success: "Done", error: "Failed", incomplete: "Incomplete" }[child.status]}</Badge></p>
        <pre className="whitespace-pre-wrap break-words">{clamp(child.args, 2000)}</pre>
        {child.outputKind === "unavailable" && <p className="text-ink-3">Output unavailable</p>}
        {child.text && <pre className="whitespace-pre-wrap break-words">{clamp(child.text, 4000)}</pre>}
      </div>)}
      {open && result?.nestedCallsComplete === false && <p className="pl-7 text-xs text-warning">Some tool details are unavailable.</p>}
    </Collapsible>
  );
}
