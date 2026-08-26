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

/**
 * Download RO-Crates from the facility and register them in local Tiled.
 */
export async function storeCratesToLocalTiled(
  uuids: string[],
  options?: {
    facilityUrl?: string;
    hydrateUrl?: string;
  },
): Promise<HydrateResult> {
  const base = normalizeHydrateUrl(options?.hydrateUrl ?? getHydrateUrl());
  const facility_url = options?.facilityUrl ?? getFacilityUrl();
  const res = await fetch(`${base}/api/v1/hydrate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uuids, facility_url }),
  });
  const body = (await res.json()) as HydrateResult;
  if (!res.ok && res.status !== 207) {
    throw new Error(
      (body as { tiled_registry_error?: string }).tiled_registry_error ||
        `Store failed (HTTP ${res.status})`,
    );
  }
  return body;
}

/** @deprecated Use storeCratesToLocalTiled */
export async function pullCartToLocalStore(
  uuids: string[],
  options?: Parameters<typeof storeCratesToLocalTiled>[1],
): Promise<HydrateResult> {
  return storeCratesToLocalTiled(uuids, options);
}
