import { ChevronDownIcon } from "lucide-react";
import { PianoButton } from "@/components/PianoButton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/PianoDropdownMenu";
import { useMachine } from "@/lib/useMachine";
import { useNarrowViewport } from "@/lib/useNarrowViewport";
import { useSidebarLayoutState } from "@/lib/useSidebarLayout";

/** Keep the selected machine visible when its sidebar control is out of sight. */
export function PaneMachineSwitcher() {
  const narrow = useNarrowViewport();
  const { collapsed, mobileOpen } = useSidebarLayoutState();
  if (narrow ? mobileOpen : !collapsed) return null;
  return <MachineSwitcher />;
}

export function MachineSwitcher() {
  const scope = useMachine();
  if (!scope || scope.machines.length < 2) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <PianoButton
          variant="ghost"
          size="sm"
          className="max-w-40 shrink-0 pointer-coarse:h-11"
          aria-label="Machine"
          aria-description={scope.machine.name}
        >
          <span className="truncate">{scope.machine.name}</span>
          <ChevronDownIcon data-icon="inline-end" />
        </PianoButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup value={scope.machine.id} onValueChange={scope.switchMachine}>
          {scope.machines.map((machine) => (
            <DropdownMenuRadioItem key={machine.id} value={machine.id}>
              {machine.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
