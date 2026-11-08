import { cn } from "cn";
import { BranchLabel } from "@/components/BranchLabel";

/**
 * The details under a session's title, wherever a session is listed (the sidebar, a project's home,
 * the palette): its folder, kept up to half the line so a long branch truncates first, then its
 * branch as a quiet sans label, each named for a screen reader. Renders the parts only; the row
 * lays out the line they sit on. A row with its own column sizing can override the folder cap.
 */
export function SessionDetails({
  folder,
  branch,
  folderClassName,
}: {
  folder?: string;
  branch?: string;
  folderClassName?: string;
}) {
  return (
    <>
      {folder && (
        <span className={cn("max-w-1/2 shrink-0 truncate", folderClassName)}>
          <span className="sr-only">Folder: </span>
          {folder}
        </span>
      )}
      {branch && (
        <>
          <span className="sr-only">Git branch: </span>
          <BranchLabel branch={branch} className="min-w-0 font-sans" />
        </>
      )}
    </>
  );
}
