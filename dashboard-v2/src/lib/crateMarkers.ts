/** Per-crate user markers (stars + color tags) for overview / plots. */

import {
  markerIsEmpty,
  parseUserMarkers,
  patchCrateUserMarkers,
} from "./tiledMarkers";

const LEGACY_STORAGE_KEY = "lambda_v2.crate_markers";
const CHANGE_EVENT = "lambda-v2-crate-markers-changed";

export type CrateStarRating = 0 | 1 | 2 | 3 | 4;

/** Okabe–Ito–inspired ids (distinct for common color-vision deficiencies). */
export type CrateColorTag =
  | "vermillion"
  | "orange"
  | "teal"
  | "blue"
  | "rose";

export type CrateColorTagFilter = CrateColorTag | "none" | "any";

export type CrateMarker = {
  stars: CrateStarRating;
  colors: CrateColorTag[];
};

export type CrateMarkerStore = Record<string, CrateMarker>;

export type ColorTagOption = {
  id: CrateColorTag | null;
  label: string;
  /** Accessible name for filters / tooltips. */
  shortLabel: string;
  hex: string;
};

/** https://jfly.uni-koeln.de/color/ — plus gray for “clear”. */
export const COLOR_TAG_OPTIONS: ReadonlyArray<ColorTagOption> = [
  { id: null, label: "Clear tags", shortLabel: "None", hex: "#64748b" },
  {
    id: "vermillion",
    label: "Vermillion",
    shortLabel: "Vermillion",
    hex: "#D55E00",
  },
  { id: "orange", label: "Orange", shortLabel: "Orange", hex: "#E69F00" },
  { id: "teal", label: "Teal", shortLabel: "Teal", hex: "#009E73" },
  { id: "blue", label: "Blue", shortLabel: "Blue", hex: "#0072B2" },
  { id: "rose", label: "Rose", shortLabel: "Rose", hex: "#CC79A7" },
] as const;

export const COLOR_TAG_HEX: Record<CrateColorTag, string> = {
  vermillion: "#D55E00",
  orange: "#E69F00",
  teal: "#009E73",
  blue: "#0072B2",
  rose: "#CC79A7",
};

export const COLOR_TAG_SORT_ORDER: Record<CrateColorTag, number> = {
  vermillion: 1,
  orange: 2,
  teal: 3,
  blue: 4,
  rose: 5,
};

