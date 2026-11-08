import { BranchLabel } from "@/components/BranchLabel";

/**
 * The details under a session's title in the sidebar, a project's home and the one-area session
 * header: its folder, kept up to half the line so a long branch truncates first, then its branch as
 * a quiet sans label, each named for a screen reader. Renders the parts only; the row lays out the line they sit on.
 */
export function SessionDetails({ folder, branch }: { folder?: string; branch?: string }) {
  return (
    <>
      {folder && (
        <span className="max-w-1/2 shrink-0 truncate">
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
