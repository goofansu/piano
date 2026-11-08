import { cn } from "cn";
import { GitBranchIcon } from "lucide-react";

/**
 * A branch name the way it reads everywhere: a small branch icon, then the name in mono, truncating
 * from the end. Under a session title (the sidebar row, a project home's row) the branch is a quiet
 * sans label instead: pass `className="min-w-0 font-sans"`.
 */
export function BranchLabel({ branch, className }: { branch: string; className?: string }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1 truncate font-mono", className)}>
      <GitBranchIcon className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{branch}</span>
    </span>
  );
}
