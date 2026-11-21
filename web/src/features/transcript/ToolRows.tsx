import { LIBRARY_KINDS, LIBRARY_REACH, type LibraryResult } from "@shared/library";
import { cn } from "cn";
import { useContext, useRef, useState } from "react";
import { BranchLabel } from "@/components/BranchLabel";
import { DisclosureChevron } from "@/components/Disclosure";
import { DraftFileView } from "@/components/DraftDialogs";
import { Markdown } from "@/components/Markdown";
import { QuestionText } from "@/components/QuestionText";
import { StatusBadge as Badge } from "@/components/StatusBadge";
import { StatusDot, type StatusTone } from "@/components/StatusDot";
import { Button } from "@/components/ui/button";
import { Item, ItemContent, ItemGroup } from "@/components/ui/item";
import { clamp, stripAnsi, toolArgsText } from "@/lib/format";
import { disclosureRow } from "@/lib/styles";
import { FoldRow, Row, useRowRemeasure } from "./Row";
import { OpenSession, SessionDestinationContext } from "./SessionLinks";
import type {
  DispatchFacts,
  NestedCall as NestedCallLine,
  NestedView,
  QuestionAnswers,
  ToolOutcome,
  ToolRow,
} from "./transcript";
import { useTranscriptDisclosure } from "./useTranscriptDisclosure";

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

export function Tool({
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
