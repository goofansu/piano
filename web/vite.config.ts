import { cpSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Self-host the assets from the exact PDF.js package used by React-PDF, in dev and builds.
const pdfjs = path.dirname(fileURLToPath(import.meta.resolve("pdfjs-dist/package.json")));
const pdfAssets = path.resolve(import.meta.dirname, "public/pdfjs");
mkdirSync(pdfAssets, { recursive: true });
for (const name of ["cmaps", "standard_fonts", "wasm"])
  cpSync(path.join(pdfjs, name), path.join(pdfAssets, name), { recursive: true });

// Keep the default local workflow; hosted development can use a separate backend.
const backend = process.env.PIANO_DEV_BACKEND ?? "http://127.0.0.1:7070";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
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
