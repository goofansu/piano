import { cn } from "cn";
import { RailList, RailRowTitle, railRow } from "@/components/SessionRailList";
import { Item, ItemContent, ItemMedia } from "@/components/ui/item";
import { FileTabIcon } from "@/components/WorkspaceFile";
import { abbrevHome } from "@/lib/format";
import { displayPath, type SessionFile, splitPath } from "@/lib/sessionFiles";
import { useNavigation } from "@/lib/useNavigation";

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
