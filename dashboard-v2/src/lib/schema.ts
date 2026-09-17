import { load as loadYaml } from "js-yaml";
import type {
  AgentDisplaySpec,
  AgentResultViewSpec,
  DisplayModuleSpec,
  DisplaySummaryItem,
  DisplayTableColumn,
} from "./displayModule";
import { normalizeAgentDisplay } from "./displayModule";
import { getTiledOrigin, resolveAgainstTiledOrigin } from "./tiledServer";

export type LinkmlSlot = {
  range?: string;
  title?: string;
  description?: string;
  multivalued?: boolean;
  identifier?: boolean;
  pattern?: string;
  minimum_value?: number;
  maximum_value?: number;
  inlined_as_list?: boolean;
};

export type DashboardSection = {
  id: string;
  title: string;
  slots: string[];
  /** Span two columns on wide layouts. */
  wide?: boolean;
};

/** One fact line on a crate card: metadata slot + optional display label. */
export type GalleryFactSpec = {
  slot: string;
  /** Short label (e.g. d_min). Falls back to LinkML / slot name when fact_labels. */
  label?: string;
};

/** List/gallery card layout; omitted fields fall back to hero.*. */
export type GalleryConfig = {
  title?: string;
  subtitle?: string;
  badges?: string[];
  /** Slot names or { slot, label } objects. */
  facts?: Array<string | GalleryFactSpec>;
  /**
   * Compact single-line summary under title/badge (e.g. unit-cell a,b,c,angles).
   */
  cell_line?: Array<string | GalleryFactSpec>;
  search_slots?: string[];
  /**
   * Card arrangement: `tile` = auto-fill grid (dynamic columns),
   * `list` = single column.
   */
  layout?: "tile" | "list";
  /**
   * Minimum card width for `tile` layout (CSS length, e.g. "11rem", "180px").
   * Controls how many cards fit per row.
   */
  card_min_width?: string;
  /** Show truncated crate UUID under the title. Default true. */
  show_id?: boolean;
  /** Compact = tighter padding / smaller type. Default cozy. */
  density?: "compact" | "cozy";
  /** Show labels beside fact values. Default true. */
  fact_labels?: boolean;
};

export type ResolvedGallery = {
  title: string;
  subtitle?: string;
  badges: string[];
  facts: GalleryFactSpec[];
  cell_line: GalleryFactSpec[];
  search_slots: string[];
  layout: "tile" | "list";
  card_min_width: string;
  show_id: boolean;
  density: "compact" | "cozy";
  fact_labels: boolean;
};

/** Panel sizing for an expanded plot (facility-tunable). */
export type PlotLayoutSpec = {
  /** Fraction of content width (0–1). Default 0.72 */
  width_fraction?: number;
  /** Plot width / height. Default 1.6 */
  aspect_ratio?: number;
};

export type HistogramPlotSpec = PlotLayoutSpec & {
  slot?: string;
  path?: string;
  /** Arithmetic expression over metadata fields, e.g. "1 - tissue_fractions.background". */
  expr?: string;
  group_by?: string;
  title?: string;
};

export type ScatterPlotSpec = PlotLayoutSpec & {
  /** Field path or arithmetic expression. */
  x: string;
  /** Field path or arithmetic expression. */
  y: string;
  color?: string;
  title?: string;
};

export type CategoricalPlotSpec = PlotLayoutSpec & {
  slot: string;
  title?: string;
};

/** Metadata table panel inside a plot row. */
export type TablePlotSpec = PlotLayoutSpec & {
  title?: string;
  /** Metadata slots → columns (left to right). */
  columns: string[];
};

export type VegaSelectionBinding = {
  signal?: string;
  id_field?: string;
  /** Selection interaction. Default: lasso for point charts, interval otherwise. */
  mode?: "lasso" | "interval" | "point";
  /** For interval brushes: metadata field to filter when signal keys are opaque. */
  range_field?: string;
};

export type VegaPlotSpec = PlotLayoutSpec & {
  title?: string;
  spec?: Record<string, unknown>;
  spec_uri?: string;
  selection?: VegaSelectionBinding;
};

export type ThreeUnitCellFields = {
  a?: string;
  b?: string;
  c?: string;
  alpha?: string;
  beta?: string;
  gamma?: string;
  label?: string;
  color?: string;
};

export type ThreePlotSpec = PlotLayoutSpec & {
  title?: string;
  tool: "unit_cell_lattice";
  fields?: ThreeUnitCellFields;
};

export type PlotRowPanel =
  | ({ type: "table" } & TablePlotSpec)
  | ({ type: "vega" } & VegaPlotSpec)
  | ({ type: "three" } & ThreePlotSpec)
  | ({ type: "scatter" } & ScatterPlotSpec)
  | ({ type: "histogram" } & HistogramPlotSpec)
  | ({ type: "categorical" } & CategoricalPlotSpec);

/** Always-visible horizontal band of panels (table + plots). */
export type PlotRowSpec = {
  id?: string;
  title?: string;
  panels: PlotRowPanel[];
};

