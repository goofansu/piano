import { cn } from "cn";
import { FileIcon } from "lucide-react";
import { UsageListPopover } from "@/components/UsageListPopover";
import { abbrevHome } from "@/lib/format";
import { displayPath, type SessionFile, splitPath } from "@/lib/sessionFiles";
import { listRow } from "@/lib/styles";
import { useNavigation } from "@/lib/useNavigation";

interface Props {
  /** In conversation order, already filtered by the workspace's `.gitignore` (`useSessionFiles`). */
  files: readonly SessionFile[];
  /** The session's directory, which paths inside it are shown relative to. */
  cwd?: string;
}

/**
 * The files Pi wrote or edited in this session, opened from the usage row beside Links. Each
 * opens in the right sidebar's file viewer, as a local file link in the transcript does.
 * Absent while the session wrote nothing.
 */
export function SessionFiles({ files, cwd }: Props) {
  const { openPanel } = useNavigation();
  if (files.length === 0) return null;
  return (
    <UsageListPopover
      label="Files"
      icon={FileIcon}
      count={files.length}
      noun={["file", "files"]}
      description="written or edited in this session"
    >
      {files.map((file) => {
        const { name, dir } = splitPath(displayPath(file, cwd, abbrevHome));
        return (
          <li key={file.path} className="flex items-center">
            <button
              type="button"
              onClick={() => openPanel({ kind: "file", path: file.path })}
              className={cn(listRow, "min-w-0 flex-1 px-4 py-1.5")}
            >
              {/* Two lines in mono, as the transcript names paths: files in one session mostly
                  share a directory, so the name leads and the directory sits under it. Every
                  row opens the viewer, so no glyph marks it. */}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-mono text-ink">{name}</span>
                {dir && <span className="truncate font-mono text-xs text-ink-3">{dir}</span>}
              </span>
            </button>
          </li>
        );
      })}
    </UsageListPopover>
  );
}
