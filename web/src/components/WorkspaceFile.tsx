import type { Workspace } from "@shared/wire";
import { XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { workspaceFile } from "@/lib/api";

/** Inline complementary panel: unlike a modal Sheet it leaves the conversation usable.
 * No stock shadcn component provides a nonmodal, in-flow file viewer. */
export function WorkspaceFile({ workspace, close }: { workspace: Workspace; close: () => void }) {
  const [path, setPath] = useState("");
  const [result, setResult] = useState<{ path: string; content: string }>();
  const [status, setStatus] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function open() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setResult(undefined);
    setStatus("Opening…");
    try {
      const file = await workspaceFile(workspace.id, path, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setResult(file);
      setStatus("");
    } catch (error) {
      if (!controller.signal.aborted)
        setStatus(error instanceof Error ? error.message : "Could not read this file. Try again.");
    }
  }
  return (
    <aside
      aria-label="File viewer"
      className="flex min-h-0 min-w-0 basis-1/2 flex-col gap-3 border-t border-line p-4 md:w-2/5 md:max-w-xl md:shrink-0 md:basis-auto md:border-t-0 md:border-l"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="truncate text-sm font-medium">{result?.path ?? "Open file"}</h2>
        <Button variant="ghost" size="icon-sm" aria-label="Close file viewer" onClick={close}>
          <XIcon />
        </Button>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void open();
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="workspace-file-path">File path</FieldLabel>
            <div className="flex gap-2">
              <Input
                id="workspace-file-path"
                value={path}
                onChange={(event) => setPath(event.target.value)}
                placeholder="src/main.ts"
                autoFocus
              />
              <Button type="submit" variant="outline" disabled={!path.trim()}>
                Open
              </Button>
            </div>
            <FieldDescription>
              UTF-8 text up to 1 MiB, relative to {workspace.path}.
            </FieldDescription>
          </Field>
        </FieldGroup>
      </form>
      {status && (
        <p role="status" className="text-sm text-muted-foreground">
          {status}
        </p>
      )}
      {/* Plain text only: source HTML and Markdown must never execute or load remote resources. */}
      {result && (
        <section aria-label="File contents" className="min-h-0 flex-1 overflow-auto text-xs">
          <pre>
            <code>{result.content || "(Empty file)"}</code>
          </pre>
        </section>
      )}
    </aside>
  );
}
