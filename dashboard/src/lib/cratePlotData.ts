/**
 * Portable binders for per-crate dashboard plots (sidecar JSON or metadata).
 */

import type { CratePlotDataSpec } from "./schema";
import { getTiledOrigin } from "./tiledServer";
import type { CrateMetadata } from "./tiledCrates";

export type CratePlotRow = Record<string, unknown>;

function walkPath(root: unknown, path: string | undefined): unknown {
  if (!path || !path.trim()) return root;
  let cur: unknown = root;
  for (const part of path.split(".").filter(Boolean)) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function matchEntry(
  entry: Record<string, unknown>,
  match: NonNullable<CratePlotDataSpec["match"]>,
): boolean {
  const raw = entry[match.field];
  const text = raw == null ? "" : String(raw);
  if (match.equals != null) return text === match.equals;
  if (match.contains != null) return text.includes(match.contains);
  return true;
}

function coerceNumbers(
  rows: CratePlotRow[],
  fields: string[] | undefined,
): CratePlotRow[] {
  if (!fields?.length) return rows;
  return rows.map((row) => {
    const next = { ...row };
    for (const field of fields) {
      const v = next[field];
      if (typeof v === "number") continue;
      if (typeof v === "string" && v.trim() !== "") {
        const n = Number(v);
        if (Number.isFinite(n)) next[field] = n;
      }
    }
    return next;
  });
}

/**
 * Resolve plot rows from a sidecar document or crate metadata using a YAML data spec.
 */
export function resolveCratePlotRows(
  dataSpec: CratePlotDataSpec,
  sources: {
    sidecar?: unknown;
    metadata?: CrateMetadata;
  },
): CratePlotRow[] {
  if (dataSpec.from === "metadata") {
    const meta = sources.metadata ?? {};
    const node = walkPath(meta, dataSpec.path);
    if (Array.isArray(node)) {
      const rows = node.filter(
        (r): r is CratePlotRow =>
          r != null && typeof r === "object" && !Array.isArray(r),
      );
      return coerceNumbers(rows, dataSpec.number_fields);
    }
    if (node && typeof node === "object" && !Array.isArray(node)) {
      return coerceNumbers([node as CratePlotRow], dataSpec.number_fields);
    }
    return coerceNumbers([meta], dataSpec.number_fields);
  }

  const doc = sources.sidecar;
  if (doc == null) return [];

  let node = walkPath(doc, dataSpec.path);

  if (Array.isArray(node) && dataSpec.match) {
    const hit = node.find(
      (item) =>
        item &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        matchEntry(item as Record<string, unknown>, dataSpec.match!),
    );
    node = hit;
  } else if (Array.isArray(node) && !dataSpec.match) {
    // No match → use last table entry (common for shell_tables).
    node = node.length ? node[node.length - 1] : undefined;
  }

  const rowsPath = dataSpec.rows ?? "rows";
  const rowsNode =
    node && typeof node === "object" && !Array.isArray(node)
      ? walkPath(node, rowsPath)
      : node;

  if (!Array.isArray(rowsNode)) return [];
  const rows = rowsNode.filter(
    (r): r is CratePlotRow =>
      r != null && typeof r === "object" && !Array.isArray(r),
  );
  return coerceNumbers(rows, dataSpec.number_fields);
}

/** Fetch sidecar JSON from the Tiled host crate-assets endpoint. */
export async function fetchCrateSidecar(
  uuid: string,
  sidecarFile?: string | null,
): Promise<unknown> {
  const origin = getTiledOrigin();
  const url = new URL(`${origin}/crate-assets/${encodeURIComponent(uuid)}/sidecar`);
  if (sidecarFile && String(sidecarFile).trim()) {
    url.searchParams.set("file", String(sidecarFile).trim());
  }
  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Failed to fetch sidecar (${res.status})`);
  }
  return res.json();
}
