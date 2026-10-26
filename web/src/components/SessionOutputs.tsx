import { cn } from "cn";
import { DetailsList, DetailsRowTitle, detailsRow } from "@/components/DetailsList";
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
 * Outputs: the files Pi wrote or edited in this session, listed in Details once there is one.
 * Each row is the file's name after its kind's icon, and opens the file as a Surface tab, as a
 * local file link in the transcript does; the tab and its toolbar carry the path.
 */
export function SessionOutputs({ files, cwd }: Props) {
  const { openFile } = useNavigation();
  return (
    <DetailsList aria-label="Outputs">
      {files.map((file) => {
        const shown = displayPath(file, cwd, abbrevHome);
        return (
          <Item
            key={file.path}
            size="sm"
            asChild
            className={cn(
              detailsRow,
              "cursor-pointer hover:bg-fill-hover focus-visible:bg-fill-hover",
            )}
          >
            <button type="button" onClick={() => openFile(file.path, "surface")} title={shown}>
              <ItemMedia variant="icon" className="text-ink-3">
                <FileTabIcon path={file.path} />
              </ItemMedia>
              <ItemContent className="min-w-0">
                <DetailsRowTitle className="truncate font-mono">
                  {splitPath(shown).name}
                </DetailsRowTitle>
              </ItemContent>
            </button>
          </Item>
        );
      })}
    </DetailsList>
  );
}
