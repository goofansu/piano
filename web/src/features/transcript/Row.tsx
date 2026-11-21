import { cn } from "cn";
import { createContext, useContext, useLayoutEffect, useRef, useState } from "react";
import { DisclosureChevron } from "@/components/Disclosure";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { disclosureRow } from "@/lib/styles";
import { useTranscriptViewport } from "./TranscriptContext";
import { domFoldEdges } from "./transcriptViewport";
import { useTranscriptDisclosure } from "./useTranscriptDisclosure";

export const PromptMeasurementsContext = createContext<Set<() => void> | null>(null);
export const TranscriptMeasure = createContext<((row: HTMLElement) => void) | null>(null);

export function useRowRemeasure(
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

export function Row({
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

export function FoldRow({
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
      viewport.fold(next, () => {
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
