import { cn } from "cn";
import { GitBranchIcon } from "lucide-react";

export function BranchLabel({ branch, className }: { branch: string; className?: string }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1 truncate font-mono", className)}>
      <GitBranchIcon className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{branch}</span>
    </span>
  );
}
