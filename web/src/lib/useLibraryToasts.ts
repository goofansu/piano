import { libraryKindOf, savedToast, storedLibraryResult } from "@shared/library";
import type { ToolExecution } from "@shared/wire";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

/**
 * A save of a skill or a prompt this page watched end gets the toast Settings shows for the same
 * change: "Skill created", "Prompt saved", or the refusal's sentence. Only a call seen running here
 * is announced, so reopening a session never repeats its toasts.
 */
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
