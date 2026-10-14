import type { ModelChoice, ThinkingLevel } from "@shared/wire";
import { cn } from "cn";
import { ChevronDownIcon, RefreshCwIcon } from "lucide-react";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { EffortSelect } from "@/components/EffortSelect";
import { IconButton } from "@/components/IconButton";
import { PianoButton as Button } from "@/components/PianoButton";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/PianoCommand";
import { Popover, PopoverTrigger } from "@/components/PianoPopover";
import { PickerCheck, PickerContent, PickerSearch } from "@/components/Picker";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import type { ModelCatalogView } from "@/lib/modelCatalogs";
import { modelPickerView } from "@/lib/modelPicker";
import { picker } from "@/lib/styles";

interface Props {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Composers resume editing after Done or Escape; standalone pickers use their trigger. */
  returnFocusRef?: RefObject<HTMLTextAreaElement | null>;
  /** The directory's catalog with its refresh and saved defaults (`useModelCatalog`). */
  models: ModelCatalogView;
  value: string | undefined;
  onChange: (ref: string) => void;
  effort: ThinkingLevel;
  onEffortChange: (level: ThinkingLevel) => void;
  disabled?: boolean;
  /** Bordered control for standalone forms; composers retain the quiet trigger. */
  variant?: "ghost" | "outline";
  /** No directory is chosen yet, so there is no catalog to wait for. */
  noDirectory?: boolean;
}

