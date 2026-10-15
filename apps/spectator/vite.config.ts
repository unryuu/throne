import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { localRunsPlugin } from "./server/local-plugin.ts";
import react from "@vitejs/plugin-react";

// Static build for GitHub Pages; relative base so it works under /throne/.
export default defineConfig({
  base: "./",
  plugins: [
    react(),
    localRunsPlugin(fileURLToPath(new URL("../../", import.meta.url))),
  ],
  server: { port: 4174, strictPort: true },
});
