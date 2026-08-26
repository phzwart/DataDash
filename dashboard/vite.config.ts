import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // plotly.js requires("buffer/") — trailing slash must resolve
      "buffer/": require.resolve("buffer/"),
    },
  },
  optimizeDeps: {
    include: ["buffer"],
  },
});