export type PlotsConfig = {
  /** Defaults applied to every plot unless overridden per entry. */
  defaults?: PlotLayoutSpec;
  /** Side-by-side rows rendered above the accordion list. */
  rows?: PlotRowSpec[];
  /** Explicit Vega-Lite charts in the accordion (optional). */
  vega?: VegaPlotSpec[];
  histograms?: HistogramPlotSpec[];
  scatter?: ScatterPlotSpec[];
  categorical?: CategoricalPlotSpec[];
};

export type ResolvedPlotLayout = {
  widthFraction: number;
  aspectRatio: number;
};

/** How to pick one entry from a sidecar array (e.g. shell_tables). */
export type CrateDataMatch = {
  field: string;
  /** Substring match (case-sensitive). */
  contains?: string;
  /** Exact string equality. */
  equals?: string;
};

/**
 * Portable data binding for a per-crate plot panel.
 * `from: sidecar` walks JSON; `from: metadata` uses Tiled metadata (single-row).
 */
export type CratePlotDataSpec = {
  from: "sidecar" | "metadata";
  /** Dotted path into the source document (e.g. shell_tables). */
  path?: string;
  /** When path resolves to an array of objects, pick one entry. */
  match?: CrateDataMatch;
  /** Path under the matched entry to the row array (default: rows). */
  rows?: string;
  /** Coerce these fields to numbers for Vega quantitative encodings. */
  number_fields?: string[];
};

export type CrateVegaPanelSpec = PlotLayoutSpec & {
  type: "vega";
  title?: string;
  data: CratePlotDataSpec;
  spec?: Record<string, unknown>;
  spec_uri?: string;
};

export type CratePlotPanelSpec = CrateVegaPanelSpec;

export type CratePlotsConfig = {
  defaults?: PlotLayoutSpec;
  panels: CratePlotPanelSpec[];
};

/** Compact metrics table under the crate preview plot (not sections MetaRow). */
export type CrateMetricsConfig = {
  title?: string;
  /** Metadata slot names shown as adjacent label|value rows. */
  items: string[];
};

/**
 * Crate detail "Actions" tab — jobs from agent_server whose inputs reference
 * this crate. Presentation of each agent's output is declared under `agents`.
 */
export type CrateActionsConfig = {
  enabled: boolean;
  title?: string;
  /** Global fallback when an agent has no `agents` entry. */
  result_files?: string[];
  /** Per-agent result presentation (key = agent_uuid). */
  agents?: Record<string, AgentDisplaySpec>;
};

/** Per-crate detail column: sidecar plots + compact metrics + optional tabs. */
export type CrateDashboardConfig = {
  plots?: CratePlotsConfig;
  metrics?: CrateMetricsConfig;
  actions?: CrateActionsConfig;
};

export function resolvePlotLayout(
  defaults: PlotLayoutSpec | undefined,
  spec: PlotLayoutSpec | undefined,
): ResolvedPlotLayout {
  const widthFraction = clampFraction(
    spec?.width_fraction ?? defaults?.width_fraction ?? 1,
    0.5,
  );
  const aspectRatio = Math.max(
    0.5,
    spec?.aspect_ratio ?? defaults?.aspect_ratio ?? 1.4,
  );
  return { widthFraction, aspectRatio };
}

function clampFraction(n: number, min = 0.5): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(1, Math.max(min, n));
}

/** Row panels may be narrower than accordion plots (down to ~12%). */
export function resolveRowPanelLayout(
  defaults: PlotLayoutSpec | undefined,
  spec: PlotLayoutSpec | undefined,
  fallbackFraction = 0.25,
): ResolvedPlotLayout {
  const widthFraction = clampFraction(
    spec?.width_fraction ?? defaults?.width_fraction ?? fallbackFraction,
    0.12,
  );
  const aspectRatio = Math.max(
    0.5,
    spec?.aspect_ratio ?? defaults?.aspect_ratio ?? 1,
  );
  return { widthFraction, aspectRatio };
}

/** Array asset to pull from Tiled for a cart export profile. */
export type ExportAssetSpec = {
  /** Tiled child under crates/{uuid}/ (e.g. image, mask). */
  child: string;
  /** Wire format: png | tiff | npy | raw. */
  format: string;
  /** Directory inside the ZIP (default "arrays"). */
  dir?: string;
};

export type ExportNamingSpec = {
  /** Filename stem with {slot} placeholders, e.g. "{petiole_label}_s{slice_index}". */
  pattern: string;
};

export type ExportManifestSpec = {
  filename?: string;
  /** Metadata slots copied into each crate's manifest entry. */
  slots: string[];
};

/** One selectable export recipe from dashboard YAML. */
export type ExportProfile = {
  id: string;
  title: string;
  description?: string;
  assets: ExportAssetSpec[];
  naming?: ExportNamingSpec;
  manifest?: ExportManifestSpec;
};

export type ExportConfig = {
  profiles: ExportProfile[];
};

