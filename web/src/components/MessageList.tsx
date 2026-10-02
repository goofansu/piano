import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDownIcon } from "lucide-react";
import type { RenderMsg } from "@shared/wire";
import { Button } from "@/components/ui/button";

type ToolCall = NonNullable<RenderMsg["toolCalls"]>[number];
import { abbrevHome, clamp } from "@/lib/format";
import { renderMarkdown } from "@/lib/markdown";
import { cn } from "cn";

/** "all" shows every row; "replies" shows your prompts and the final reply of each turn only. */
export type TranscriptView = "all" | "replies";

interface Props {
  messages: RenderMsg[];
  pending: RenderMsg | null;
  activeTools: Record<string, string>;
  placeholder: string;
  /** When Pi started the current turn, or null while it rests. */
  workingSince: number | null;
  view: TranscriptView;
}

/** The last reply with text before each prompt (and at the end): what a turn amounted to. */
function endOfTurnIds(messages: RenderMsg[]): Set<string> {
  const keep = new Set<string>();
  let last: RenderMsg | null = null;
  for (const m of messages) {
    if (m.role === "user") {
      if (last) keep.add(last.id);
      last = null;
    } else if (m.role === "assistant" && m.text.trim()) last = m;
  }
  if (last) keep.add(last.id);
  return keep;
}

/**
 * The transcript. Every row is a glyph in a narrow gutter followed by its content:
 * `›` for what you said, `•` for what Pi said, a dot for each tool call whose colour is its outcome.
 * Tool results are folded under the call that produced them.
 */
export function MessageList({ messages, pending, activeTools, placeholder, workingSince, view }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  // Keep the view pinned to the bottom unless the reader scrolled up.
  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, pending, activeTools]);
  // Content can grow without a scroll event (a prompt opens, output expands). That only
  // changes whether the bottom is in view; it never moves the reader.
  useEffect(() => {
    const el = ref.current;
    const inner = content.current;
    if (!el || !inner) return;
    const measure = () => setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
    const ro = new ResizeObserver(measure);
    ro.observe(inner);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scrollToBottom = () => {
    const el = ref.current;
    if (!el) return;
    stick.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };

  const results = new Map<string, RenderMsg>();
  for (const m of messages) if (m.role === "tool_result" && m.toolCallId) results.set(m.toolCallId, m);
  const active = new Set(Object.keys(activeTools));
  const repliesOnly = view === "replies";
  const keep = repliesOnly ? endOfTurnIds(messages) : null;

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={ref}
        onScroll={(e) => {
          const el = e.currentTarget;
          const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          stick.current = near;
          setAtBottom(near);
        }}
        className="h-full overflow-y-auto"
      >
      <div ref={content} className="mx-auto w-full max-w-2xl px-4 py-6 md:px-6">
        {messages.length === 0 && !pending && <p className="py-16 text-center text-base text-ink-2">{placeholder}</p>}
        <div className="flex flex-col gap-4">
          {messages.map((m) => {
            if (keep) {
              if (m.role === "tool_result" || (m.role === "assistant" && !keep.has(m.id))) return null;
            } else if (m.role === "tool_result" && m.toolCallId && messages.some((x) => x.toolCalls?.some((c) => c.id === m.toolCallId))) {
              // A result that found its call is rendered under the call; an orphan is rendered on its own.
              return null;
            }
            return <Message key={m.id} msg={m} results={results} active={active} hideTools={repliesOnly} />;
          })}
          {pending && <Message msg={pending} results={results} active={active} hideTools={repliesOnly} streaming />}
          {workingSince !== null && <Working since={workingSince} />}
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

function Message({ msg, results, active, hideTools, streaming }: { msg: RenderMsg; results: Map<string, RenderMsg>; active: Set<string>; hideTools: boolean; streaming?: boolean }) {
  if (msg.role === "user") return <UserMessage text={msg.text} />;
  if (msg.role === "assistant") {
    return (
      <article className="flex flex-col gap-2">
        {msg.text && (
          <Row glyph={<span className="text-ink-3">•</span>}>
            <span className="sr-only">Pi said</span>
            <div
              className={cn(
                "prose-chat",
                streaming && "after:ml-0.5 after:inline-block after:h-[1em] after:w-0.5 after:animate-caret after:bg-brand after:align-[-0.15em]",
              )}
              // renderMarkdown escapes all HTML before adding its own tags
              dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text) }}
            />
          </Row>
        )}
        {!hideTools && msg.toolCalls?.map((tc) => <Tool key={tc.id} call={tc} result={results.get(tc.id)} running={active.has(tc.id) || (!!streaming && !results.has(tc.id))} />)}
      </article>
    );
  }
  // An orphan result: its call never reached us.
  return <Tool call={{ id: msg.toolCallId ?? msg.id, name: msg.toolName ?? "tool", args: "" }} result={msg} running={false} />;
}

