import type { ModelChoice } from "@shared/wire";
import { cn } from "cn";
import { ChevronDownIcon, RefreshCwIcon, SaveCheckIcon, SaveIcon, Undo2Icon } from "lucide-react";
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
import { ButtonGroup } from "@/components/ui/button-group";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { isImeKey } from "@/lib/keys";
import { modelPickerView } from "@/lib/modelPicker";
import { footerPicker, footerPickerMenu } from "@/lib/styles";
import type { ModelControl } from "@/lib/useModelChoice";

interface Props {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Composers resume editing after Enter on effort or Escape; standalone pickers use their trigger. */
  returnFocusRef?: RefObject<HTMLTextAreaElement | null>;
  /** The page's selection, its catalog and what a pick does (`useModelChoice`). */
  control: ModelControl;
  disabled?: boolean;
  /** Bordered control for standalone forms; composers retain the quiet trigger. */
  variant?: "ghost" | "outline";
}

/** One settings trigger: the model label yields space before the effort or primary action does. */
import { useRemote } from "@/lib/useMachine";

export function ModelSelect({
  open: controlledOpen,
  onOpenChange,
  returnFocusRef,
  control,
  disabled,
  variant = "ghost",
}: Props) {
  const remote = useRemote();
  const { models, model: value, effort, noDirectory } = control;
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
    noDirectory,
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
    (current ?? first ?? search.current)?.focus({ preventScroll: true });
    setFocusModel(null);
  }, [open, focusModel, want]);

  const item = (m: ModelChoice) => (
    <CommandItem
      key={m.ref}
      value={m.ref}
      onSelect={() => {
        setFocusModel(m.ref);
        control.chooseModel(m.ref);
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
            "min-w-0 shrink",
            variant === "outline"
              ? "max-w-full justify-start font-mono"
              : [footerPicker, "max-w-none justify-end px-1.5"],
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
      {/* Mod+/ opens it many times a day: it appears at once. */}
      <PickerContent
        still
        aria-label="Model and effort"
        collisionPadding={16}
        className={cn("w-96", footerPickerMenu)}
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
            isImeKey(event)
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
          if (isImeKey(event)) {
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
            if (event.key === "Enter" && event.repeat && !isImeKey(event)) event.preventDefault();
          }}
        >
          <PickerSearch
            ref={search}
            divider={false}
            value={query}
            onValueChange={setQuery}
            aria-label="Search models"
            placeholder="Search models"
            className="max-md:text-base"
          >
            {refresh && (
              <IconButton
                size="header"
                label="Refresh models"
                disabled={disabled || refreshing}
                onClick={refresh}
              >
                {refreshing ? <Spinner /> : <RefreshCwIcon aria-hidden />}
              </IconButton>
            )}
          </PickerSearch>
          <CommandList className="max-h-[min(12rem,30dvh)] sm:max-h-[min(16rem,40dvh)]">
            <CommandEmpty>{view.emptyText}</CommandEmpty>
            <CommandGroup>{view.visibleModels.map(item)}</CommandGroup>
          </CommandList>
        </Command>
        <Separator />
        <div ref={effortPanel} className="flex flex-col gap-2 p-3">
          <EffortSelect
            value={effort}
            onChange={control.chooseEffort}
            onCommit={finish}
            levels={view.levels}
            defaultLevel={catalog?.defaultThinkingLevel}
            disabled={!view.effortEnabled}
          />
          {/* Keep the description and action in place while selection and saving change. */}
          {!remote && (
            <div className="flex min-h-6 items-center justify-between gap-2 text-xs text-ink-3 pointer-coarse:min-h-11">
              <span className="min-w-0">
                <span className="block">New sessions</span>
                <span className="block truncate" title={view.defaultLabel ?? undefined}>
                  {view.defaultLabel ?? "Not available"}
                </span>
              </span>
              <ButtonGroup className="shrink-0">
                <IconButton
                  variant="outline"
                  size="header"
                  label="Use default"
                  disabled={!view.canUseDefault}
                  onClick={() => {
                    // Stay open to show the defaults taking effect; the button disables, so focus
                    // moves to the default's effort once Pi shows that model.
                    setFocusModel(catalog?.defaultModel ?? null);
                    control.chooseDefaults();
                  }}
                >
                  <Undo2Icon aria-hidden />
                </IconButton>
                <IconButton
                  variant="outline"
                  size="header"
                  label={view.isDefault ? "Default" : "Make default"}
                  disabled={!view.canSaveDefault}
                  aria-busy={saving}
                  onClick={() => void models.saveDefaults(want, effort)}
                >
                  {saving ? (
                    <Spinner aria-hidden />
                  ) : view.isDefault ? (
                    <SaveCheckIcon aria-hidden />
                  ) : (
                    <SaveIcon aria-hidden />
                  )}
                </IconButton>
              </ButtonGroup>
            </div>
          )}
        </div>
      </PickerContent>
    </Popover>
  );
}
