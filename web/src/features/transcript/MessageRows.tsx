import type { RenderMsg } from "@shared/wire";
import { cn } from "cn";
import {
  CheckIcon,
  CopyIcon,
  GitBranchIcon,
  HistoryIcon,
  PuzzleIcon,
  SparklesIcon,
  TerminalIcon,
} from "lucide-react";
import { memo, useContext, useId, useLayoutEffect, useRef, useState } from "react";
import { MessageAttachments } from "@/components/Attachments";
import { useCopy } from "@/components/CopyButton";
import { DisclosureChevron } from "@/components/Disclosure";
import { Markdown } from "@/components/Markdown";
import { Keys } from "@/components/PianoMark";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { abbrevHome } from "@/lib/format";
import { useMarkdownImages } from "@/lib/useMarkdownImages";
import type { MessageError } from "./messageError";
import { FoldRow, PromptMeasurementsContext, Row } from "./Row";
import { Tool } from "./ToolRows";
import { type ContextFacts, contextFacts, messageAnchorId, type TranscriptRow } from "./transcript";
import { useTranscriptDisclosure } from "./useTranscriptDisclosure";

export const TranscriptRowView = memo(function TranscriptRowView({
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

export function UserMessage({
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
