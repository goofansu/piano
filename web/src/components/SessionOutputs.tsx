import { cn } from "cn";
import { RailList, RailRowTitle, railRow } from "@/components/SessionRailList";
import { Item, ItemContent, ItemMedia } from "@/components/ui/item";
import { FileTabIcon } from "@/components/WorkspaceFile";
import { abbrevHome } from "@/lib/format";
import { displayPath, type SessionFile, splitPath } from "@/lib/sessionFiles";
import { useNavigation } from "@/lib/useNavigation";

interface Props {
  /** In conversation order, already filtered by the workspace's `.gitignore` (`useSessionFiles`). */
  files: readonly SessionFile[];
  /** The session's directory, which paths inside it are shown relative to. */
  cwd?: string;
}

/**
 * Outputs: the files Pi wrote or edited in this session, listed in the session rail once there is one.
 * Each row is the file's name after its kind's icon, and opens the file as a Surface tab, as a
 * local file link in the transcript does; the tab and its toolbar carry the path.
 */
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
            asChild
            className={cn(
              railRow,
              "cursor-pointer hover:bg-fill-hover focus-visible:bg-fill-hover",
            )}
          >
            <button type="button" onClick={() => openFile(file.path)} title={shown}>
              <ItemMedia variant="icon" className="text-ink-3">
                <FileTabIcon path={file.path} />
              </ItemMedia>
              <ItemContent className="min-w-0">
                <RailRowTitle className="truncate font-mono">{splitPath(shown).name}</RailRowTitle>
              </ItemContent>
            </button>
          </Item>
        );
      })}
    </RailList>
  );
}
