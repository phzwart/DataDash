import { zipSync } from "fflate";
import type {
  ExportAssetSpec,
  ExportProfile,
} from "./schema";
import { getTiledApiKey, getTiledApiUrl, getTiledOrigin } from "./tiledServer";
import type { CrateMetadata, CrateSummary } from "./tiledCrates";

export type ExportProgress = {
  done: number;
  total: number;
  currentId?: string;
  message: string;
};

export type ExportPreviewRow = {
  id: string;
  label: string;
  files: string[];
};

const FORMAT_EXT: Record<string, string> = {
  png: "png",
  tiff: "tiff",
  tif: "tiff",
  npy: "npy",
  raw: "bin",
  "application/octet-stream": "bin",
  "image/png": "png",
  "image/tiff": "tiff",
};

/** Map dashboard format token → Tiled `format=` query value. */
export function tiledFormatParam(format: string): string {
  const f = format.trim().toLowerCase();
  if (f === "png" || f === "image/png") return "png";
  if (f === "tiff" || f === "tif" || f === "image/tiff") return "tiff";
  if (f === "npy" || f === "raw" || f === "application/octet-stream") {
    return "application/octet-stream";
  }
  return f;
}

export function formatExtension(format: string): string {
  const f = format.trim().toLowerCase();
  return FORMAT_EXT[f] ?? (f.replace(/[^a-z0-9]+/g, "") || "bin");
}

function sanitizeFilename(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_.]+|[_.]+$/g, "");
  return cleaned || "crate";
}

function metaValue(meta: CrateMetadata, slot: string, crateId: string): unknown {
  if (slot === "crate_id" || slot === "id") return crateId;
  return meta[slot];
}

function metaString(
  meta: CrateMetadata,
  slot: string,
  crateId: string,
): string {
  const v = metaValue(meta, slot, crateId);
  if (v == null || v === "") return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Interpolate `{slot}` tokens from crate metadata. */
export function applyNamingPattern(
  pattern: string | undefined,
  meta: CrateMetadata,
  crateId: string,
): string {
  const pat = pattern?.trim() || "{crate_id}";
  const stem = pat.replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, slot: string) => {
    const s = metaString(meta, slot, crateId);
    return s || (slot === "crate_id" || slot === "id" ? crateId.slice(0, 8) : "x");
  });
  return sanitizeFilename(stem);
}

export function assetZipPath(
  asset: ExportAssetSpec,
  stem: string,
  used: Set<string>,
): string {
  const dir = (asset.dir?.trim() || "arrays").replace(/^\/+|\/+$/g, "");
  const ext = formatExtension(asset.format);
  let base = `${dir}/${stem}.${ext}`;
  let n = 2;
  while (used.has(base)) {
    base = `${dir}/${stem}_${n}.${ext}`;
    n += 1;
  }
  used.add(base);
  return base;
}

export function previewExportRows(
  crates: CrateSummary[],
  profile: ExportProfile,
  /** Optional dashboard hero title slot for human labels. */
  titleSlot?: string,
): ExportPreviewRow[] {
  return crates.map((c) => {
    const stem = applyNamingPattern(profile.naming?.pattern, c.metadata, c.id);
    const used = new Set<string>();
    const files = profile.assets.map((a) => assetZipPath(a, stem, used));
    const title = titleSlot
      ? metaString(c.metadata, titleSlot, c.id)
      : "";
    const label = title || stem || c.id.slice(0, 8);
    return { id: c.id, label, files };
  });
}

async function fetchCrateAsset(
  uuid: string,
  asset: ExportAssetSpec,
): Promise<Uint8Array> {
  const format = tiledFormatParam(asset.format);
  const params = new URLSearchParams({
    format,
    api_key: getTiledApiKey(),
  });
  const url = `${getTiledOrigin()}/api/v1/array/full/crates/${uuid}/${encodeURIComponent(asset.child)}?${params}`;
  const accept =
    format === "png"
      ? "image/png"
      : format === "tiff"
        ? "image/tiff"
        : "application/octet-stream";
  const res = await fetch(url, { headers: { Accept: accept } });
  if (!res.ok) {
    throw new Error(
      `${asset.child} (${asset.format}) failed for ${uuid.slice(0, 8)}… (${res.status})`,
    );
  }
  return new Uint8Array(await res.arrayBuffer());
}

function pickManifestMetadata(
  meta: CrateMetadata,
  crateId: string,
  slots: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const slot of slots) {
    out[slot] = metaValue(meta, slot, crateId) ?? null;
  }
  return out;
}

function triggerDownload(filename: string, data: Uint8Array): void {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const blob = new Blob([copy.buffer], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Fetch declared assets for each cart crate, build manifest.json, ZIP, download.
 */
export async function exportCartZip(opts: {
  crates: CrateSummary[];
  profile: ExportProfile;
  onProgress?: (p: ExportProgress) => void;
}): Promise<{ filename: string; fileCount: number }> {
  const { crates, profile, onProgress } = opts;
  if (crates.length === 0) {
    throw new Error("Cart is empty");
  }
  if (!profile.assets.length) {
    throw new Error(`Profile ${profile.id} has no assets`);
  }

  const total = crates.length * profile.assets.length;
  let done = 0;
  const zipFiles: Record<string, Uint8Array> = {};
  const usedPaths = new Set<string>();
  const manifestCrates: Array<{
    id: string;
    files: string[];
    metadata: Record<string, unknown>;
  }> = [];

  for (const crate of crates) {
    onProgress?.({
      done,
      total,
      currentId: crate.id,
      message: `Exporting ${crate.id.slice(0, 8)}…`,
    });

    const stem = applyNamingPattern(
      profile.naming?.pattern,
      crate.metadata,
      crate.id,
    );
    const files: string[] = [];

    for (const asset of profile.assets) {
      const path = assetZipPath(asset, stem, usedPaths);
      const bytes = await fetchCrateAsset(crate.id, asset);
      zipFiles[path] = bytes;
      files.push(path);
      done += 1;
      onProgress?.({
        done,
        total,
        currentId: crate.id,
        message: `Wrote ${path}`,
      });
    }

    const slots = profile.manifest?.slots ?? [];
    manifestCrates.push({
      id: crate.id,
      files,
      metadata: pickManifestMetadata(crate.metadata, crate.id, slots),
    });
  }

  const manifestName = profile.manifest?.filename?.trim() || "manifest.json";
  const manifest = {
    profile: profile.id,
    title: profile.title,
    exported_at: new Date().toISOString(),
    tiled_api_url: getTiledApiUrl(),
    crate_count: crates.length,
    crates: manifestCrates,
  };
  const encoder = new TextEncoder();
  zipFiles[manifestName] = encoder.encode(JSON.stringify(manifest, null, 2));

  onProgress?.({
    done: total,
    total,
    message: "Building ZIP…",
  });

  const zipped = zipSync(zipFiles, { level: 6 });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `${sanitizeFilename(profile.id)}-${stamp}.zip`;
  triggerDownload(filename, zipped);

  onProgress?.({
    done: total,
    total,
    message: `Downloaded ${filename}`,
  });

  return { filename, fileCount: Object.keys(zipFiles).length };
}
