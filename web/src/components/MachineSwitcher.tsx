import { cn } from "cn";
import { ChevronDownIcon, LaptopIcon, ServerIcon } from "lucide-react";
import { PianoButton } from "@/components/PianoButton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/PianoDropdownMenu";
import { isLocalId, type Machine } from "@/lib/machine";
import { useMachineScope } from "@/lib/useMachine";
import { useNarrowViewport } from "@/lib/useNarrowViewport";
import { useSidebarLayoutState } from "@/lib/useSidebarLayout";

/** Keep the selected machine visible when its sidebar control is out of sight. */
export function PaneMachineSwitcher() {
  const narrow = useNarrowViewport();
  const { collapsed, mobileOpen } = useSidebarLayoutState();
  if (narrow ? mobileOpen : !collapsed) return null;
  return <MachineSwitcher place="pane" />;
}

/**
 * A menu item's tile: this machine or a remote one, which a name's initial cannot tell apart
 * (eng-1, eng-2). The trigger has none: beside the sidebar header's controls, a tile leaves the
 * name too little width to tell eng-1 from eng-2.
 */
function MachineTile({ machine }: { machine: Machine }) {
  const Icon = isLocalId(machine.id) ? LaptopIcon : ServerIcon;
  return (
    <span
      aria-hidden
      className="flex size-5 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand"
    >
      <Icon className="size-3.5" />
    </span>
  );
}

/**
 * The sidebar header's title, naming the machine everything below it lists and starts sessions on.
 * In a pane header, where it stands in for a hidden sidebar, it keeps to a compact width.
 */
export function MachineSwitcher({ place = "sidebar" }: { place?: "sidebar" | "pane" }) {
  const scope = useMachineScope();
  if (scope.machines.length < 2) return null;
  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <PianoButton
          variant="ghost"
          size="sm"
          className={cn(
            // Bring the name toward the sidebar glyph without moving either hit target.
            "min-w-0 font-medium text-ink pointer-coarse:h-11 pointer-coarse:min-w-11 pointer-coarse:pl-1",
            place === "pane" ? "max-w-40 shrink-0" : "max-w-full",
          )}
          aria-label="Machine"
          aria-description={scope.machine.name}
        >
          <span className="truncate">{scope.machine.name}</span>
          <ChevronDownIcon data-icon="inline-end" className="text-ink-3" />
        </PianoButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup value={scope.machine.id} onValueChange={scope.switchMachine}>
          {scope.machines.map((machine) => (
            <DropdownMenuRadioItem key={machine.id} value={machine.id}>
              <MachineTile machine={machine} />
              {machine.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  // A sidebar narrowed until the name would show a letter or two drops the switcher whole; the
  // palette's Switch to commands still reach every machine.
  return place === "sidebar" ? (
    <div className="@container flex min-w-0 flex-1">
      <div className="hidden min-w-0 @[5rem]:flex">{menu}</div>
    </div>
  ) : (
    menu
  );
}
