import { type RadioChoice, type GlobalCommand, radioChoice } from "@features/commands/web";
import { useGlobalCommands, GlobalCommandIcon } from "@features/commands/web/browser";
import { SlidersHorizontalIcon } from "lucide-react";
import { PianoButton as Button } from "@/shared/components/PianoButton";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/shared/components/PianoDropdownMenu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/PianoTooltip";
import { useNarrowViewport } from "@/shared/lib/useNarrowViewport";

export function ViewMenu() {
  const { commands, run } = useGlobalCommands();
  const narrow = useNarrowViewport();
  const groupBy = radioChoice(commands, "group-by");
  const sortBy = radioChoice(commands, "sort-by");
  const appearance = radioChoice(commands, "appearance");
  const folderAndBranch = commands.find((c) => c.id === "folder-and-branch");
  const choice = (label: string, { currentLabel }: RadioChoice<GlobalCommand>) => (
    <>
      <span className="flex-1">{label}</span>
      <span className="text-muted-foreground">{currentLabel}</span>
    </>
  );
  const radio = (
    { value, items }: RadioChoice<GlobalCommand>,
    item: (c: GlobalCommand) => React.ReactNode,
  ) => (
    <DropdownMenuRadioGroup
      value={value}
      onValueChange={(id) => {
        const c = items.find((c) => c.id === id);
        if (c) run(c);
      }}
    >
      {items.map(item)}
    </DropdownMenuRadioGroup>
  );
  const section = (label: string, items: React.ReactNode, current?: RadioChoice<GlobalCommand>) =>
    narrow ? (
      <DropdownMenuGroup aria-label={label}>
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        {items}
      </DropdownMenuGroup>
    ) : (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>{current ? choice(label, current) : label}</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>{items}</DropdownMenuSubContent>
      </DropdownMenuSub>
    );
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="header" aria-label="View options" />}
            >
              <SlidersHorizontalIcon />
            </DropdownMenuTrigger>
          }
        />
        <TooltipContent>View options</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="min-w-48">
        {section(
          "Group by",
          radio(groupBy, (c) => (
            <DropdownMenuRadioItem key={c.id} value={c.id}>
              {c.menuLabel}
            </DropdownMenuRadioItem>
          )),
          groupBy,
        )}
        {narrow && <DropdownMenuSeparator />}
        {section(
          "Sort by",
          radio(sortBy, (c) => (
            <DropdownMenuRadioItem key={c.id} value={c.id}>
              {c.menuLabel}
            </DropdownMenuRadioItem>
          )),
          sortBy,
        )}
        {folderAndBranch && (
          <>
            {narrow && <DropdownMenuSeparator />}
            {section(
              "Show",
              <DropdownMenuCheckboxItem
                checked={!!folderAndBranch.pressed}
                onCheckedChange={() => run(folderAndBranch)}
              >
                <GlobalCommandIcon icon={folderAndBranch.icon} /> {folderAndBranch.menuLabel}
              </DropdownMenuCheckboxItem>,
            )}
          </>
        )}
        <DropdownMenuSeparator />
        {section(
          "Appearance",
          radio(appearance, (c) => (
            <DropdownMenuRadioItem key={c.id} value={c.id}>
              <GlobalCommandIcon icon={c.icon} /> {c.menuLabel}
            </DropdownMenuRadioItem>
          )),
          appearance,
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
