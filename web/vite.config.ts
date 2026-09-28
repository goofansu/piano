import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      "@shared": path.resolve(import.meta.dirname, "../shared"),
    },
  },
  server: {
    fs: { allow: [path.resolve(import.meta.dirname, "..")] },
    proxy: {
      "/api": "http://127.0.0.1:7070",
      "/ws": { target: "ws://127.0.0.1:7070", ws: true },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
})