/** One settings trigger: the model label yields space before the effort or primary action does. */
export function ModelSelect({
  open: controlledOpen,
  onOpenChange,
  returnFocusRef,
  models,
  value,
  onChange,
  effort,
  onEffortChange,
  disabled,
  variant = "ghost",
  noDirectory,
}: Props) {
  const { catalog, refresh, refreshing, saving } = models;
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      setLocalOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );
  const [focusModel, setFocusModel] = useState<string | null>(null);
  const effortPanel = useRef<HTMLDivElement>(null);
  const done = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const finish = () => {
    restoreFocus.current = true;
    setOpen(false);
  };
  const [query, setQuery] = useState("");
  const [openingModel, setOpeningModel] = useState(value || catalog?.defaultModel || "");
  useEffect(() => {
    if (!open) return;
    const dismiss = () => setOpen(false);
    window.addEventListener("blur", dismiss);
    return () => window.removeEventListener("blur", dismiss);
  }, [open, setOpen]);
  const search = useRef<HTMLInputElement>(null);
  const view = modelPickerView({
    catalog,
    value,
    effort,
    query,
    openingModel,
    disabled: !!disabled,
    canRefresh: !!refresh,
    noDirectory: !!noDirectory,
    chosen: focusModel,
    saving,
  });
  const want = view.shown;
  // Snapshot while closed, including externally controlled opens. Selection must not move rows
  // under the pointer or reset keyboard navigation during this visit to the picker.
  if (!open && openingModel !== want) setOpeningModel(want);
  useEffect(() => {
    if (!open) {
      setFocusModel(null);
      setQuery("");
      return;
    }
    // Hosted selections arrive asynchronously from Pi. Never focus the previous model's efforts.
    if (focusModel === null || focusModel !== want) return;
    const panel = effortPanel.current;
    const current = panel?.querySelector<HTMLButtonElement>(
      '[role="radio"][aria-checked="true"]:not(:disabled)',
    );
    const first = panel?.querySelector<HTMLButtonElement>('[role="radio"]:not(:disabled)');
    (current ?? first ?? done.current)?.focus({ preventScroll: true });
    setFocusModel(null);
  }, [open, focusModel, want]);

  const item = (m: ModelChoice) => (
    <CommandItem
      key={m.ref}
      value={m.ref}
      onSelect={() => {
        setFocusModel(m.ref);
        onChange(m.ref);
      }}
    >
      <span className="min-w-0 flex-1 whitespace-normal break-words [overflow-wrap:anywhere]">
        <span className="text-ink-3">{m.provider}/</span>
        {m.id}
      </span>
      <PickerCheck selected={m.ref === want} />
    </CommandItem>
  );

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant={variant === "outline" ? "outline-transparent" : variant}
          size={variant === "outline" ? "default" : "sm"}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`Model: ${want || view.label}; effort: ${effort}`}
          title={want}
          disabled={!view.triggerEnabled}
          className={cn(
            "min-w-0 shrink font-mono",
            variant === "outline" ? "max-w-full justify-start" : [picker, "max-w-none justify-end"],
          )}
        >
          <span className={cn("min-w-0 truncate", view.shimmer && "shimmer")}>{view.label}</span>
          <span className="shrink-0 text-ink-3 max-[360px]:hidden" aria-hidden>
            ·
          </span>
          <span className="shrink-0 text-ink-3 max-[360px]:hidden" aria-hidden>
            {effort}
          </span>
          {variant === "outline" && <ChevronDownIcon data-icon="inline-end" aria-hidden />}
        </Button>
      </PopoverTrigger>
      <PickerContent
        aria-label="Model and effort"
        className="font-mono"
        searchRef={search}
        onKeyDown={(event) => {
          if (
            event.defaultPrevented ||
            event.key !== "/" ||
            event.repeat ||
            event.metaKey ||
            event.ctrlKey ||
            event.altKey ||
            event.shiftKey ||
            event.nativeEvent.isComposing ||
            event.nativeEvent.keyCode === 229
          )
            return;
          const input = search.current;
          if (!input || document.activeElement === input) return;
          event.preventDefault();
          setFocusModel(null); // A later hosted selection must not steal focus back to effort.
          input.focus({ preventScroll: true });
          input.select();
        }}
        onEscapeKeyDown={(event) => {
          if (event.isComposing || event.keyCode === 229) {
            event.preventDefault();
            return;
          }
          restoreFocus.current = true;
        }}
        onCloseAutoFocus={(event) => {
          if (restoreFocus.current && returnFocusRef?.current) {
            event.preventDefault();
            returnFocusRef.current.focus({ preventScroll: true });
          }
          restoreFocus.current = false;
        }}
      >
        <Command
          defaultValue={openingModel}
          shouldFilter={false}
          onKeyDown={(event) => {
            // cmdk already ignores IME; holding Enter must not accept a second model.
            if (
              event.key === "Enter" &&
              event.repeat &&
              !event.nativeEvent.isComposing &&
              event.nativeEvent.keyCode !== 229
            )
              event.preventDefault();
          }}
        >
          <PickerSearch
            ref={search}
            value={query}
            onValueChange={setQuery}
            aria-label="Search models"
            placeholder="Search models"
          >
            {refresh && (
              <IconButton
                label="Refresh models"
                disabled={disabled || refreshing}
                onClick={refresh}
              >
                {refreshing ? <Spinner /> : <RefreshCwIcon aria-hidden />}
              </IconButton>
            )}
          </PickerSearch>
          <CommandList className="max-h-[min(16rem,40dvh)]">
            <CommandEmpty>{view.emptyText}</CommandEmpty>
            <CommandGroup>{view.visibleModels.map(item)}</CommandGroup>
          </CommandList>
        </Command>
        <Separator />
        <div ref={effortPanel} className="flex flex-col gap-3 p-3">
          <EffortSelect
            value={effort}
            onChange={onEffortChange}
            onCommit={finish}
            levels={view.levels}
            defaultLevel={catalog?.defaultThinkingLevel}
            disabled={!view.effortEnabled}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={!view.canSaveDefault}
            onClick={() => void models.saveDefaults(want, effort)}
          >
            {saving && <Spinner data-icon="inline-start" />}
            {view.saveLabel}
          </Button>
          <Button ref={done} variant="ghost" size="sm" onClick={finish}>
            Done
          </Button>
        </div>
      </PickerContent>
    </Popover>
  );
}