/** Selected tags are solid; unselected are 25% transparent (75% opaque). */
export function colorTagFill(hex: string, selected: boolean): string {
  const alpha = selected ? 1 : 0.75;
  const raw = hex.replace("#", "");
  if (raw.length !== 6) return hex;
  const r = Number.parseInt(raw.slice(0, 2), 16);
  const g = Number.parseInt(raw.slice(2, 4), 16);
  const b = Number.parseInt(raw.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const EMPTY_MARKER: CrateMarker = { stars: 0, colors: [] };

const memoryStore = new Map<string, CrateMarker>();
let legacyMigrationDone = false;

function notify(): void {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function storeToRecord(): CrateMarkerStore {
  const out: CrateMarkerStore = {};
  for (const [id, marker] of memoryStore) {
    if (!markerIsEmpty(marker)) out[id] = marker;
  }
  return out;
}

function setMemoryMarker(crateId: string, marker: CrateMarker): void {
  if (markerIsEmpty(marker)) memoryStore.delete(crateId);
  else memoryStore.set(crateId, marker);
}

function persistMarker(crateId: string, marker: CrateMarker, previous: CrateMarker): void {
  void patchCrateUserMarkers(crateId, marker).catch((err) => {
    console.error(err);
    setMemoryMarker(crateId, previous);
    notify();
  });
}

function commitMarker(crateId: string, marker: CrateMarker): void {
  const previous = memoryStore.get(crateId) ?? EMPTY_MARKER;
  setMemoryMarker(crateId, marker);
  notify();
  persistMarker(crateId, marker, previous);
}

const LEGACY_COLOR_MAP: Record<string, CrateColorTag> = {
  red: "vermillion",
  amber: "orange",
  green: "teal",
  blue: "blue",
  purple: "rose",
};

function normalizeLegacyColor(raw: unknown): CrateColorTag | null {
  if (typeof raw !== "string") return null;
  if (raw in COLOR_TAG_HEX) return raw as CrateColorTag;
  return LEGACY_COLOR_MAP[raw] ?? null;
}

function readLegacyLocalStorage(): CrateMarkerStore {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: CrateMarkerStore = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const row = value as Record<string, unknown>;
      const stars = Number(row.stars);
      const colors = Array.isArray(row.colors)
        ? row.colors.flatMap((c) => {
            const tag = normalizeLegacyColor(c);
            return tag ? [tag] : [];
          })
        : [];
      const legacyColor = normalizeLegacyColor(row.color);
      const merged = sortColors([
        ...colors,
        ...(legacyColor ? [legacyColor] : []),
      ]);
      const marker: CrateMarker = {
        stars: stars >= 1 && stars <= 4 ? (stars as CrateStarRating) : 0,
        colors: merged,
      };
      if (!markerIsEmpty(marker)) out[id] = marker;
    }
    return out;
  } catch {
    return {};
  }
}

function sortColors(colors: Iterable<CrateColorTag>): CrateColorTag[] {
  return [...new Set(colors)].sort(
    (a, b) => COLOR_TAG_SORT_ORDER[a] - COLOR_TAG_SORT_ORDER[b],
  );
}

async function migrateLegacyLocalStorage(knownIds: Set<string>): Promise<void> {
  if (legacyMigrationDone) return;
  legacyMigrationDone = true;

  const legacy = readLegacyLocalStorage();
  const ids = Object.keys(legacy);
  if (ids.length === 0) return;

  const tasks: Promise<void>[] = [];
  for (const id of ids) {
    if (!knownIds.has(id)) continue;
    const marker = legacy[id];
    const current = memoryStore.get(id) ?? EMPTY_MARKER;
    const merged: CrateMarker = {
      stars: Math.max(current.stars, marker.stars) as CrateStarRating,
      colors: sortColors([...current.colors, ...marker.colors]),
    };
    if (!markerIsEmpty(merged)) {
      memoryStore.set(id, merged);
      tasks.push(patchCrateUserMarkers(id, merged));
    }
  }

  if (tasks.length > 0) {
    await Promise.allSettled(tasks);
    notify();
  }

  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Hydrate in-memory markers from Tiled crate metadata. */
export function syncMarkerStoreFromCrates(
  crates: { id: string; metadata: Record<string, unknown> }[],
): void {
  const knownIds = new Set<string>();
  for (const crate of crates) {
    knownIds.add(crate.id);
    const parsed = parseUserMarkers(crate.metadata);
    if (markerIsEmpty(parsed)) memoryStore.delete(crate.id);
    else memoryStore.set(crate.id, parsed);
  }
  notify();
  void migrateLegacyLocalStorage(knownIds);
}

export function getCrateMarker(crateId: string): CrateMarker {
  return memoryStore.get(crateId) ?? EMPTY_MARKER;
}

export function getCrateMarkerStore(): CrateMarkerStore {
  return storeToRecord();
}

export function setCrateStars(crateId: string, stars: CrateStarRating): void {
  const prev = memoryStore.get(crateId) ?? EMPTY_MARKER;
  commitMarker(crateId, { ...prev, stars });
}

export function toggleCrateColorTag(
  crateId: string,
  color: CrateColorTag,
): void {
  const prev = memoryStore.get(crateId) ?? EMPTY_MARKER;
  const has = prev.colors.includes(color);
  const colors = has
    ? prev.colors.filter((c) => c !== color)
    : sortColors([...prev.colors, color]);
  commitMarker(crateId, { ...prev, colors });
}

export function clearCrateColorTags(crateId: string): void {
  const prev = memoryStore.get(crateId) ?? EMPTY_MARKER;
  commitMarker(crateId, { ...prev, colors: [] });
}

export function crateHasColorTag(
  marker: CrateMarker,
  color: CrateColorTag,
): boolean {
  return marker.colors.includes(color);
}

export function primaryColorSortOrder(marker: CrateMarker): number {
  if (marker.colors.length === 0) return 99;
  return Math.min(...marker.colors.map((c) => COLOR_TAG_SORT_ORDER[c]));
}

export function subscribeCrateMarkers(listener: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, listener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
  };
}

export type MarkerSortMode = "default" | "stars" | "color";

export function compareCratesByMarkers(
  aId: string,
  bId: string,
  store: CrateMarkerStore,
  mode: MarkerSortMode,
): number {
  if (mode === "default") return 0;
  const a = store[aId] ?? EMPTY_MARKER;
  const b = store[bId] ?? EMPTY_MARKER;
  if (mode === "stars") {
    if (b.stars !== a.stars) return b.stars - a.stars;
    return primaryColorSortOrder(a) - primaryColorSortOrder(b);
  }
  const ac = primaryColorSortOrder(a);
  const bc = primaryColorSortOrder(b);
  if (ac !== bc) return ac - bc;
  return b.stars - a.stars;
}

export function filterCratesByMarkers<T extends { id: string }>(
  crates: T[],
  filters: {
    minStars?: CrateStarRating;
    colorTag?: CrateColorTagFilter;
  },
  store: CrateMarkerStore = getCrateMarkerStore(),
): T[] {
  const minStars = filters.minStars ?? 0;
  const colorTag = filters.colorTag ?? "any";
  return crates.filter((c) => {
    const m = store[c.id] ?? EMPTY_MARKER;
    if (m.stars < minStars) return false;
    if (colorTag === "any") return true;
    if (colorTag === "none") return m.colors.length === 0;
    return m.colors.includes(colorTag);
  });
}

export { LEGACY_STORAGE_KEY as STORAGE_KEY, CHANGE_EVENT };
