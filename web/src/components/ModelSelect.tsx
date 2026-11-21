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
import { keyboardFocusReturn } from "@/lib/pointerClose";
import { footerPicker, footerPickerMenu } from "@/lib/styles";
import type { ModelControl } from "@/lib/useModelChoice";

interface Props {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  returnFocusRef?: RefObject<HTMLTextAreaElement | null>;
  control: ModelControl;
  disabled?: boolean;
  variant?: "ghost" | "outline";
}

export function ModelSelect({
  open: controlledOpen,
  onOpenChange,
  returnFocusRef,
  control,
  disabled,
  variant = "ghost",
}: Props) {
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
  if (!open && openingModel !== want) setOpeningModel(want);
  useEffect(() => {
    if (!open) {
      setFocusModel(null);
      setQuery("");
      return;
    }
    if (focusModel === null || focusModel !== want) return;
    const panel = effortPanel.current;
    const current = panel?.querySelector<HTMLButtonElement>(
      '[data-slot="toggle-group-item"][aria-pressed="true"]:not(:disabled)',
    );
    const first = panel?.querySelector<HTMLButtonElement>(
      '[data-slot="toggle-group-item"]:not(:disabled)',
    );
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
      onOpenChange={(next, details) => {
        if (!next && details.reason === "escape-key") {
          if (isImeKey(details.event as KeyboardEvent)) {
            details.cancel();
            return;
          }
          restoreFocus.current = true;
        }
        setOpen(next);
        setQuery("");
      }}
    >
      <PopoverTrigger
        render={
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
        }
      />
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
          setFocusModel(null);
          input.focus({ preventScroll: true });
          input.select();
        }}
        finalFocus={() => {
          const target = restoreFocus.current ? returnFocusRef?.current : null;
          restoreFocus.current = false;
          return target ?? keyboardFocusReturn();
        }}
      >
        <Command
          defaultValue={openingModel}
          shouldFilter={false}
          onKeyDown={(event) => {
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
        </div>
      </PickerContent>
    </Popover>
  );
}