/** Facility dashboard YAML (layout + plots + link to LinkML). */
export type DashboardConfig = {
  id?: string;
  title?: string;
  description?: string;
  schema_uri: string;
  record_class: string;
  tissue_class?: string;
  hero: {
    title: string;
    subtitle?: string;
    badges?: string[];
    facts?: string[];
  };
  /** Gallery / cart / selection cards. Falls back to hero when omitted. */
  gallery?: GalleryConfig;
  preview?: {
    image_child?: string;
    mask_child?: string;
    /** Source edge / preview edge (higher = smaller preview). */
    stride?: number;
    /** Viewer column width as fraction of viewport (default 0.25). */
    width_fraction?: number;
    /** Fetch denser than display before Gaussian/majority downsample. */
    oversample?: number;
    /** Overlay semantic mask on the image when the mask child exists. */
    mask_overlay?: boolean;
    /** Overlay opacity 0–1. */
    mask_opacity?: number;
    /** LinkML enum that defines the mask class legend. */
    mask_legend_enum?: string;
    /** Optional color overrides keyed by class_id or label key. */
    mask_colors?: Record<string, string>;
    series_group_key?: string;
    series_index_key?: string;
  };
  sections: DashboardSection[];
  /** Per-crate detail column (sidecar plots + compact metrics). */
  crate?: CrateDashboardConfig;
  plots?: PlotsConfig;
  export?: ExportConfig;
};

/** Declared array↔mask↔legend relation from schema annotations.tomocrate_bindings. */
export type ClassMaskBinding = {
  id?: string;
  primary_child: string;
  mask_child: string;
  legend_enum?: string;
  legend_slot?: string;
  label_id_slot?: string;
  label_key_slot?: string;
  label_name_slot?: string;
  color_slot?: string;
};

export type InstanceAnnotationBinding = {
  id?: string;
  primary_child: string;
  objects_slot: string;
  legend_enum?: string;
  legend_slot?: string;
  label_id_slot?: string;
  label_key_slot?: string;
  label_name_slot?: string;
  color_slot?: string;
};

export type ArrayAnnotationBindings = {
  class_masks: ClassMaskBinding[];
  instance_annotations: InstanceAnnotationBinding[];
};

/** Master LinkML schema (data contract only). */
export type ParsedSchema = {
  id?: string;
  name?: string;
  title?: string;
  description?: string;
  classes: Record<string, { description?: string; slots?: string[] }>;
  slots: Record<string, LinkmlSlot>;
  enums: Record<
    string,
    {
      description?: string;
      permissible_values?: Record<
        string,
        {
          description?: string;
          annotations?: Record<string, unknown> | null;
        } | null
      >;
    }
  >;
  /** Raw schema annotations block (includes tomocrate_bindings). */
  annotations?: Record<string, unknown>;
  /** Parsed array↔mask / instance relations (technique-agnostic). */
  arrayBindings: ArrayAnnotationBindings;
};

/**
 * Default dashboard URI from env, else the Lambda MX dashboard YAML on the active Tiled origin.
 * Facilities should set VITE_DASHBOARD_URI or pick a URL in Setup.
 */
export function defaultDashboardUri(): string {
  return (
    import.meta.env.VITE_DASHBOARD_URI ??
    `${getTiledOrigin()}/schemas/lambda_mx_dashboard.yaml`
  );
}

/** @deprecated Prefer defaultDashboardUri() so the live Tiled origin is used. */
export const DEFAULT_DASHBOARD_URI = defaultDashboardUri();

