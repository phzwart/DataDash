/**
 * Active Tiled server target.
 *
 * Resolution: localStorage override → Vite env (VITE_TILED_API_*) → built-in default.
 * Changing the server updates Finch + all crate/schema fetches without a rebuild.
 */

/** v2 keys — do not collide with legacy dashboard localStorage. */
const URL_KEY = "lambda_v2.tiled_api_url";
const KEY_KEY = "lambda_v2.tiled_api_key";
export const TILED_SERVER_CHANGED = "lambda-v2-tiled-server-changed";

export const ENV_TILED_API_URL =
  import.meta.env.VITE_TILED_API_URL ?? "http://127.0.0.1:8770/api/v1";

export const ENV_TILED_API_KEY =
  import.meta.env.VITE_TILED_API_KEY ?? "secret";

/** Normalize to `…/api/v1` (no trailing slash after v1). */
export function normalizeTiledApiUrl(raw: string): string {
  let u = raw.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(u)) {
    u = `http://${u}`;
  }
  if (!/\/api\/v1$/i.test(u)) {
    u = `${u.replace(/\/api\/?$/i, "")}/api/v1`;
  }
  return u;
}

export function originFromApiUrl(apiUrl: string): string {
  return normalizeTiledApiUrl(apiUrl).replace(/\/api\/v1\/?$/i, "");
}

function readStorage(key: string): string | null {
  try {
    const v = localStorage.getItem(key);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

export function getStoredTiledApiUrl(): string | null {
  return readStorage(URL_KEY);
}

export function getStoredTiledApiKey(): string | null {
  return readStorage(KEY_KEY);
}

export function getTiledApiUrl(): string {
  const stored = getStoredTiledApiUrl();
  return normalizeTiledApiUrl(stored ?? ENV_TILED_API_URL);
}

export function getTiledApiKey(): string {
  return getStoredTiledApiKey() ?? ENV_TILED_API_KEY;
}

export function getTiledOrigin(): string {
  return originFromApiUrl(getTiledApiUrl());
}

/**
 * Rewrite absolute schema/dashboard URLs to the active Tiled origin.
 * Catalog + YAML often hardcode :8000; this keeps alternate ports working.
 *
 * In Vite dev, return a same-origin `/schemas/…` path so requests go through
 * the Vite proxy (see vite.config.ts) instead of a cross-origin fetch that
 * browsers often surface as TypeError: Failed to fetch.
 */
export function resolveAgainstTiledOrigin(uri: string): string {
  const trimmed = uri.trim();
  if (!trimmed) return trimmed;
  try {
    const base = getTiledOrigin();
    const u = new URL(trimmed, `${base}/`);
    if (u.pathname.startsWith("/schemas/")) {
      if (import.meta.env.DEV) {
        return `${u.pathname}${u.search}${u.hash}`;
      }
      return `${base}${u.pathname}${u.search}${u.hash}`;
    }
    return u.href;
  } catch {
    return trimmed;
  }
}

export function resolveTiledServer(): {
  apiUrl: string;
  apiKey: string;
  origin: string;
  source: "localStorage" | "env";
} {
  const storedUrl = getStoredTiledApiUrl();
  const storedKey = getStoredTiledApiKey();
  return {
    apiUrl: getTiledApiUrl(),
    apiKey: getTiledApiKey(),
    origin: getTiledOrigin(),
    source: storedUrl || storedKey ? "localStorage" : "env",
  };
}

function emitChange(): void {
  window.dispatchEvent(new Event(TILED_SERVER_CHANGED));
}

export function setStoredTiledServer(apiUrl: string, apiKey?: string): void {
  localStorage.setItem(URL_KEY, normalizeTiledApiUrl(apiUrl));
  if (apiKey !== undefined) {
    const k = apiKey.trim();
    if (k) localStorage.setItem(KEY_KEY, k);
    else localStorage.removeItem(KEY_KEY);
  }
  emitChange();
}

export function clearStoredTiledServer(): void {
  localStorage.removeItem(URL_KEY);
  localStorage.removeItem(KEY_KEY);
  emitChange();
}

/** Lightweight reachability check against `/api/v1/`. */
export async function probeTiledServer(
  apiUrl = getTiledApiUrl(),
  apiKey = getTiledApiKey(),
): Promise<{ ok: boolean; detail: string }> {
  const url = normalizeTiledApiUrl(apiUrl);
  try {
    const res = await fetch(`${url}/`, {
      headers: apiKey ? { Authorization: `Apikey ${apiKey}` } : {},
    });
    if (!res.ok) {
      return { ok: false, detail: `HTTP ${res.status}` };
    }
    const body = (await res.json()) as {
      library_version?: string;
      api_version?: number;
    };
    const ver = body.library_version
      ? `tiled ${body.library_version}`
      : `api v${body.api_version ?? "?"}`;
    return { ok: true, detail: ver };
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}
