/**
 * Composable display modules for agent job results.
 * Declared in facility YAML: crate.actions.agents.<uuid>.display
 * See data_root/schemas/lambda_mx_display_modules.yaml
 */

export type DisplaySummaryItem = {
  label: string;
  from: string;
  suffix?: string;
  emphasis?: boolean;
};

export type DisplayTableColumn = {
  field: string;
  label: string;
  link?: string;
  type?: "string" | "number" | "array";
  decimals?: number;
  join?: string;
  wrap?: boolean;
};

export type DisplaySummaryModule = {
  kind: "summary";
  id?: string;
  title?: string;
  items: DisplaySummaryItem[];
};

export type DisplayTableModule = {
  kind: "table";
  id?: string;
  title?: string;
  rows: string;
  limit?: number;
  /** When rows resolve to string[], show index + value columns. */
  primitive?: "string";
  value_label?: string;
  columns: DisplayTableColumn[];
};

export type DisplayRowModule = {
  kind: "row";
  id?: string;
  title?: string;
  modules: DisplayModuleSpec[];
};

export type DisplayGraphModule = {
  kind: "graph";
  id?: string;
  title?: string;
  /** Dotted path to { nodes, edges } object. */
  from: string;
  node_id?: string;
  node_label?: string;
  edges_from?: string;
  edges_to?: string;
  /** Node boolean field — highlighted when true. */
  highlight_field?: string;
};

export type DisplayKvModule = {
  kind: "kv";
  id?: string;
  title?: string;
  from: string;
  key_label?: string;
  value_label?: string;
  value_decimals?: number;
};

export type DisplayImageModule = {
  kind: "image";
  id?: string;
  title?: string;
  /** Static path under job output/. */
  file?: string;
  /** Dotted path in primary_file → relative output path. */
  from?: string;
  alt?: string;
};

export type DisplayJsonModule = {
  kind: "json";
  id?: string;
  title?: string;
  from?: string;
};

/** Open Mol* popup for a job output PDB (+ optional CCP4/MAP density). */
export type DisplayDensityPopupModule = {
  kind: "density_popup";
  id?: string;
  title?: string;
  /** Button label. */
  label?: string;
  /** Dotted path → relative PDB path under output/ (e.g. view_pdb). */
  pdb_from?: string;
  /** Static PDB path under output/. */
  pdb_file?: string;
  /** Dotted path → relative map path (CCP4/MAP). */
  map_from?: string;
  /** Static map path under output/. */
  map_file?: string;
};

export type DisplayModuleSpec =
  | DisplaySummaryModule
  | DisplayTableModule
  | DisplayRowModule
  | DisplayGraphModule
  | DisplayKvModule
  | DisplayImageModule
  | DisplayJsonModule
  | DisplayDensityPopupModule;

/** Composable display for one agent's job output. */
export type AgentDisplaySpec = {
  primary_file: string;
  modules: DisplayModuleSpec[];
};

/** @deprecated Legacy flat view — normalized to AgentDisplaySpec at parse time. */
export type AgentResultViewSpec = {
  primary_file: string;
  kind?: "table" | "json" | "text";
  title?: string;
  summary?: DisplaySummaryItem[];
  table?: {
    rows: string;
    limit?: number;
    columns: DisplayTableColumn[];
  };
};

export function resolveJsonPath(data: unknown, path: string): unknown {
  if (!path) return data;
  let cur: unknown = data;
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object" || Array.isArray(cur)) {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function formatDisplayValue(
  value: unknown,
  col?: Pick<DisplayTableColumn, "type" | "decimals" | "join">,
): string {
  if (value == null || value === "") return "—";
  if (col?.type === "number" && typeof value === "number") {
    return value.toFixed(col.decimals ?? 3);
  }
  if (Array.isArray(value)) {
    const join = col?.join ?? "; ";
    if (col?.type === "number" || value.every((x) => typeof x === "number")) {
      const d = col?.decimals ?? 2;
      return value
        .map((x) => (typeof x === "number" ? x.toFixed(d) : String(x)))
        .join(col?.join ?? " ");
    }
    return value.map((x) => String(x)).join(join);
  }
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function normalizeAgentDisplay(
  raw: AgentDisplaySpec | AgentResultViewSpec | undefined,
): AgentDisplaySpec | undefined {
  if (!raw) return undefined;
  const r = raw as AgentDisplaySpec & AgentResultViewSpec;
  if (Array.isArray(r.modules) && r.modules.length && r.primary_file) {
    return { primary_file: r.primary_file, modules: r.modules };
  }
  if (!r.primary_file?.trim()) return undefined;

  const modules: DisplayModuleSpec[] = [];
  if (r.summary?.length || r.title) {
    modules.push({
      kind: "summary",
      title: r.title,
      items: r.summary ?? [],
    });
  }
  if (r.table?.rows && r.table.columns?.length) {
    modules.push({
      kind: "table",
      rows: r.table.rows,
      limit: r.table.limit,
      columns: r.table.columns,
    });
  }
  if (!modules.length && r.kind === "json") {
    modules.push({ kind: "json", title: r.title });
  }
  if (!modules.length) return undefined;
  return { primary_file: r.primary_file.trim(), modules };
}

export function preferResultPath(
  display: AgentDisplaySpec | null | undefined,
  dashboardFiles: string[] | undefined,
  available: string[],
): string | null {
  if (display?.primary_file && available.includes(display.primary_file)) {
    return display.primary_file;
  }
  if (dashboardFiles?.length) {
    for (const p of dashboardFiles) {
      if (available.includes(p)) return p;
    }
  }
  const json = available.find(
    (p) => p.endsWith(".json") && p !== "ro-crate-metadata.json",
  );
  return json ?? available[0] ?? null;
}

export function resolveImagePath(
  mod: DisplayImageModule,
  primaryData: unknown,
): string | null {
  if (mod.file?.trim()) return mod.file.trim();
  if (mod.from?.trim()) {
    const v = resolveJsonPath(primaryData, mod.from);
    return typeof v === "string" && v.trim() ? v.trim() : null;
  }
  return null;
}

/** Resolve PDB / map paths for a density_popup module from primary JSON. */
export function resolveDensityPopupPaths(
  mod: DisplayDensityPopupModule,
  primaryData: unknown,
): { pdb: string | null; map: string | null } {
  let pdb: string | null = null;
  if (mod.pdb_file?.trim()) pdb = mod.pdb_file.trim();
  else if (mod.pdb_from?.trim()) {
    const v = resolveJsonPath(primaryData, mod.pdb_from);
    pdb = typeof v === "string" && v.trim() ? v.trim() : null;
  }

  let map: string | null = null;
  if (mod.map_file?.trim()) map = mod.map_file.trim();
  else if (mod.map_from?.trim()) {
    const v = resolveJsonPath(primaryData, mod.map_from);
    map = typeof v === "string" && v.trim() ? v.trim() : null;
  }
  return { pdb, map };
}
