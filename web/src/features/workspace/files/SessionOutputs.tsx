import { cn } from "cn";
import { Item, ItemContent, ItemMedia } from "@/components/ui/item";
import { useNavigation } from "@/features/navigation/useNavigation";
import { RailList, RailRowTitle, railRow } from "@/features/sessions/SessionRailList";
import { displayPath, type SessionFile, splitPath } from "@/features/workspace/files/sessionFiles";
import { FileTabIcon } from "@/features/workspace/files/WorkspaceFile";
import { abbrevHome } from "@/shared/lib/format";

interface Props {
  files: readonly SessionFile[];
  cwd?: string;
}

export function SessionOutputs({ files, cwd }: Props) {
  const { openFile } = useNavigation();
  return (
    <RailList aria-label="Outputs">
      {files.map((file) => {
        const shown = displayPath(file, cwd, abbrevHome);
        return (
          <Item
            key={file.path}
            size="sm"
            className={cn(
              railRow,
              "cursor-pointer hover:bg-fill-hover focus-visible:bg-fill-hover",
            )}
            render={
              <button
                type="button"
                onClick={() => {
                  openFile(file.path);
                }}
                title={shown}
              >
                <ItemMedia variant="icon" className="text-ink-3">
                  <FileTabIcon path={file.path} />
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <RailRowTitle className="truncate font-mono">
                    {splitPath(shown).name}
                  </RailRowTitle>
                </ItemContent>
              </button>
            }
          />
        );
      })}
    </RailList>
  );
}
