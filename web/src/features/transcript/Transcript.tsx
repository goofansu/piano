import type { RenderMsg } from "@shared/wire";
import { cn } from "cn";
import { ArrowDownIcon } from "lucide-react";
import {
  useCallback,
  useDeferredValue,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { flushSync } from "react-dom";
import { PianoButton } from "@/components/PianoButton";
import { Keys } from "@/components/PianoMark";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import type { SessionDestination } from "@/lib/sessionCatalog";
import { TranscriptRowView, UserMessage } from "./MessageRows";
import { PromptMeasurementsContext, Row, TranscriptMeasure } from "./Row";
import { createScrollRenderBudget } from "./scrollRenderBudget";
import { DispatchedFrom, SessionDestinationContext } from "./SessionLinks";
import { BOTTOM_ENTRY } from "./transcript";
import { useTranscript, useTranscriptViewport } from "./TranscriptContext";
import { TranscriptDisclosures, TranscriptRowKey } from "./useTranscriptDisclosure";
import { useVirtualTranscript } from "./useVirtualTranscript";

interface Props {
  workspaceId?: string;
  submittedInput?: Pick<RenderMsg, "text" | "attachments"> | null;
  activity?: "starting" | "working";
  placeholder?: string;
  className?: string;
  dispatchedFrom?: SessionDestination | "unlisted";
  destinationOf?: (sessionId: string) => SessionDestination | "unlisted";
}

export function Transcript({ loading = false, ...props }: Props & { loading?: boolean }) {
  return loading ? <TranscriptSkeleton /> : <TranscriptMessages {...props} />;
}

function TranscriptMessages({
  workspaceId,
  submittedInput,
  activity,
  placeholder,
  className,
  dispatchedFrom,
  destinationOf = () => "unlisted",
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [disclosures] = useState(() => new Map<string, boolean>());
  const [promptMeasurements] = useState(() => new Set<() => void>());
  useLayoutEffect(() => {
    for (const measure of promptMeasurements) measure();
    promptMeasurements.clear();
  });
  const { projection, messageCount } = useTranscript();
  const viewport = useTranscriptViewport();
  const atBottom = useSyncExternalStore(viewport.subscribe, viewport.atBottom, () => true);
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
    <SessionDestinationContext value={destinationOf}>
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
          data-message-count={messageCount}
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
                  <UserMessage
                    text={submittedInput.text}
                    attachments={submittedInput.attachments}
                  />
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
                  <span
                    aria-hidden
                    className="inline-block h-[1em] w-0.5 bg-brand align-[-0.15em]"
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
            data-motion="enter"
            onClick={() => viewport.jump(BOTTOM_ENTRY)}
            className="absolute left-0 right-(--rail-inset) bottom-4 mx-auto rounded-full shadow-2 [&_svg:not([class*='size-'])]:size-5"
          >
            <ArrowDownIcon />
          </PianoButton>
        )}
      </div>
    </SessionDestinationContext>
  );
}

function TranscriptSkeleton() {
  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden bg-conversation px-(--gutter)">
      <div className="late-enter mx-auto flex w-full max-w-3xl flex-col gap-6 py-6 md:py-8">
        <div className="rounded-2xl border border-line bg-fill px-4 py-3.5">
          <div className="flex gap-3">
            <span className="flex h-[1lh] w-4 items-center justify-center">
              <Skeleton className="h-3 w-1.5 rounded-sm" />
            </span>
            <Skeleton className="h-4 w-[52%]" />
          </div>
        </div>
        <div className="flex gap-3">
          <span className="flex h-[1lh] w-4 items-center justify-center">
            <Skeleton className="size-1.5 rounded-full" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-2.5 pt-0.5">
            <Skeleton className="h-4 w-[88%]" />
            <Skeleton className="h-4 w-[72%]" />
            <Skeleton className="h-4 w-[44%]" />
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="flex h-[1lh] w-4 items-center justify-center">
            <Skeleton className="size-2 rounded-full" />
          </span>
          <Skeleton className="h-3.5 w-10" />
          <Skeleton className="h-3.5 w-36" />
        </div>
      </div>
    </div>
  );
}
