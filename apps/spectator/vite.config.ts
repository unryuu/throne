import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Static build for GitHub Pages; relative base so it works under /throne/.
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { port: 4174 },
});
