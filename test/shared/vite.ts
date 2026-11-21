import path from "node:path";
import { after } from "node:test";
import { createServer } from "vite";

export const vite = await createServer({
  root: path.resolve("web"),
  server: { middlewareMode: true, watch: null, ws: false },
  appType: "custom",
  optimizeDeps: { noDiscovery: true, include: [] },
});
after(() => vite.close());