function humanize(slotName: string): string {
  return slotName
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

async function fetchYaml(uri: string): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(uri, { cache: "no-store" });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to fetch ${uri} (${detail}). Is the Tiled/client_store server up, and (in dev) is Vite proxying /schemas?`,
    );
  }
  if (!res.ok) {
    throw new Error(`Failed to fetch ${uri} (${res.status})`);
  }
  const doc = loadYaml(await res.text()) as Record<string, unknown>;
  if (!doc || typeof doc !== "object") {
    throw new Error(`YAML at ${uri} did not parse to an object`);
  }
  return doc;
}

function dirnameUri(uri: string): string {
  const i = uri.lastIndexOf("/");
  return i >= 0 ? uri.slice(0, i + 1) : uri;
}

function resolveImportUri(fromUri: string, name: string): string | null {
  if (name.startsWith("linkml:")) return null;
  if (/^https?:\/\//i.test(name)) return name;
  const base = name.endsWith(".yaml") || name.endsWith(".yml") ? name : `${name}.yaml`;
  return `${dirnameUri(fromUri)}${base}`;
}

function mergeSchemaDocs(
  base: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...base,
    classes: {
      ...((incoming.classes as object) ?? {}),
      ...((base.classes as object) ?? {}),
    },
    slots: {
      ...((incoming.slots as object) ?? {}),
      ...((base.slots as object) ?? {}),
    },
    enums: {
      ...((incoming.enums as object) ?? {}),
      ...((base.enums as object) ?? {}),
    },
    annotations: {
      ...((incoming.annotations as object) ?? {}),
      ...((base.annotations as object) ?? {}),
    },
  };
}

function asBindingRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function parseArrayBindings(
  annotations: Record<string, unknown> | undefined,
): ArrayAnnotationBindings {
  const raw = asBindingRecord(annotations?.tomocrate_bindings);
  const classMasks = Array.isArray(raw.class_masks) ? raw.class_masks : [];
  const instances = Array.isArray(raw.instance_annotations)
    ? raw.instance_annotations
    : [];

  return {
    class_masks: classMasks.flatMap((row) => {
      const r = asBindingRecord(row);
      const primary = r.primary_child;
      const mask = r.mask_child;
      if (typeof primary !== "string" || typeof mask !== "string") return [];
      const binding: ClassMaskBinding = {
        id: typeof r.id === "string" ? r.id : undefined,
        primary_child: primary,
        mask_child: mask,
        legend_enum:
          typeof r.legend_enum === "string" ? r.legend_enum : undefined,
        legend_slot:
          typeof r.legend_slot === "string" ? r.legend_slot : undefined,
        label_id_slot:
          typeof r.label_id_slot === "string" ? r.label_id_slot : undefined,
        label_key_slot:
          typeof r.label_key_slot === "string" ? r.label_key_slot : undefined,
        label_name_slot:
          typeof r.label_name_slot === "string" ? r.label_name_slot : undefined,
        color_slot:
          typeof r.color_slot === "string" ? r.color_slot : undefined,
      };
      return [binding];
    }),
    instance_annotations: instances.flatMap((row) => {
      const r = asBindingRecord(row);
      const primary = r.primary_child;
      const objects = r.objects_slot;
      if (typeof primary !== "string" || typeof objects !== "string") return [];
      const binding: InstanceAnnotationBinding = {
        id: typeof r.id === "string" ? r.id : undefined,
        primary_child: primary,
        objects_slot: objects,
        legend_enum:
          typeof r.legend_enum === "string" ? r.legend_enum : undefined,
        legend_slot:
          typeof r.legend_slot === "string" ? r.legend_slot : undefined,
        label_id_slot:
          typeof r.label_id_slot === "string" ? r.label_id_slot : undefined,
        label_key_slot:
          typeof r.label_key_slot === "string" ? r.label_key_slot : undefined,
        label_name_slot:
          typeof r.label_name_slot === "string" ? r.label_name_slot : undefined,
        color_slot:
          typeof r.color_slot === "string" ? r.color_slot : undefined,
      };
      return [binding];
    }),
  };
}

/** First class-mask binding, if the schema declares any. */
export function primaryClassMaskBinding(
  schema: ParsedSchema | null | undefined,
): ClassMaskBinding | null {
  return schema?.arrayBindings.class_masks[0] ?? null;
}


export async function fetchDashboardConfig(
  dashboardUri: string,
): Promise<DashboardConfig> {
  const doc = await fetchYaml(resolveAgainstTiledOrigin(dashboardUri));
  const schemaUri = doc.schema_uri;
  if (typeof schemaUri !== "string" || !schemaUri) {
    throw new Error("Dashboard YAML missing schema_uri (link to master LinkML)");
  }
  const sections = parseSections(doc.sections);
  const recordClass = doc.record_class;
  const hero = doc.hero as DashboardConfig["hero"] | undefined;
  if (!sections?.length || typeof recordClass !== "string" || !hero?.title) {
    throw new Error(
      "Dashboard YAML must include record_class, hero.title, and sections",
    );
  }
  return {
    id: typeof doc.id === "string" ? doc.id : undefined,
    title: typeof doc.title === "string" ? doc.title : undefined,
    description:
      typeof doc.description === "string" ? doc.description : undefined,
    schema_uri: resolveAgainstTiledOrigin(schemaUri),
    record_class: recordClass,
    tissue_class:
      typeof doc.tissue_class === "string" ? doc.tissue_class : undefined,
    hero,
    gallery: parseGalleryConfig(doc.gallery),
    preview: doc.preview as DashboardConfig["preview"],
    sections,
    crate: parseCrateConfig(doc.crate),
    plots: doc.plots as PlotsConfig | undefined,
    export: parseExportConfig(doc.export),
  };
}

function parseCrateDataMatch(raw: unknown): CrateDataMatch | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.field !== "string" || !r.field.trim()) return undefined;
  return {
    field: r.field,
    contains: typeof r.contains === "string" ? r.contains : undefined,
    equals: typeof r.equals === "string" ? r.equals : undefined,
  };
}

function parseCratePlotData(raw: unknown): CratePlotDataSpec | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  if (r.from !== "sidecar" && r.from !== "metadata") return undefined;
  const numberFields = Array.isArray(r.number_fields)
    ? r.number_fields.filter((x): x is string => typeof x === "string")
    : undefined;
  return {
    from: r.from,
    path: typeof r.path === "string" ? r.path : undefined,
    match: parseCrateDataMatch(r.match),
    rows: typeof r.rows === "string" ? r.rows : undefined,
    number_fields: numberFields?.length ? numberFields : undefined,
  };
}

function parseDisplayTableColumn(raw: unknown): DisplayTableColumn | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.field !== "string" || typeof r.label !== "string") return undefined;
  const type =
    r.type === "number" || r.type === "string" || r.type === "array"
      ? r.type
      : undefined;
  return {
    field: r.field,
    label: r.label,
    link: typeof r.link === "string" ? r.link : undefined,
    type,
    decimals: typeof r.decimals === "number" ? r.decimals : undefined,
    join: typeof r.join === "string" ? r.join : undefined,
    wrap: r.wrap === true,
  };
}

function parseDisplaySummaryItems(raw: unknown): DisplaySummaryItem[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const items: DisplaySummaryItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const s = item as Record<string, unknown>;
    const from = s.from ?? s.from_path;
    if (typeof from !== "string" || typeof s.label !== "string") continue;
    items.push({
      label: s.label,
      from,
      suffix: typeof s.suffix === "string" ? s.suffix : undefined,
      emphasis: s.emphasis === true,
    });
  }
  return items.length ? items : undefined;
}

function parseDisplayModule(raw: unknown): DisplayModuleSpec | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const kind = r.kind;
  const id = typeof r.id === "string" ? r.id : undefined;
  const title = typeof r.title === "string" ? r.title : undefined;

  if (kind === "summary") {
    const items = parseDisplaySummaryItems(r.items);
    if (!items?.length) return undefined;
    return { kind: "summary", id, title, items };
  }
  if (kind === "table") {
    if (typeof r.rows !== "string" || !r.rows.trim()) return undefined;
    const primitive = r.primitive === "string" ? "string" : undefined;
    const columns = Array.isArray(r.columns)
      ? r.columns
          .map(parseDisplayTableColumn)
          .filter((c): c is NonNullable<typeof c> => c != null)
      : [];
    if (!columns.length && primitive !== "string") return undefined;
    return {
      kind: "table",
      id,
      title,
      rows: r.rows,
      limit: typeof r.limit === "number" ? r.limit : undefined,
      primitive,
      value_label: typeof r.value_label === "string" ? r.value_label : undefined,
      columns,
    };
  }
  if (kind === "row") {
    if (!Array.isArray(r.modules)) return undefined;
    const modules = r.modules
      .map(parseDisplayModule)
      .filter((m): m is NonNullable<typeof m> => m != null);
    if (!modules.length) return undefined;
    return { kind: "row", id, title, modules };
  }
  if (kind === "graph") {
    if (typeof r.from !== "string" || !r.from.trim()) return undefined;
    return {
      kind: "graph",
      id,
      title,
      from: r.from.trim(),
      node_id: typeof r.node_id === "string" ? r.node_id : undefined,
      node_label: typeof r.node_label === "string" ? r.node_label : undefined,
      edges_from: typeof r.edges_from === "string" ? r.edges_from : undefined,
      edges_to: typeof r.edges_to === "string" ? r.edges_to : undefined,
      highlight_field:
        typeof r.highlight_field === "string" ? r.highlight_field : undefined,
    };
  }
  if (kind === "kv") {
    if (typeof r.from !== "string" || !r.from.trim()) return undefined;
    return {
      kind: "kv",
      id,
      title,
      from: r.from.trim(),
      key_label: typeof r.key_label === "string" ? r.key_label : undefined,
      value_label: typeof r.value_label === "string" ? r.value_label : undefined,
      value_decimals:
        typeof r.value_decimals === "number" ? r.value_decimals : undefined,
    };
  }
  if (kind === "image") {
    if (typeof r.file !== "string" && typeof r.from !== "string") return undefined;
    return {
      kind: "image",
      id,
      title,
      file: typeof r.file === "string" ? r.file : undefined,
      from: typeof r.from === "string" ? r.from : undefined,
      alt: typeof r.alt === "string" ? r.alt : undefined,
    };
  }
  if (kind === "json") {
    return {
      kind: "json",
      id,
      title,
      from: typeof r.from === "string" ? r.from : undefined,
    };
  }
  if (kind === "density_popup") {
    const pdb_from = typeof r.pdb_from === "string" ? r.pdb_from : undefined;
    const pdb_file = typeof r.pdb_file === "string" ? r.pdb_file : undefined;
    if (!pdb_from?.trim() && !pdb_file?.trim()) return undefined;
    return {
      kind: "density_popup",
      id,
      title,
      label: typeof r.label === "string" ? r.label : undefined,
      pdb_from,
      pdb_file,
      map_from: typeof r.map_from === "string" ? r.map_from : undefined,
      map_file: typeof r.map_file === "string" ? r.map_file : undefined,
    };
  }
  return undefined;
}

function parseLegacyAgentView(raw: Record<string, unknown>): AgentResultViewSpec | undefined {
  const src =
    raw.view && typeof raw.view === "object" && !Array.isArray(raw.view)
      ? (raw.view as Record<string, unknown>)
      : raw;
  if (typeof src.primary_file !== "string" || !src.primary_file.trim()) {
    return undefined;
  }
  const kind =
    src.kind === "table" || src.kind === "json" || src.kind === "text"
      ? src.kind
      : undefined;
  const summary = parseDisplaySummaryItems(src.summary);
  let table: AgentResultViewSpec["table"];
  if (src.table && typeof src.table === "object" && !Array.isArray(src.table)) {
    const t = src.table as Record<string, unknown>;
    if (typeof t.rows === "string" && t.rows.trim()) {
      const columns = Array.isArray(t.columns)
        ? t.columns
            .map(parseDisplayTableColumn)
            .filter((c): c is NonNullable<typeof c> => c != null)
        : [];
      if (columns.length) {
        table = {
          rows: t.rows,
          limit: typeof t.limit === "number" ? t.limit : undefined,
          columns,
        };
      }
    }
  }
  return {
    primary_file: src.primary_file.trim(),
    kind,
    title: typeof src.title === "string" ? src.title : undefined,
    summary,
    table,
  };
}

function parseAgentDisplayEntry(raw: unknown): AgentDisplaySpec | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;

  if (r.display && typeof r.display === "object" && !Array.isArray(r.display)) {
    const d = r.display as Record<string, unknown>;
    if (typeof d.primary_file !== "string" || !d.primary_file.trim()) {
      return undefined;
    }
    const modules = Array.isArray(d.modules)
      ? d.modules
          .map(parseDisplayModule)
          .filter((m): m is NonNullable<typeof m> => m != null)
      : [];
    if (!modules.length) return undefined;
    return { primary_file: d.primary_file.trim(), modules };
  }

  return normalizeAgentDisplay(parseLegacyAgentView(r));
}

function parseCrateConfig(raw: unknown): CrateDashboardConfig | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;

  let plots: CratePlotsConfig | undefined;
  if (r.plots && typeof r.plots === "object" && !Array.isArray(r.plots)) {
    const p = r.plots as Record<string, unknown>;
    const panelsRaw = Array.isArray(p.panels) ? p.panels : [];
    const panels = panelsRaw.flatMap((row): CratePlotPanelSpec[] => {
      if (!row || typeof row !== "object" || Array.isArray(row)) return [];
      const panel = row as Record<string, unknown>;
      if (panel.type !== "vega") return [];
      const data = parseCratePlotData(panel.data);
      if (!data) return [];
      return [
        {
          type: "vega",
          title: typeof panel.title === "string" ? panel.title : undefined,
          data,
          spec:
            panel.spec && typeof panel.spec === "object"
              ? (panel.spec as Record<string, unknown>)
              : undefined,
          spec_uri:
            typeof panel.spec_uri === "string" ? panel.spec_uri : undefined,
          width_fraction:
            typeof panel.width_fraction === "number"
              ? panel.width_fraction
              : undefined,
          aspect_ratio:
            typeof panel.aspect_ratio === "number"
              ? panel.aspect_ratio
              : undefined,
        },
      ];
    });
    if (panels.length) {
      plots = {
        defaults:
          p.defaults && typeof p.defaults === "object"
            ? (p.defaults as PlotLayoutSpec)
            : undefined,
        panels,
      };
    }
  }

  let metrics: CrateMetricsConfig | undefined;
  if (r.metrics && typeof r.metrics === "object" && !Array.isArray(r.metrics)) {
    const m = r.metrics as Record<string, unknown>;
    const items = Array.isArray(m.items)
      ? m.items.filter((x): x is string => typeof x === "string")
      : [];
    if (items.length) {
      metrics = {
        title: typeof m.title === "string" ? m.title : undefined,
        items,
      };
    }
  }

  let actions: CrateActionsConfig | undefined;
  if (r.actions && typeof r.actions === "object" && !Array.isArray(r.actions)) {
    const a = r.actions as Record<string, unknown>;
    const enabled = a.enabled !== false;
    const resultFiles = Array.isArray(a.result_files)
      ? a.result_files.filter((x): x is string => typeof x === "string")
      : undefined;
    let agents: Record<string, AgentDisplaySpec> | undefined;
    if (a.agents && typeof a.agents === "object" && !Array.isArray(a.agents)) {
      agents = {};
      for (const [agentUuid, rawView] of Object.entries(
        a.agents as Record<string, unknown>,
      )) {
        const display = parseAgentDisplayEntry(rawView);
        if (display) agents[agentUuid] = display;
      }
      if (!Object.keys(agents).length) agents = undefined;
    }
    actions = {
      enabled,
      title: typeof a.title === "string" ? a.title : undefined,
      result_files: resultFiles?.length ? resultFiles : undefined,
      agents,
    };
  }

  if (!plots && !metrics && !actions) return undefined;
  return { plots, metrics, actions };
}

function parseSections(raw: unknown): DashboardSection[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.flatMap((row): DashboardSection[] => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return [];
    const r = row as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.title !== "string") return [];
    if (!Array.isArray(r.slots)) return [];
    const slots = r.slots.filter((s): s is string => typeof s === "string");
    return [
      {
        id: r.id,
        title: r.title,
        slots,
        wide: r.wide === true,
      },
    ];
  });
}

function parseGalleryFacts(
  raw: unknown,
): Array<string | GalleryFactSpec> | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: Array<string | GalleryFactSpec> = [];
  for (const item of raw) {
    if (typeof item === "string" && item.trim()) {
      out.push(item);
      continue;
    }
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const r = item as Record<string, unknown>;
      if (typeof r.slot === "string" && r.slot.trim()) {
        out.push({
          slot: r.slot.trim(),
          label: typeof r.label === "string" ? r.label : undefined,
        });
      }
    }
  }
  return out.length ? out : undefined;
}

function normalizeGalleryFacts(
  raw: Array<string | GalleryFactSpec> | undefined,
): GalleryFactSpec[] {
  if (!raw?.length) return [];
  return raw.map((item) =>
    typeof item === "string" ? { slot: item } : { slot: item.slot, label: item.label },
  );
}

function parseGalleryConfig(raw: unknown): GalleryConfig | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const strList = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined;
  const layout =
    r.layout === "tile" || r.layout === "list" ? r.layout : undefined;
  const density =
    r.density === "compact" || r.density === "cozy" ? r.density : undefined;
  return {
    title: typeof r.title === "string" ? r.title : undefined,
    subtitle: typeof r.subtitle === "string" ? r.subtitle : undefined,
    badges: strList(r.badges),
    facts: parseGalleryFacts(r.facts),
    cell_line: parseGalleryFacts(r.cell_line),
    search_slots: strList(r.search_slots),
    layout,
    card_min_width:
      typeof r.card_min_width === "string" && r.card_min_width.trim()
        ? r.card_min_width.trim()
        : undefined,
    show_id: typeof r.show_id === "boolean" ? r.show_id : undefined,
    density,
    fact_labels: typeof r.fact_labels === "boolean" ? r.fact_labels : undefined,
  };
}

/** Resolve gallery card fields from gallery.* with hero.* fallbacks. */
export function resolveGallery(dash: DashboardConfig): ResolvedGallery {
  const g = dash.gallery;
  const title = g?.title ?? dash.hero.title;
  // If gallery: is present, do not inherit hero.subtitle (often long / noisy on tiles).
  const subtitle = g ? g.subtitle : dash.hero.subtitle;
  const badges = g?.badges ?? dash.hero.badges ?? [];
  const facts = normalizeGalleryFacts(
    g?.facts ?? (dash.hero.facts as Array<string | GalleryFactSpec> | undefined),
  );
  const cell_line = normalizeGalleryFacts(g?.cell_line);
  const search_slots =
    g?.search_slots ??
    ([
      ...new Set(
        [
          title,
          subtitle,
          ...badges,
          ...facts.map((f) => f.slot),
          ...cell_line.map((f) => f.slot),
        ].filter(Boolean) as string[],
      ),
    ] as string[]);
  return {
    title,
    subtitle,
    badges,
    facts,
    cell_line,
    search_slots,
    layout: g?.layout ?? "tile",
    card_min_width: g?.card_min_width ?? "12rem",
    show_id: g?.show_id ?? true,
    density: g?.density ?? "cozy",
    fact_labels: g?.fact_labels ?? true,
  };
}

/** Built-in gallery when dashboard YAML is unreachable (matches lambda_mx_dashboard.yaml). */
export function defaultMxGallery(): ResolvedGallery {
  return {
    title: "sample_code",
    badges: ["space_group"],
    facts: [
      { slot: "resolution", label: "d_min" },
      { slot: "completeness", label: "completeness" },
    ],
    cell_line: [
      { slot: "unit_cell_a", label: "a" },
      { slot: "unit_cell_b", label: "b" },
      { slot: "unit_cell_c", label: "c" },
      { slot: "unit_cell_alpha", label: "al" },
      { slot: "unit_cell_beta", label: "be" },
      { slot: "unit_cell_gamma", label: "ga" },
    ],
    search_slots: [
      "sample_code",
      "space_group",
      "instrument_code",
      "title",
      "workflow_code",
      "collection_experiment_code",
    ],
    layout: "tile",
    card_min_width: "16rem",
    show_id: true,
    density: "cozy",
    fact_labels: true,
  };
}

/** Scale a CSS length like `16rem` by a factor (e.g. 1.1 = 10% wider cards). */
export function scaleCssLength(length: string, factor: number): string {
  const m = length.trim().match(/^([\d.]+)([a-z%]+)$/i);
  if (!m) return length;
  const n = parseFloat(m[1]) * factor;
  const unit = m[2];
  const rounded = unit === "rem" || unit === "em" ? n.toFixed(1) : String(Math.round(n));
  return `${rounded}${unit}`;
}

/** CSS grid style for crate cards from resolved gallery layout. */
export function galleryGridStyle(
  gallery: ResolvedGallery,
): Record<string, string> {
  if (gallery.layout === "list") {
    return {
      display: "grid",
      gridTemplateColumns: "1fr",
      gap: gallery.density === "compact" ? "0.75rem" : "1rem",
    };
  }
  const min = scaleCssLength(gallery.card_min_width, 1.1);
  return {
    display: "grid",
    gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${min}), 1fr))`,
    gap: gallery.density === "compact" ? "0.75rem" : "1rem",
  };
}

