import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PaletteGroup } from "./commandPalette.ts";
import {
  type PaletteDocuments,
  type PalettePage,
  type PalettePages,
  type PaletteSearchReply,
  type PaletteSearchRequest,
  pagePalette,
  searchPalette,
} from "./paletteSearch.ts";

const FIRST_PAGES: PalettePages = {};
const NO_RESULTS: PalettePage[] = [];

/** One in-flight scan, one replaceable next query. Typing never queues a scan per character. */
export function usePaletteSearch(groups: PaletteGroup[], query: string, paused: boolean) {
  const prepared = useMemo(
    () => ({
      documents: groups.map(({ id, heading, rows }) => ({
        id,
        heading,
        rows: rows.map(({ key, value, keywords }) => ({ key, value, keywords })),
      })),
      rows: new Map(
        groups.flatMap((group) =>
          group.rows.map((row) => [`${group.id}:${row.key}`, row] as const),
        ),
      ),
    }),
    [groups],
  );
  const [pages, setPages] = useState<PalettePages>(FIRST_PAGES);
  const [answer, setAnswer] = useState<{
    groups: PaletteGroup[];
    query: string;
    pages: PalettePages;
    generation: number;
    result: PalettePage[];
  }>();
  const [error, setError] = useState(false);
  const transport = useRef<{
    submit: (
      request: Omit<PaletteSearchRequest, "id">,
      accept: (pages: PalettePage<PaletteDocuments>[]) => void,
    ) => void;
    cancel: () => void;
  }>(null);
  useEffect(() => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./paletteSearch.worker.ts", import.meta.url), {
        type: "module",
      });
    } catch {
      setError(true);
      return;
    }
    let id = 0;
    let busy = false;
    let sent: PaletteDocuments[] | undefined;
    let queued: (() => void) | undefined;
    let accept: ((pages: PalettePage<PaletteDocuments>[]) => void) | undefined;
    worker.onmessage = ({ data }: MessageEvent<PaletteSearchReply>) => {
      busy = false;
      if (data.id === id) accept?.(data.pages);
      const next = queued;
      queued = undefined;
      next?.();
    };
    const failed = () => {
      setError(true);
      queued = undefined;
      worker.terminate();
    };
    worker.onerror = failed;
    worker.onmessageerror = failed;
    transport.current = {
      submit(request, receive) {
        const job = ++id;
        accept = receive;
        const send = () => {
          busy = true;
          try {
            worker.postMessage({
              ...request,
              id: job,
              groups: request.groups === sent ? undefined : request.groups,
            });
            sent = request.groups;
          } catch {
            failed();
          }
        };
        if (busy) queued = send;
        else send();
      },
      cancel() {
        id++;
        queued = undefined;
        accept = undefined;
      },
    };
    return () => {
      transport.current = null;
      worker.terminate();
    };
  }, []);

  // A new query starts on its first page. Catalog refreshes retain the page (the worker clamps
  // it if matches disappeared), rather than moving the user on every background update.
  const pageContext = useRef({ groups, query, generation: 0 });
  let currentPages = pages;
  if (pageContext.current.groups !== groups || pageContext.current.query !== query) {
    if (pageContext.current.query !== query) {
      currentPages = FIRST_PAGES;
      if (pages !== FIRST_PAGES) setPages(FIRST_PAGES);
    }
    pageContext.current = { groups, query, generation: pageContext.current.generation + 1 };
  }
  const generation = pageContext.current.generation;
  const current =
    !paused &&
    answer?.generation === generation &&
    answer?.groups === groups &&
    answer.query === query &&
    answer.pages === currentPages;
  useEffect(() => {
    if (!query.trim() || paused || error || current) return;
    transport.current?.submit(
      { groups: prepared.documents, query, pages: currentPages },
      (matches) => {
        const result = matches.map(({ group, ...page }) => ({
          ...page,
          group: {
            ...group,
            rows: group.rows.map((row) => prepared.rows.get(`${group.id}:${row.key}`)!),
          } as PaletteGroup,
        }));
        setAnswer({ groups, query, pages: currentPages, generation, result });
      },
    );
    return () => transport.current?.cancel();
  }, [groups, prepared, query, currentPages, generation, paused, error, current]);

  const recents = useMemo(() => pagePalette(searchPalette(groups, "")), [groups]);
  const changePage = useCallback(
    (group: PaletteGroup["id"], page: number) => setPages({ ...currentPages, [group]: page }),
    [currentPages],
  );
  const blank = !query.trim();
  const displayed = useRef(recents);
  if (blank) displayed.current = recents;
  else if (error) displayed.current = NO_RESULTS;
  else if (current && answer) displayed.current = answer.result;
  return {
    // Recents never wait for the worker (including immediately after clearing).
    result: displayed.current,
    pending: !blank && !current && !error,
    error: !blank && error,
    page: changePage,
    selectionKey: JSON.stringify([query, currentPages]),
  };
}
