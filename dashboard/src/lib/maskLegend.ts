import type { CrateMetadata } from "./tiledCrates";
import type { ClassMaskBinding, ParsedSchema } from "./schema";
import {
  UNKNOWN_CLASS_RGBA,
  hashedClassRgba,
  type Rgba,
} from "./tissueColors";

export type MaskLegendEntry = {
  classId: number;
  key: string;
  title: string;
  description?: string;
  color: Rgba;
  /** Source of this entry's color/label. */
  source: "schema" | "crate" | "fallback";
  /** True when color came from crate display_color or dashboard override. */
  hasExplicitColor?: boolean;
};

export type MaskLegend = {
  enumName: string;
  bindingId?: string;
  entries: MaskLegendEntry[];
  byId: Map<number, MaskLegendEntry>;
  /** True when schema legend exists and crate rows agree on id↔key. */
  consistent: boolean;
  issues: string[];
};

type EnumPv = {
  description?: string;
  annotations?: Record<string, unknown> | null;
};

type LegendSlots = {
  id: string;
  key: string;
  name: string;
  color: string;
  legendSlot?: string;
};

/** Technique-agnostic defaults when a binding omits slot names. */
const DEFAULT_SLOTS: LegendSlots = {
  id: "label_id",
  key: "label_key",
  name: "label_name",
  color: "display_color",
};

export function slotsFromBinding(
  binding?: ClassMaskBinding | null,
): LegendSlots {
  if (!binding) {
    return { ...DEFAULT_SLOTS };
  }
  return {
    id: binding.label_id_slot ?? DEFAULT_SLOTS.id,
    key: binding.label_key_slot ?? DEFAULT_SLOTS.key,
    name: binding.label_name_slot ?? DEFAULT_SLOTS.name,
    color: binding.color_slot ?? DEFAULT_SLOTS.color,
    legendSlot: binding.legend_slot,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Parse #RRGGBB, #RRGGBBAA, or rgb()/rgba() into RGBA 0–255. */
export function parseColorToRgba(
  raw: unknown,
  fallback: Rgba = UNKNOWN_CLASS_RGBA,
): Rgba {
  if (typeof raw !== "string") return fallback;
  const s = raw.trim();
  const hex = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s);
  if (hex) {
    const n = hex[1];
    const a = hex[2] ? parseInt(hex[2], 16) : 255;
    return [
      parseInt(n.slice(0, 2), 16),
      parseInt(n.slice(2, 4), 16),
      parseInt(n.slice(4, 6), 16),
      a,
    ];
  }
  const rgba =
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([0-9.]+))?\s*\)$/i.exec(
      s,
    );
  if (rgba) {
    const a =
      rgba[4] != null
        ? Math.round(
            Number(rgba[4]) <= 1 ? Number(rgba[4]) * 255 : Number(rgba[4]),
          )
        : 255;
    return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), a];
  }
  return fallback;
}

