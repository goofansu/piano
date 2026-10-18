import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PaletteGroup } from "./commandPalette.ts";
import {
  type PalettePage,
  type PalettePages,
  pagePalette,
  searchPalette,
} from "./paletteSearch.ts";
import { createPaletteSearchClient } from "./paletteSearchClient.ts";

const FIRST_PAGES: PalettePages = {};
const NO_RESULTS: PalettePage[] = [];

/** One in-flight scan, one replaceable next query. Typing never queues a scan per character. */
export function usePaletteSearch(groups: PaletteGroup[], query: string, paused: boolean) {
  const [pages, setPages] = useState<PalettePages>(FIRST_PAGES);
  const [answer, setAnswer] = useState<{
    groups: PaletteGroup[];
    query: string;
    pages: PalettePages;
    generation: number;
    result: PalettePage[];
  }>();
  const [error, setError] = useState(false);
  const transport = useRef<ReturnType<typeof createPaletteSearchClient>>(null);
  useEffect(() => {
    const client = createPaletteSearchClient(
      () => new Worker(new URL("./paletteSearch.worker.ts", import.meta.url), { type: "module" }),
      () => setError(true),
    );
    transport.current = client;
    return () => {
      transport.current = null;
      client.dispose();
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
    transport.current?.search(groups, query, currentPages, (result) => {
      setAnswer({ groups, query, pages: currentPages, generation, result });
    });
    return () => transport.current?.cancel();
  }, [groups, query, currentPages, generation, paused, error, current]);

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
