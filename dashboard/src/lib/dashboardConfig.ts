import { Tiled } from "@blueskyproject/finch";
import { defaultDashboardUri } from "./schema";
import {
  getTiledApiKey,
  getTiledApiUrl,
  resolveAgainstTiledOrigin,
} from "./tiledServer";

const STORAGE_KEY = "lambda.dashboard_uri";

export function getStoredDashboardUri(): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

export function setStoredDashboardUri(uri: string): void {
  localStorage.setItem(STORAGE_KEY, uri.trim());
  window.dispatchEvent(new Event("lambda-dashboard-uri-changed"));
}

export function clearStoredDashboardUri(): void {
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event("lambda-dashboard-uri-changed"));
}

/** Read dashboard_uri from the Tiled /crates container metadata, if present. */
export async function fetchTiledDefaultDashboardUri(): Promise<string | null> {
  try {
    await Tiled.getFirstSearchWithApiKey(
      getTiledApiKey(),
      "crates",
      getTiledApiUrl(),
    );
    const meta = await Tiled.getItemMetadata("crates", getTiledApiUrl());
    const data = meta?.data as
      | { attributes?: { metadata?: Record<string, unknown> } }
      | undefined;
    const uri = data?.attributes?.metadata?.dashboard_uri;
    return typeof uri === "string" && uri.trim()
      ? resolveAgainstTiledOrigin(uri.trim())
      : null;
  } catch {
    return null;
  }
}

/**
 * Resolve dashboard YAML URI:
 * localStorage override → Tiled crates.dashboard_uri → env/built-in default
 */
export async function resolveDashboardUri(): Promise<{
  uri: string;
  source: "localStorage" | "tiled" | "default";
}> {
  const stored = getStoredDashboardUri();
  if (stored)
    return { uri: resolveAgainstTiledOrigin(stored), source: "localStorage" };

  const tiled = await fetchTiledDefaultDashboardUri();
  if (tiled) return { uri: tiled, source: "tiled" };

  return { uri: defaultDashboardUri(), source: "default" };
}

export { defaultDashboardUri, STORAGE_KEY };
export const DEFAULT_DASHBOARD_URI = defaultDashboardUri();
