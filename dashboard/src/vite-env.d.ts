/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TILED_API_URL: string;
  readonly VITE_TILED_API_KEY: string;
  readonly VITE_DASHBOARD_URI?: string;
  readonly VITE_COLLECTION_URI?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
