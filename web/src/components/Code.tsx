import type { FileOptions } from "@pierre/diffs/react";
import { File, PatchDiff, WorkerPoolContextProvider } from "@pierre/diffs/react";
import { useTheme } from "next-themes";
import type { ReactNode } from "react";
import { useCodeWrap } from "@/lib/useCodeWrap";

/**
 * Read-only code, rendered by `@pierre/diffs`: a file's source and a file's patch. This seam keeps
 * the library's options in one place. Shiki highlights off the main thread in a small worker pool
 * that lives while any code is on screen, and the library virtualizes long files itself.
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

function Pool({ children }: { children: ReactNode }) {
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
      {children}
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
          options={{ ...options, diffStyle: "unified", hunkSeparators: "line-info-basic" }}
        />
      </Pool>
    </section>
  );
}
