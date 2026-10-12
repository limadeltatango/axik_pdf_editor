import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Two explicit bundled entries: viewer.html and the MV3 service worker.
 * The service worker is short-lived and owns no unsaved document state.
 */
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        viewer: resolve(here, "viewer.html"),
        background: resolve(here, "src/background.ts")
      },
      output: {
        entryFileNames: (entry) =>
          entry.name === "background" ? "background.js" : "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
});
