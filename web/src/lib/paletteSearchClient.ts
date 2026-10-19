import type { PaletteGroup } from "./commandPalette.ts";
import type {
  PaletteDocuments,
  PalettePage,
  PalettePages,
  PaletteSearchReply,
  PaletteSearchRequest,
} from "./paletteSearch.ts";

/** Browser worker in production; a controlled message transport in contract tests. */
export interface PaletteSearchWorker {
  postMessage(request: PaletteSearchRequest): void;
  terminate(): void;
  addEventListener(type: "message", listener: (event: { data: PaletteSearchReply }) => void): void;
  addEventListener(type: "error" | "messageerror", listener: () => void): void;
}

type Job = {
  id: number;
  groups: PaletteGroup[];
  query: string;
  pages: PalettePages;
  accept: (pages: PalettePage[]) => void;
};

/**
 * Own the worker lifecycle and catalog protocol: one scan in flight, one replaceable next query,
 * and only the current request may deliver results. Callers see their original rows, never wire
 * documents. Cancellation discards delivery, not the active scan's backpressure slot.
 */
export function createPaletteSearchClient(
  createWorker: () => PaletteSearchWorker,
  failed: () => void,
) {
  let worker: PaletteSearchWorker | undefined;
  let stopped = false;
  let id = 0;
  let active: Job | undefined;
  let queued: Job | undefined;
  let sent: PaletteGroup[] | undefined;
  let rows = new Map<string, PaletteGroup["rows"][number]>();

  const cancel = () => {
    id++;
    queued = undefined;
  };
  const dispose = () => {
    if (stopped) return;
    stopped = true;
    cancel();
    active = undefined;
    sent = undefined;
    rows.clear();
    worker?.terminate();
  };
  const fail = () => {
    if (stopped) return;
    dispose();
    failed();
  };
  const send = (job: Job) => {
    if (stopped) return;
    active = job;
    let documents: PaletteDocuments[] | undefined;
    if (job.groups !== sent) {
      documents = job.groups.map(({ id, heading, rows }) => ({
        id,
        heading,
        rows: rows.map((row) => ({
          key: row.key,
          value: row.value,
          keywords: row.keywords,
          ...("searchOnly" in row && row.searchOnly ? { searchOnly: true } : {}),
        })),
      }));
      rows = new Map(
        job.groups.flatMap((group) =>
          group.rows.map((row) => [`${group.id}:${row.key}`, row] as const),
        ),
      );
    }
    try {
      worker!.postMessage({ id: job.id, query: job.query, pages: job.pages, groups: documents });
      sent = job.groups;
    } catch {
      fail();
    }
  };

  try {
    worker = createWorker();
    worker.addEventListener("message", ({ data }) => {
      if (stopped || !active || data.id !== active.id) return;
      const job = active;
      active = undefined;
      const next = queued;
      queued = undefined;
      if (next) send(next);
      else if (job.id === id) {
        job.accept(
          data.pages.map(({ group, ...page }) => ({
            ...page,
            group: {
              ...group,
              rows: group.rows.map((row) => rows.get(`${group.id}:${row.key}`)!),
            } as PaletteGroup,
          })),
        );
      }
    });
    worker.addEventListener("error", fail);
    worker.addEventListener("messageerror", fail);
  } catch {
    fail();
  }

  return {
    search(
      groups: PaletteGroup[],
      query: string,
      pages: PalettePages,
      accept: (pages: PalettePage[]) => void,
    ) {
      if (stopped) return;
      const job = { id: ++id, groups, query, pages, accept };
      if (active) queued = job;
      else send(job);
    },
    cancel,
    dispose,
  };
}