/** A prompt shows at most this many lines until opened; pasted logs and long briefs stay out of the way. */
const USER_LINES = 6;

function UserMessage({ text }: { text: string }) {
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
      className={cn("rounded-lg border border-line bg-surface-1 px-4 py-3 outline-none", long && "cursor-pointer select-text hover:border-line-strong focus-visible:ring-2 focus-visible:ring-ring")}
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
        <div
          ref={ref}
          className={cn("whitespace-pre-wrap break-words", !open && "overflow-hidden", clamped && "[mask-image:linear-gradient(to_bottom,black_60%,transparent)]")}
          style={open ? undefined : { maxHeight: `${USER_LINES * 1.55}em` }}
        >
          {text}
        </div>
      </Row>
    </article>
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

function Tool({ call, result, running }: { call: ToolCall; result: RenderMsg | undefined; running: boolean }) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const [verbRunning, verbDone] = VERBS[call.name] ?? ["Calling", "Called"];
  const failed = !!result?.isError;
  const verb = running ? verbRunning : failed ? "Failed" : verbDone;
  const summary = summarize(call.args);
  const lines = (result?.text ?? "").split("\n");
  const shown = all ? lines : lines.slice(0, PREVIEW_LINES);
  const hidden = lines.length - shown.length;

  return (
    <div className="text-sm">
      <Row
        glyph={
          <span
            className={cn("block size-2 rounded-full", running ? "animate-live bg-busy" : failed ? "bg-err" : result ? "bg-ok" : "bg-ink-3")}
          />
        }
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex w-full min-w-0 items-baseline gap-2 rounded-md text-left outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className={cn("shrink-0 font-medium", failed ? "text-err" : "text-ink")}>
            {verb}
            {(VERBS[call.name] ?? null) === null && <span className="ml-1 font-mono font-normal text-ink-2">{call.name}</span>}
          </span>
          {summary && <span className={cn("min-w-0 flex-1 font-mono text-ink-2", !open && "truncate")}>{summary}</span>}
          {VERBS[call.name] && !summary && <span className="font-mono text-ink-2">{call.name}</span>}
        </button>
      </Row>
      {open && call.args && (
        <Row glyph={<span className="font-mono text-ink-3">└</span>} className="mt-1">
          <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-fill px-3 py-2 text-ink-2">{clamp(call.args, 4000)}</pre>
        </Row>
      )}
      {result?.text && (
        <Row glyph={<span className="font-mono text-ink-3">{open && call.args ? " " : "└"}</span>} className="mt-1">
          <pre className={cn("whitespace-pre-wrap break-all", failed ? "text-err" : "text-ink-2")}>{clamp(shown.join("\n"), all ? 20000 : 2000)}</pre>
          {hidden > 0 && (
            <button type="button" onClick={() => setAll(true)} className="mt-0.5 rounded text-ink-3 hover:text-ink focus-visible:ring-2 focus-visible:ring-ring">
              … {hidden} more {hidden === 1 ? "line" : "lines"}
            </button>
          )}
          {all && lines.length > PREVIEW_LINES && (
            <button type="button" onClick={() => setAll(false)} className="mt-0.5 rounded text-ink-3 hover:text-ink focus-visible:ring-2 focus-visible:ring-ring">
              Show less
            </button>
          )}
        </Row>
      )}
    </div>
  );
}

function Working({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  const elapsed = s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  return (
    <Row glyph={<span className="block size-2 rounded-full animate-live bg-busy" />} className="text-sm">
      <div className="flex items-baseline gap-3" role="status">
        <span className="font-medium">Working</span>
        <span className="text-ink-3 tabular-nums">{elapsed}</span>
        <span className="text-ink-3">Esc to stop</span>
      </div>
    </Row>
  );
}
