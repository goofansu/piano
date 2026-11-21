import { createPaletteSearch, type PaletteSearchRequest } from "./paletteSearch.ts";

const search = createPaletteSearch();
self.onmessage = (event: MessageEvent<PaletteSearchRequest>) => {
  self.postMessage(search(event.data));
};