function parseExportConfig(raw: unknown): ExportConfig | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const profilesRaw = (raw as { profiles?: unknown }).profiles;
  if (!Array.isArray(profilesRaw) || profilesRaw.length === 0) return undefined;

  const profiles = profilesRaw.flatMap((row): ExportProfile[] => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return [];
    const r = row as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id : undefined;
    const title = typeof r.title === "string" ? r.title : undefined;
    if (!id || !title) return [];

    const assetsRaw = Array.isArray(r.assets) ? r.assets : [];
    const assets = assetsRaw.flatMap((a): ExportAssetSpec[] => {
      if (!a || typeof a !== "object" || Array.isArray(a)) return [];
      const ar = a as Record<string, unknown>;
      if (typeof ar.child !== "string" || typeof ar.format !== "string") {
        return [];
      }
      return [
        {
          child: ar.child,
          format: ar.format,
          dir: typeof ar.dir === "string" ? ar.dir : undefined,
        },
      ];
    });
    if (assets.length === 0) return [];

    const namingRaw =
      r.naming && typeof r.naming === "object" && !Array.isArray(r.naming)
        ? (r.naming as Record<string, unknown>)
        : null;
    const naming =
      namingRaw && typeof namingRaw.pattern === "string"
        ? { pattern: namingRaw.pattern }
        : undefined;

    const manifestRaw =
      r.manifest && typeof r.manifest === "object" && !Array.isArray(r.manifest)
        ? (r.manifest as Record<string, unknown>)
        : null;
    const slots = Array.isArray(manifestRaw?.slots)
      ? manifestRaw.slots.filter((s): s is string => typeof s === "string")
      : [];
    const manifest =
      slots.length > 0
        ? {
            filename:
              typeof manifestRaw?.filename === "string"
                ? manifestRaw.filename
                : "manifest.json",
            slots,
          }
        : undefined;

    return [
      {
        id,
        title,
        description:
          typeof r.description === "string" ? r.description : undefined,
        assets,
        naming,
        manifest,
      },
    ];
  });

  return profiles.length > 0 ? { profiles } : undefined;
}

