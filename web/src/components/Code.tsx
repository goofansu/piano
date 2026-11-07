import { Virtualizer } from "@pierre/diffs";
import type { FileOptions } from "@pierre/diffs/react";
import {
  File,
  MultiFileDiff,
  PatchDiff,
  VirtualizerContext,
  WorkerPoolContextProvider,
} from "@pierre/diffs/react";
import { useTheme } from "next-themes";
import { type ReactNode, use, useLayoutEffect, useMemo } from "react";
import { ScrollRootContext } from "@/lib/scrollRoot";
import { useCodeWrap } from "@/lib/useCodeWrap";

/**
 * Read-only code, rendered by `@pierre/diffs`: a file's source and a file's patch. This seam keeps
 * the library's options in one place. Shiki highlights off the main thread in a small worker pool
 * that lives while any code is on screen. Inside a pane, every code view shares one library
 * `Virtualizer` on the pane's scroller, so only lines in view are in the document.
 */

/** Piano's sheet, ink and diff tints instead of the Shiki theme's own; tokens keep their colours. */
const PIANO_CSS = `
:host {
  --diffs-light-bg: var(--conversation);
  --diffs-dark-bg: var(--conversation);
  --diffs-font-family: var(--font-mono);
  --diffs-header-font-family: var(--font-sans);
  --diffs-font-size: 0.75rem;
  --diffs-line-height: 1.25rem;
  --diffs-tab-size: 2;
  --diffs-fg-number-override: var(--ink-3);
  --diffs-addition-color-override: var(--ok);
  --diffs-deletion-color-override: var(--err);
  --diffs-bg-separator-override: var(--fill);
}
`;

function useOptions() {
  const { resolvedTheme } = useTheme();
  const [wrap] = useCodeWrap();
  return {
    theme: { light: "github-light", dark: "github-dark" },
    themeType: resolvedTheme === "dark" ? "dark" : "light",
    overflow: wrap ? "wrap" : "scroll",
    disableFileHeader: true,
    unsafeCSS: PIANO_CSS,
  } satisfies FileOptions<undefined, undefined>;
}

/** One virtualizer per scroller, set up while any code view uses it. */
const virtualizers = new WeakMap<HTMLElement, { virtualizer: Virtualizer; users: number }>();

function useScrollVirtualizer(root: HTMLElement | null | undefined) {
  const entry = useMemo(() => {
    if (!root) return undefined;
    let found = virtualizers.get(root);
    if (!found) virtualizers.set(root, (found = { virtualizer: new Virtualizer(), users: 0 }));
    return found;
  }, [root]);
  useLayoutEffect(() => {
    if (!root || !entry) return;
    if (entry.users++ === 0) entry.virtualizer.setup(root);
    return () => {
      if (--entry.users === 0) {
        entry.virtualizer.cleanUp();
        virtualizers.delete(root);
      }
    };
  }, [root, entry]);
  return entry?.virtualizer;
}

/** The worker pool and, inside a pane, its virtualizer. The library picks virtualized rendering
 * when a view mounts, so a pane's code waits for its scroller to mount first. */
function Pool({ children }: { children: ReactNode }) {
  const root = use(ScrollRootContext);
  const virtualizer = useScrollVirtualizer(root);
  if (root === null) return null;
  return (
    <WorkerPoolContextProvider
      poolOptions={{
        workerFactory: () =>
          new Worker(new URL("@pierre/diffs/worker/worker.js", import.meta.url), {
            type: "module",
          }),
        poolSize: 2,
      }}
      highlighterOptions={{ theme: { light: "github-light", dark: "github-dark" } }}
    >
      <VirtualizerContext value={virtualizer}>{children}</VirtualizerContext>
    </WorkerPoolContextProvider>
  );
}

/** A file's text with line numbers, highlighted as `language` (or as its name suggests). */
export function CodeFile({
  name,
  content,
  language,
}: {
  name: string;
  content: string;
  language: string;
}) {
  const options = useOptions();
  if (!content) return <p className="p-4 text-sm text-ink-3">(Empty file)</p>;
  return (
    <Pool>
      <File file={{ name, contents: content, lang: language || undefined }} options={options} />
    </Pool>
  );
}

/** One file's unified Git patch, as Changes reads it. */
export function CodePatch({ patch, label }: { patch: string; label: string }) {
  const options = useOptions();
  return (
    <section aria-label={label} className="border-t border-line">
      <Pool>
        <PatchDiff
          patch={patch}
          options={{ ...options, diffStyle: "unified" }}
        />
      </Pool>
    </section>
  );
}

/** Two versions of one text, diffed by the library: a proposal against the saved file. */
export function CodeTextDiff({
  name,
  before,
  after,
  label,
}: {
  name: string;
  before: string;
  after: string;
  label: string;
}) {
  const options = useOptions();
  return (
    <section aria-label={label} className="border-t border-line">
      <Pool>
        <MultiFileDiff
          oldFile={{ name, contents: before }}
          newFile={{ name, contents: after }}
          options={{ ...options, diffStyle: "unified" }}
        />
      </Pool>
    </section>
  );
}
