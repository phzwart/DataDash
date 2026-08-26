/**
 * Read/write per-crate user markers on local Tiled node metadata.
 */

import type { CrateColorTag, CrateMarker, CrateStarRating } from "./crateMarkers";
import { getTiledApiKey, getTiledApiUrl } from "./tiledServer";

export const USER_MARKERS_METADATA_KEY = "user_markers";

const MERGE_PATCH = "application/merge-patch+json";

const LEGACY_COLOR_MAP: Record<string, CrateColorTag> = {
  red: "vermillion",
  amber: "orange",
  green: "teal",
  blue: "blue",
  purple: "rose",
};

const VALID_COLORS = new Set<string>([
  "vermillion",
  "orange",
  "teal",
  "blue",
  "rose",
]);

function normalizeColor(raw: unknown): CrateColorTag | null {
  if (typeof raw !== "string") return null;
  if (VALID_COLORS.has(raw)) return raw as CrateColorTag;
  return LEGACY_COLOR_MAP[raw] ?? null;
}

function sortColors(colors: Iterable<CrateColorTag>): CrateColorTag[] {
  const order: Record<CrateColorTag, number> = {
    vermillion: 1,
    orange: 2,
    teal: 3,
    blue: 4,
    rose: 5,
  };
  return [...new Set(colors)].sort((a, b) => order[a] - order[b]);
}

function normalizeColors(raw: unknown): CrateColorTag[] {
  if (!raw || typeof raw !== "object") return [];
  const row = raw as Record<string, unknown>;
  const fromArray = Array.isArray(row.colors)
    ? row.colors.flatMap((c) => {
        const tag = normalizeColor(c);
        return tag ? [tag] : [];
      })
    : [];
  const legacy =
    "color" in row && row.color != null
      ? (() => {
          const tag = normalizeColor(row.color);
          return tag ? [tag] : [];
        })()
      : [];
  return sortColors([...fromArray, ...legacy]);
}

export function parseUserMarkers(
  metadata: Record<string, unknown> | undefined | null,
): CrateMarker {
  const raw = metadata?.[USER_MARKERS_METADATA_KEY];
  if (!raw || typeof raw !== "object") {
    return { stars: 0, colors: [] };
  }
  const row = raw as Record<string, unknown>;
  const stars = Number(row.stars);
  return {
    stars: stars >= 1 && stars <= 4 ? (stars as CrateStarRating) : 0,
    colors: normalizeColors(row),
  };
}

export function markerIsEmpty(marker: CrateMarker): boolean {
  return marker.stars === 0 && marker.colors.length === 0;
}

export async function patchCrateUserMarkers(
  crateId: string,
  marker: CrateMarker,
): Promise<void> {
  const apiUrl = getTiledApiUrl();
  const apiKey = getTiledApiKey();
  const path = `crates/${crateId}`.replace(/^\/+/, "");
  const metadataPayload = markerIsEmpty(marker)
    ? { [USER_MARKERS_METADATA_KEY]: null }
    : {
        [USER_MARKERS_METADATA_KEY]: {
          stars: marker.stars,
          colors: marker.colors,
        },
      };

  const res = await fetch(`${apiUrl}/metadata/${path}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(apiKey ? { Authorization: `Apikey ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      "content-type": MERGE_PATCH,
      metadata: metadataPayload,
      specs: null,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Failed to save markers for ${crateId}: HTTP ${res.status}${detail ? ` — ${detail}` : ""}`,
    );
  }
}
