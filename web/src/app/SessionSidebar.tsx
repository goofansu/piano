import { useCommands, folderCommands, PALETTE_NAME } from "@features/commands/web/browser";
import { Sidebar } from "@features/navigation/web/browser";
import { projectRowActions } from "@features/projects/web/browser";
import type { FolderView } from "@shared/wire";
import { MoreHorizontalIcon, SquarePenIcon, XIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { IconButton } from "@/shared/components/IconButton";
import { PianoButton as Button } from "@/shared/components/PianoButton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/PianoDropdownMenu";
import type { AppState } from "@/shared/state/state";
import { renderSessionMenu } from "./commands/SessionMenu";
import { ViewMenu } from "./commands/ViewMenu";

function folderRowActions(
  state: AppState,
  folder: FolderView,
  run: ReturnType<typeof useCommands>["run"],
) {
  const { create, close } = folderCommands(state, folder);
  return [
    create.enabled && (
      <IconButton
        key="new"
        size="row"
        label={create.ariaLabel ?? create.label}
        tooltip={create.label}
        onClick={() => run(create)}
      >
        <SquarePenIcon />
      </IconButton>
    ),
    <DropdownMenu key="menu">
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="row" aria-label={`Folder menu for ${folder.name}`} />}
      >
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuItem disabled={!close.enabled} onClick={() => run(close)}>
            <XIcon /> {close.label}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>,
  ];
}

export function SessionSidebar(
  props: Pick<ComponentProps<typeof Sidebar>, "state" | "list" | "toggle">,
) {
  const { run } = useCommands();
  return (
    <Sidebar
      {...props}
      searchLabel={PALETTE_NAME}
      viewMenu={<ViewMenu />}
      projectActions={(project) => projectRowActions(props.state, project, run)}
      folderActions={(folder) => folderRowActions(props.state, folder, run)}
      sessionMenu={renderSessionMenu}
    />
  );
}