function annNumber(
  ann: Record<string, unknown>,
  key: string,
): number | null {
  const v = ann[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function annString(
  ann: Record<string, unknown>,
  key: string,
): string | undefined {
  const v = ann[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

export function legendFromSchemaEnum(
  schema: ParsedSchema,
  enumName: string,
): MaskLegendEntry[] {
  const enm = schema.enums[enumName];
  const pvs = enm?.permissible_values;
  if (!pvs) return [];

  const out: MaskLegendEntry[] = [];
  for (const [key, raw] of Object.entries(pvs)) {
    const pv = (raw ?? {}) as EnumPv;
    const ann = asRecord(pv.annotations);
    const classId = annNumber(ann, "class_id");
    if (classId == null) continue;
    const fallbackColor = hashedClassRgba(classId);
    const title = annString(ann, "title") ?? pv.description ?? key;
    out.push({
      classId,
      key,
      title,
      description: pv.description,
      color: parseColorToRgba(ann.color ?? ann.display_color, fallbackColor),
      source: "schema",
      hasExplicitColor: Boolean(ann.color ?? ann.display_color),
    });
  }
  return out.sort((a, b) => a.classId - b.classId);
}

function legendFromCrateRows(
  meta: CrateMetadata,
  slots: LegendSlots,
): MaskLegendEntry[] {
  const slotName = slots.legendSlot;
  if (!slotName) return [];
  const rich = meta[slotName];
  if (!Array.isArray(rich)) return [];
  const out: MaskLegendEntry[] = [];
  for (const row of rich) {
    const r = asRecord(row);
    const idRaw = r[slots.id];
    const classId = typeof idRaw === "number" ? idRaw : null;
    if (classId == null) continue;
    const key = String(r[slots.key] ?? `class_${classId}`);
    const title = String(r[slots.name] ?? key);
    const fallback = hashedClassRgba(classId);
    const colorRaw = r[slots.color];
    const hasColor = typeof colorRaw === "string" && colorRaw.trim() !== "";
    out.push({
      classId,
      key,
      title,
      description:
        typeof r.description === "string" ? r.description : undefined,
      color: hasColor ? parseColorToRgba(colorRaw, fallback) : fallback,
      source: "crate",
      hasExplicitColor: hasColor,
    });
  }
  return out.sort((a, b) => a.classId - b.classId);
}

/**
 * Resolve display legend from a ClassMaskBinding (schema relation):
 * enum vocabulary + optional per-record legend_slot rows, checked for
 * id↔key consistency against observed mask values.
 */
export function resolveMaskLegend(opts: {
  schema?: ParsedSchema | null;
  meta?: CrateMetadata | null;
  binding?: ClassMaskBinding | null;
  enumName?: string;
  /** Class IDs actually present in the loaded mask preview (optional). */
  observedIds?: number[];
  /** Facility color overrides: class_id or key → hex. */
  colorOverrides?: Record<string, string>;
}): MaskLegend {
  const binding = opts.binding ?? null;
  const slots = slotsFromBinding(binding);
  const enumName =
    opts.enumName ??
    binding?.legend_enum ??
    opts.schema?.arrayBindings.class_masks[0]?.legend_enum ??
    "";
  const issues: string[] = [];
  const schemaEntries =
    opts.schema && enumName
      ? legendFromSchemaEnum(opts.schema, enumName)
      : [];
  const crateEntries = opts.meta
    ? legendFromCrateRows(opts.meta, slots)
    : [];

  if (schemaEntries.length === 0 && crateEntries.length === 0) {
    return {
      enumName: enumName || "(none)",
      bindingId: binding?.id,
      entries: [],
      byId: new Map(),
      consistent: false,
      issues: [
        "No schema legend_enum entries or crate legend_slot rows found for ClassMaskBinding",
      ],
    };
  }

  const byId = new Map<number, MaskLegendEntry>();
  for (const e of schemaEntries) byId.set(e.classId, { ...e });

  for (const c of crateEntries) {
    const existing = byId.get(c.classId);
    if (!existing) {
      if (schemaEntries.length > 0) {
        issues.push(
          `Crate class id ${c.classId} (${c.key}) not in schema ${enumName}`,
        );
      }
      byId.set(c.classId, c);
      continue;
    }
    if (existing.key !== c.key) {
      issues.push(
        `Class id ${c.classId}: schema key "${existing.key}" ≠ crate key "${c.key}"`,
      );
    }
    byId.set(c.classId, {
      ...existing,
      title: existing.title || c.title,
      description: c.description ?? existing.description,
      color: c.hasExplicitColor ? c.color : existing.color,
      hasExplicitColor: c.hasExplicitColor || existing.hasExplicitColor,
      source: existing.source,
    });
  }

  if (opts.colorOverrides) {
    for (const [k, hex] of Object.entries(opts.colorOverrides)) {
      const asId = Number(k);
      if (Number.isFinite(asId) && byId.has(asId)) {
        const e = byId.get(asId)!;
        byId.set(asId, { ...e, color: parseColorToRgba(hex, e.color) });
        continue;
      }
      for (const [id, e] of byId) {
        if (e.key === k) {
          byId.set(id, { ...e, color: parseColorToRgba(hex, e.color) });
        }
      }
    }
  }

  if (opts.observedIds) {
    for (const id of opts.observedIds) {
      if (!byId.has(id)) {
        issues.push(`Mask contains class id ${id} with no legend entry`);
        byId.set(id, {
          classId: id,
          key: `class_${id}`,
          title: `Class ${id}`,
          color: hashedClassRgba(id),
          source: "fallback",
        });
      }
    }
  }

  const unexpected = opts.meta?.unexpected_mask_values;
  if (Array.isArray(unexpected) && unexpected.length > 0) {
    issues.push(
      `Crate reports unexpected_mask_values: ${unexpected.join(", ")}`,
    );
  }

  const entries = [...byId.values()].sort((a, b) => a.classId - b.classId);
  const consistent =
    schemaEntries.length > 0 &&
    issues.length === 0 &&
    (crateEntries.length === 0 ||
      crateEntries.every((c) => {
        const s = schemaEntries.find((e) => e.classId === c.classId);
        return s != null && s.key === c.key;
      }));

  return {
    enumName: enumName || "(none)",
    bindingId: binding?.id,
    entries,
    byId,
    consistent,
    issues,
  };
}

export function legendColorFn(
  legend: MaskLegend,
): (classId: number) => Rgba {
  return (classId: number) =>
    legend.byId.get(classId)?.color ??
    hashedClassRgba(classId) ??
    UNKNOWN_CLASS_RGBA;
}
