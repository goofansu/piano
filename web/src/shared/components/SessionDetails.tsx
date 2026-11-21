import { BranchLabel } from "@/shared/components/BranchLabel";

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
