/**
 * Hydrate API — store facility UUIDs in the local client store (local Tiled).
 * Default base is the local Tiled origin (client_store on :8770).
 */

import { getFacilityUrl } from "./facilityApi";
import { getTiledOrigin } from "./tiledServer";

const URL_KEY = "lambda_v2.hydrate_api_url";
export const HYDRATE_SERVER_CHANGED = "lambda-v2-hydrate-server-changed";

export const ENV_HYDRATE_API_URL =
  import.meta.env.VITE_HYDRATE_API_URL ?? "";

function readStorage(key: string): string | null {
  try {
    const v = localStorage.getItem(key);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

export function normalizeHydrateUrl(raw: string): string {
  let u = raw.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(u)) {
    u = `http://${u}`;
  }
  if (/\/api\/v1$/i.test(u)) {
    u = u.replace(/\/api\/v1$/i, "");
  }
  return u;
}

export function getStoredHydrateUrl(): string | null {
  return readStorage(URL_KEY);
}

/** Hydrate service origin; falls back to local Tiled origin. */
export function getHydrateUrl(): string {
  const stored = getStoredHydrateUrl();
  if (stored) return normalizeHydrateUrl(stored);
  if (ENV_HYDRATE_API_URL.trim()) {
    return normalizeHydrateUrl(ENV_HYDRATE_API_URL);
  }
  return normalizeHydrateUrl(getTiledOrigin());
}

export function setStoredHydrateUrl(url: string): void {
  localStorage.setItem(URL_KEY, normalizeHydrateUrl(url));
  window.dispatchEvent(new Event(HYDRATE_SERVER_CHANGED));
}

export function clearStoredHydrateUrl(): void {
  localStorage.removeItem(URL_KEY);
  window.dispatchEvent(new Event(HYDRATE_SERVER_CHANGED));
}

export type HydrateResult = {
  ok: boolean;
  hydrated?: Array<{ uuid: string; sidecars?: string[]; ok?: boolean }>;
  errors?: Array<{ uuid: string; error: string }>;
  count?: number;
  error_count?: number;
  tiled_registry?: Record<string, number>;
  tiled_registry_error?: string;
  data_root?: string;
};

export type HydrateProgress = {
  phase: string;
  current?: number;
  total?: number;
  uuid?: string;
  message?: string;
  result?: HydrateResult;
};

export function hydrateProgressPercent(progress: HydrateProgress | null): number {
  if (!progress) return 0;
  if (progress.phase === "done") return 100;
  if (progress.phase === "error") return 100;
  const total = progress.total ?? 0;
  const current = progress.current ?? 0;
  if (total <= 0) return progress.phase === "start" ? 2 : 0;
  // Download is ~70% of the bar; register is the remaining ~30%.
  if (progress.phase === "download" || progress.phase === "download_error") {
    return Math.min(70, Math.round((current / total) * 70));
  }
  if (
    progress.phase === "register" ||
    progress.phase === "register_start" ||
    progress.phase === "register_error"
  ) {
    return Math.min(99, 70 + Math.round((current / Math.max(total, 1)) * 30));
  }
  return 5;
}

export async function hydrateHealth(
  baseUrl = getHydrateUrl(),
): Promise<{ ok: boolean; detail: string }> {
  const base = normalizeHydrateUrl(baseUrl);
  try {
    const res = await fetch(`${base}/api/v1/hydrate/health`);
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const body = (await res.json()) as { status?: string; role?: string };
    return {
      ok: true,
      detail: `${body.status ?? "ok"}${body.role ? ` (${body.role})` : ""}`,
    };
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

async function readNdjsonStream(
  res: Response,
  onProgress?: (p: HydrateProgress) => void,
): Promise<HydrateResult> {
  if (!res.body) {
    throw new Error("Hydrate stream returned no body");
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult: HydrateResult | null = null;
  let lastError: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let event: HydrateProgress;
      try {
        event = JSON.parse(trimmed) as HydrateProgress;
      } catch {
        continue;
      }
      onProgress?.(event);
      if (event.result) {
        finalResult = event.result;
      }
      if (event.phase === "error" && event.message) {
        lastError = event.message;
      }
    }
  }

  const trailing = buffer.trim();
  if (trailing) {
    try {
      const event = JSON.parse(trailing) as HydrateProgress;
      onProgress?.(event);
      if (event.result) finalResult = event.result;
      if (event.phase === "error" && event.message) lastError = event.message;
    } catch {
      // ignore incomplete trailing chunk
    }
  }

  if (finalResult) return finalResult;
  throw new Error(lastError || "Hydrate stream ended without a result");
}

/**
 * Download RO-Crates from the facility and register them in local Tiled.
 * Uses NDJSON progress streaming by default.
 */
export async function storeCratesToLocalTiled(
  uuids: string[],
  options?: {
    facilityUrl?: string;
    hydrateUrl?: string;
    onProgress?: (p: HydrateProgress) => void;
  },
): Promise<HydrateResult> {
  const base = normalizeHydrateUrl(options?.hydrateUrl ?? getHydrateUrl());
  const facility_url = options?.facilityUrl ?? getFacilityUrl();
  const res = await fetch(`${base}/api/v1/hydrate?stream=1`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/x-ndjson",
    },
    body: JSON.stringify({ uuids, facility_url }),
  });

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("ndjson") || contentType.includes("stream")) {
    if (!res.ok && res.status !== 207) {
      // Still try to parse stream for structured error.
      try {
        return await readNdjsonStream(res, options?.onProgress);
      } catch {
        throw new Error(`Store failed (HTTP ${res.status})`);
      }
    }
    return readNdjsonStream(res, options?.onProgress);
  }

  const body = (await res.json()) as HydrateResult;
  if (!res.ok && res.status !== 207) {
    throw new Error(
      body.tiled_registry_error || `Store failed (HTTP ${res.status})`,
    );
  }
  options?.onProgress?.({
    phase: "done",
    current: uuids.length,
    total: uuids.length,
    message: "Done",
    result: body,
  });
  return body;
}

/** @deprecated Use storeCratesToLocalTiled */
export async function pullCartToLocalStore(
  uuids: string[],
  options?: Parameters<typeof storeCratesToLocalTiled>[1],
): Promise<HydrateResult> {
  return storeCratesToLocalTiled(uuids, options);
}
