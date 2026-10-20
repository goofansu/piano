import { cpSync, mkdirSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import zlib from "node:zlib";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// Self-host the assets from the exact PDF.js package used by React-PDF, in dev and builds.
const pdfjs = path.dirname(fileURLToPath(import.meta.resolve("pdfjs-dist/package.json")));
const pdfAssets = path.resolve(import.meta.dirname, "public/pdfjs");
mkdirSync(pdfAssets, { recursive: true });
for (const name of ["cmaps", "standard_fonts", "wasm"])
  cpSync(path.join(pdfjs, name), path.join(pdfAssets, name), { recursive: true });

// Keep the default local workflow; hosted development can use a separate backend.
const backend = process.env.PIANO_DEV_BACKEND ?? "http://127.0.0.1:7070";

const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);
/** The text formats worth compressing; images, fonts and archives already carry their own
 * compression. The server reads the same extensions back (server/StaticAssets.ts). */
const COMPRESSIBLE = new Set([
  "css",
  "html",
  "js",
  "json",
  "map",
  "mjs",
  "svg",
  "txt",
  "wasm",
  "webmanifest",
  "xml",
]);
// Below a packet's worth of payload, a coding costs a round of framing and saves nothing useful.
const MIN_BYTES = 1024;

const files = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });
  const found = await Promise.all(
    entries.map(async (entry) => {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) return files(file);
      return entry.isFile() && COMPRESSIBLE.has(path.extname(entry.name).slice(1).toLowerCase())
        ? [file]
        : [];
    }),
  );
  return found.flat();
};

/**
 * Writes a Brotli and a gzip copy beside every compressible build file, so the server answers
 * from them instead of compressing the same bytes on every request. A copy is kept only when it
 * is smaller than the file it codes, so the server never serves a coding that costs the client.
 */
const precompress = (): Plugin => {
  let outDir = "";
  return {
    name: "piano:precompress",
    apply: "build",
    enforce: "post",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      const pending = await files(outDir);
      let compressed = 0;
      let original = 0;
      let brotliBytes = 0;
      let gzipBytes = 0;
      let next = 0;
      const compress = async () => {
        while (next < pending.length) {
          const file = pending[next++];
          const source = await readFile(file);
          if (source.length < MIN_BYTES) continue;
          const [br, gz] = await Promise.all([
            brotli(source, {
              params: {
                [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY,
                [zlib.constants.BROTLI_PARAM_SIZE_HINT]: source.length,
              },
            }),
            gzip(source, { level: zlib.constants.Z_BEST_COMPRESSION }),
          ]);
          compressed += 1;
          original += source.length;
          brotliBytes += br.length;
          gzipBytes += gz.length;
          await Promise.all([
            br.length < source.length ? writeFile(`${file}.br`, br) : undefined,
            gz.length < source.length ? writeFile(`${file}.gz`, gz) : undefined,
          ]);
        }
      };
      await Promise.all(Array.from({ length: availableParallelism() }, compress));
      const mb = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;
      this.info(
        `precompressed ${compressed} files: ${mb(original)} to ${mb(brotliBytes)} brotli, ` +
          `${mb(gzipBytes)} gzip`,
      );
    },
  };
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), precompress()],
  optimizeDeps: { include: ["react-pdf", "shiki/bundle/full"] },
  worker: { format: "es" },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      "@shared": path.resolve(import.meta.dirname, "../shared"),
    },
  },
  server: {
    fs: { allow: [path.resolve(import.meta.dirname, "..")] },
    proxy: {
      "/api": backend,
      "/ws": { target: backend, ws: true },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
