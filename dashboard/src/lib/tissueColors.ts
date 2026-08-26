/** Neutral RGBA helpers for mask overlays (no technique-specific palette). */

export type Rgba = readonly [number, number, number, number];

/** Unknown / unlabeled class — translucent slate. */
export const UNKNOWN_CLASS_RGBA: Rgba = [148, 163, 184, 180];

/** Transparent (e.g. background with no overlay). */
export const TRANSPARENT_RGBA: Rgba = [15, 23, 42, 0];

/** Deterministic pastel-ish color from a class id (not a domain legend). */
export function hashedClassRgba(classId: number): Rgba {
  if (classId === 0) return TRANSPARENT_RGBA;
  const x = Math.imul(classId ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  const r = 80 + (x & 0x7f);
  const g = 80 + ((x >>> 8) & 0x7f);
  const b = 80 + ((x >>> 16) & 0x7f);
  return [r, g, b, 220];
}
