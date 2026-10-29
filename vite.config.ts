import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The dashboard is a static export: relative asset URLs so it works at a
// gateway subpath, an ENS name, or behind `npm run serve`.
export default defineConfig({
  root: "web",
  base: "./",
  plugins: [react()],
  build: { outDir: "../dist", emptyOutDir: true },
});
