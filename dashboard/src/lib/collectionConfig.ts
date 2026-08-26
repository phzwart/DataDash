import { load as loadYaml } from "js-yaml";
import { getTiledOrigin } from "./tiledServer";
import type { CrateSummary } from "./tiledCrates";

export type CrateCollectionConfig = {
  id?: string;
  title?: string;
  description?: string;
  /** Optional dashboard YAML to use with this collection. */
  dashboard_uri?: string;
  /** Explicit UUID allow-list. Empty/absent = no ID constraint. */
  crate_ids?: string[];
  /** Metadata key → expected value (string equality after String()). */
  filters?: Record<string, string | number | boolean>;
};

const STORAGE_KEY = "lambda.collection_uri";
const CHANGE_EVENT = "lambda-collection-uri-changed";

export const DEFAULT_COLLECTION_URI =
  import.meta.env.VITE_COLLECTION_URI ?? "";

export function getStoredCollectionUri(): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

export function setStoredCollectionUri(uri: string): void {
  localStorage.setItem(STORAGE_KEY, uri.trim());
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function clearStoredCollectionUri(): void {
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * Resolve collection YAML URI.
 * localStorage → env VITE_COLLECTION_URI → none (full Tiled /crates).
 */
export function resolveCollectionUri(): {
  uri: string | null;
  source: "localStorage" | "env" | "none";
} {
  const stored = getStoredCollectionUri();
  if (stored) return { uri: stored, source: "localStorage" };
  if (DEFAULT_COLLECTION_URI.trim()) {
    return { uri: DEFAULT_COLLECTION_URI.trim(), source: "env" };
  }
  return { uri: null, source: "none" };
}

export async function fetchCollectionConfig(
  uri: string,
): Promise<CrateCollectionConfig> {
  const res = await fetch(uri);
  if (!res.ok) {
    throw new Error(`Failed to fetch collection ${uri} (${res.status})`);
  }
  const doc = loadYaml(await res.text()) as Record<string, unknown>;
  if (!doc || typeof doc !== "object") {
    throw new Error(`Collection YAML at ${uri} did not parse to an object`);
  }

  const crateIdsRaw = doc.crate_ids;
  const crate_ids = Array.isArray(crateIdsRaw)
    ? crateIdsRaw.filter((x): x is string => typeof x === "string" && Boolean(x.trim()))
    : undefined;

  const filtersRaw = doc.filters;
  let filters: CrateCollectionConfig["filters"];
  if (filtersRaw && typeof filtersRaw === "object" && !Array.isArray(filtersRaw)) {
    filters = {};
    for (const [k, v] of Object.entries(filtersRaw as Record<string, unknown>)) {
      if (
        typeof v === "string" ||
        typeof v === "number" ||
        typeof v === "boolean"
      ) {
        filters[k] = v;
      }
    }
    if (Object.keys(filters).length === 0) filters = undefined;
  }

  return {
    id: typeof doc.id === "string" ? doc.id : undefined,
    title: typeof doc.title === "string" ? doc.title : undefined,
    description:
      typeof doc.description === "string" ? doc.description : undefined,
    dashboard_uri:
      typeof doc.dashboard_uri === "string" ? doc.dashboard_uri : undefined,
    crate_ids,
    filters,
  };
}

export function applyCollectionFilter(
  crates: CrateSummary[],
  collection: CrateCollectionConfig | null | undefined,
): CrateSummary[] {
  if (!collection) return crates;

  const idSet =
    collection.crate_ids && collection.crate_ids.length > 0
      ? new Set(collection.crate_ids)
      : null;
  const filters = collection.filters;

  return crates.filter((c) => {
    if (idSet && !idSet.has(c.id)) return false;
    if (filters) {
      for (const [key, expected] of Object.entries(filters)) {
        const actual = c.metadata[key];
        if (String(actual ?? "") !== String(expected)) return false;
      }
    }
    return true;
  });
}

/** Demo collection URI (Lambda MX EcCc*_MS) — labeled as such in Setup. */
export function exampleCollectionUri(): string {
  return `${getTiledOrigin()}/schemas/lambda_mx_collection.yaml`;
}

/** @deprecated Prefer exampleCollectionUri() for the live Tiled origin. */
export const EXAMPLE_COLLECTION_URI = exampleCollectionUri();

export { STORAGE_KEY, CHANGE_EVENT };
