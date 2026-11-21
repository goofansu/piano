import { libraryKindOf, savedToast, storedLibraryResult } from "@shared/features/library/library";
import type { ToolExecution } from "@shared/wire";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

export function useLibraryToasts(tools: readonly ToolExecution[] | undefined) {
  const running = useRef(new Set<string>());
  useEffect(() => {
    for (const tool of tools ?? []) {
      if (!libraryKindOf(tool.name)) continue;
      if (tool.status === "running") {
        running.current.add(tool.id);
        continue;
      }
      if (!running.current.delete(tool.id)) continue;
      const result = storedLibraryResult(tool.name, tool.text);
      if (result?.status === "saved") toast.success(savedToast(result.kind, result.change));
      else if (result?.status === "refused") toast.error(result.detail);
    }
  }, [tools]);
}
