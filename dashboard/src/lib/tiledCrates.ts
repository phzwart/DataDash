import { Tiled } from "@blueskyproject/finch";
import type { TiledSearchItem } from "@blueskyproject/tiled";
import {
  applyCollectionFilter,
  fetchCollectionConfig,
  resolveCollectionUri,
} from "./collectionConfig";
import { getTiledApiKey, getTiledApiUrl, getTiledOrigin } from "./tiledServer";

export type CrateMetadata = Record<string, unknown>;

export type CrateSummary = {
  id: string;
  metadata: CrateMetadata;
};

export type TissueClassRow = {
  key: string;
  name: string;
  description?: string;
  tissueClassId?: number;
  fraction: number;
  percent: number;
  pixelCount: number;
};

/** Slot names for reading class-fraction rows from crate metadata. */
export type ClassFractionSlots = {
  /** Multivalued list slot on the record (e.g. binding.legend_slot). */
  legendSlot: string;
  idSlot?: string;
  keySlot?: string;
  nameSlot?: string;
  fractionSlot?: string;
  percentSlot?: string;
  pixelCountSlot?: string;
};

function asRecord(value: unknown): CrateMetadata {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as CrateMetadata)
    : {};
}

export async function fetchAllCrates(): Promise<CrateSummary[]> {
  const result = await Tiled.getFirstSearchWithApiKey(
    getTiledApiKey(),
    "crates",
    getTiledApiUrl(),
  );
  if (!result?.data) return [];
  return result.data.map((item: TiledSearchItem<unknown>) => ({
    id: item.id,
    metadata: asRecord(item.attributes?.metadata),
  }));
}

/**
 * Crates in the active collection universe (Setup collection YAML).
 * No collection URI → all of /crates. Gallery search filters further client-side.
 */
export async function fetchCrates(): Promise<CrateSummary[]> {
  const all = await fetchAllCrates();
  const { uri } = resolveCollectionUri();
  if (!uri) return all;
  try {
    const collection = await fetchCollectionConfig(uri);
    return applyCollectionFilter(all, collection);
  } catch {
    // Bad/missing collection URI: fall back to full catalog rather than empty UI
    return all;
  }
}

export async function fetchCrateMetadata(
  uuid: string,
): Promise<CrateSummary | null> {
  await Tiled.getFirstSearchWithApiKey(
    getTiledApiKey(),
    "crates",
    getTiledApiUrl(),
  );
  const meta = await Tiled.getItemMetadata(`crates/${uuid}`, getTiledApiUrl());
  if (!meta?.data) return null;
  const item = meta.data as TiledSearchItem<unknown>;
  return {
    id: item.id,
    metadata: asRecord(item.attributes?.metadata),
  };
}

export function str(meta: CrateMetadata, key: string): string {
  const v = meta[key];
  if (v == null || v === "") return "—";
  return String(v);
}

export function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

/**
 * Read class-fraction rows from a binding-declared legend list slot.
 * Slot names come from ClassMaskBinding / dashboard — not hardcoded domain keys.
 */
export function tissueClassRows(
  meta: CrateMetadata,
  slots: ClassFractionSlots,
): TissueClassRow[] {
  const rich = meta[slots.legendSlot];
  if (!Array.isArray(rich) || rich.length === 0) return [];

  const idSlot = slots.idSlot ?? "label_id";
  const keySlot = slots.keySlot ?? "label_key";
  const nameSlot = slots.nameSlot ?? "label_name";
  const fracSlot = slots.fractionSlot ?? "fraction";
  const pctSlot = slots.percentSlot ?? "percent";
  const pixSlot = slots.pixelCountSlot ?? "pixel_count";

  return rich
    .map((row) => {
      const r = asRecord(row);
      const key = String(r[keySlot] ?? r.key ?? "unknown");
      const fraction = Number(r[fracSlot] ?? 0);
      const idRaw = r[idSlot];
      return {
        key,
        name: String(r[nameSlot] ?? key),
        description:
          typeof r.description === "string" ? r.description : undefined,
        tissueClassId: typeof idRaw === "number" ? idRaw : undefined,
        fraction,
        percent: Number(r[pctSlot] ?? fraction * 100),
        pixelCount: Number(r[pixSlot] ?? 0),
      };
    })
    .sort((a, b) => b.fraction - a.fraction);
}

export function crateChildPreviewUrl(
  uuid: string,
  child: string,
  step = 8,
): string {
  const params = new URLSearchParams({
    slice: `::${step},::${step}`,
    format: "png",
    api_key: getTiledApiKey(),
  });
  return `${getTiledOrigin()}/api/v1/array/full/crates/${uuid}/${child}?${params}`;
}

export type SeriesMember = {
  id: string;
  index: number;
  label: string;
  metadata: CrateMetadata;
};

/**
 * Find crates that share a series group key (e.g. same acquisition stem),
 * ordered by series index (e.g. slice_index).
 */
export async function fetchSeriesMembers(
  current: CrateSummary,
  groupKey: string,
  indexKey: string,
): Promise<SeriesMember[]> {
  const groupVal = current.metadata[groupKey];
  if (groupVal == null || groupVal === "") {
    return [
      {
        id: current.id,
        index: Number(current.metadata[indexKey] ?? 0),
        label: String(current.metadata[indexKey] ?? current.id),
        metadata: current.metadata,
      },
    ];
  }

  const all = await fetchCrates();
  const members = all
    .filter((c) => c.metadata[groupKey] === groupVal)
    .map((c) => ({
      id: c.id,
      index: Number(c.metadata[indexKey] ?? 0),
      label: String(c.metadata[indexKey] ?? c.id),
      metadata: c.metadata,
    }))
    .sort((a, b) => a.index - b.index || a.id.localeCompare(b.id));

  return members.length > 0
    ? members
    : [
        {
          id: current.id,
          index: Number(current.metadata[indexKey] ?? 0),
          label: String(current.metadata[indexKey] ?? current.id),
          metadata: current.metadata,
        },
      ];
}

/** @deprecated use crateChildPreviewUrl */
export function crateImagePreviewUrl(uuid: string, step = 8): string {
  return crateChildPreviewUrl(uuid, "image", step);
}
