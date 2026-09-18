import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function tiledOriginFromEnv(env: Record<string, string>): string {
  const raw = env.VITE_TILED_API_URL || "http://127.0.0.1:8770/api/v1";
  try {
    const u = new URL(raw.includes("://") ? raw : `http://${raw}`);
    return u.origin;
  } catch {
    return "http://127.0.0.1:8770";
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const tiledOrigin = tiledOriginFromEnv(env);

  return {
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: 5175,
      strictPort: true,
      // Same-origin /schemas in dev — avoids browser CORS "Failed to fetch" on YAML.
      proxy: {
        "/schemas": {
          target: tiledOrigin,
          changeOrigin: true,
        },
        "/crate-assets": {
          target: tiledOrigin,
          changeOrigin: true,
        },
        // Facility search API — same-origin in dev avoids CORS / down-port confusion.
        "/facility": {
          target: env.VITE_FACILITY_API_URL || "http://127.0.0.1:8767",
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/facility/, ""),
        },
        // Agent job outputs (PDB/MAP raw) — same-origin for Mol* popup.
        "/agent": {
          target: env.VITE_AGENT_API_URL || "http://127.0.0.1:8780",
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/agent/, ""),
        },
        "/api/v1/project-book": {
          target: tiledOrigin,
          changeOrigin: true,
        },
      },
    },
    resolve: {
      alias: {
        // plotly.js requires("buffer/") — trailing slash must resolve
        "buffer/": require.resolve("buffer/"),
      },
    },
    optimizeDeps: {
      include: ["buffer"],
    },
  };
});