export async function fetchLinkmlSchema(
  schemaUri: string,
): Promise<ParsedSchema> {
  const resolvedUri = resolveAgainstTiledOrigin(schemaUri);
  let doc = await fetchYaml(resolvedUri);
  const imports = Array.isArray(doc.imports) ? doc.imports : [];
  for (const imp of imports) {
    if (typeof imp !== "string") continue;
    const impUri = resolveImportUri(resolvedUri, imp);
    if (!impUri) continue;
    try {
      const imported = await fetchYaml(impUri);
      doc = mergeSchemaDocs(doc, imported);
    } catch {
      // Optional local import; domain schema may still be usable alone.
    }
  }

  const annotations =
    doc.annotations && typeof doc.annotations === "object"
      ? (doc.annotations as Record<string, unknown>)
      : undefined;

  return {
    id: typeof doc.id === "string" ? doc.id : undefined,
    name: typeof doc.name === "string" ? doc.name : undefined,
    title: typeof doc.title === "string" ? doc.title : undefined,
    description:
      typeof doc.description === "string" ? doc.description : undefined,
    classes: (doc.classes as ParsedSchema["classes"]) ?? {},
    slots: (doc.slots as ParsedSchema["slots"]) ?? {},
    enums: (doc.enums as ParsedSchema["enums"]) ?? {},
    annotations,
    arrayBindings: parseArrayBindings(annotations),
  };
}

export function slotLabel(schema: ParsedSchema, slotName: string): string {
  const slot = schema.slots[slotName];
  if (typeof slot?.title === "string" && slot.title.trim()) {
    return slot.title.trim();
  }
  return humanize(slotName);
}

export function enumDisplay(
  schema: ParsedSchema,
  slotName: string,
  value: unknown,
): string {
  if (value == null || value === "") return "—";
  const range = schema.slots[slotName]?.range;
  if (!range || !schema.enums[range]) return String(value);
  const pv = schema.enums[range].permissible_values?.[String(value)];
  if (pv && typeof pv === "object" && pv.description) return pv.description;
  return String(value);
}

export function formatSlotValue(
  schema: ParsedSchema,
  slotName: string,
  value: unknown,
): string {
  if (value == null || value === "") return "—";
  const slot = schema.slots[slotName];
  if (Array.isArray(value)) {
    if (value.every((x) => typeof x === "number" || typeof x === "string")) {
      return value.join(" × ");
    }
    return JSON.stringify(value);
  }
  if (slot?.range && schema.enums[slot.range]) {
    return enumDisplay(schema, slotName, value);
  }
  if (slotName.includes("byte_size") && typeof value === "number") {
    if (value < 1024) return `${value} B`;
    if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`;
    if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MiB`;
    return `${(value / 1024 ** 3).toFixed(2)} GiB`;
  }
  if (
    (slotName.includes("sha256") || slot?.pattern?.includes("0-9a-f")) &&
    typeof value === "string" &&
    value.length > 16
  ) {
    return `${value.slice(0, 12)}…${value.slice(-8)}`;
  }
  return String(value);
}

/**
 * True when this slot should render as a class-fraction list
 * (binding legend_slot or range matching dashboard tissue_class / class_fraction type).
 */
export function isTissueFractionsSlot(
  schema: ParsedSchema,
  slotName: string,
  tissueClass?: string,
): boolean {
  const slot = schema.slots[slotName];
  if (
    schema.arrayBindings.class_masks.some((b) => b.legend_slot === slotName)
  ) {
    return true;
  }
  if (tissueClass && slot?.range === tissueClass) return true;
  return false;
}
