import type { ParsedSchema } from "./schema";
import { getTiledApiKey, getTiledOrigin } from "./tiledServer";

export type LedgerSection = {
  id: string;
  title: string;
  class: string;
  form_slots?: string[];
  /** Payload slots shown on a chip after the label (gallery-style facts). */
  chip_slots?: string[];
};

export type BookDensity = "compact" | "cozy" | "comfortable";

/** Raw `layout:` block from lambda_project_book_dashboard.yaml. */
export type BookLayoutConfig = {
  density?: BookDensity;
  page_gap?: string;
  paper_pad?: string;
  section_gap?: string;
  chip_gap?: string;
  form_gap?: string;
  narrative_max_width?: string;
  items_per_row?: number;
  textbox_own_line?: boolean;
  wide_slots?: string[];
  ledger?: {
    columns?: number;
    form_field_width?: string;
    chip_min_width?: string;
  };
  workspace?: {
    tree_width?: string;
  };
};

export type ProjectBookDashboard = {
  title?: string;
  schema_uri?: string;
  ledger_entry_base?: string;
  default_subproject_title?: string;
  title_slot?: string;
  layout?: BookLayoutConfig;
  ledger?: { sections?: LedgerSection[]; title_slot?: string };
};

export type ResolvedBookLayout = {
  density: BookDensity;
  page_gap: string;
  paper_pad: string;
  section_gap: string;
  chip_gap: string;
  form_gap: string;
  narrative_max_width: string;
  items_per_row: number;
  textbox_own_line: boolean;
  ledger_columns: number;
  form_field_width: string;
  chip_min_width: string;
  tree_width: string;
  wide_slots: string[];
};

const DENSITY_PRESETS: Record<
  BookDensity,
  Pick<
    ResolvedBookLayout,
    "page_gap" | "paper_pad" | "section_gap" | "chip_gap" | "form_gap"
  >
> = {
  compact: {
    page_gap: "1rem",
    paper_pad: "1rem",
    section_gap: "1.25rem",
    chip_gap: "0.5rem",
    form_gap: "0.65rem",
  },
  cozy: {
    page_gap: "1.5rem",
    paper_pad: "1.25rem",
    section_gap: "1.75rem",
    chip_gap: "0.65rem",
    form_gap: "0.85rem",
  },
  comfortable: {
    page_gap: "2rem",
    paper_pad: "1.75rem",
    section_gap: "2.25rem",
    chip_gap: "0.75rem",
    form_gap: "1rem",
  },
};

function cssLength(raw: unknown, fallback: string): string {
  return typeof raw === "string" && raw.trim() ? raw.trim() : fallback;
}

/** Resolve Project Book layout the way `resolveGallery` resolves crate tiles. */
export function resolveBookLayout(
  dash?: ProjectBookDashboard | null,
): ResolvedBookLayout {
  const raw = dash?.layout ?? {};
  const density: BookDensity =
    raw.density === "compact" ||
    raw.density === "cozy" ||
    raw.density === "comfortable"
      ? raw.density
      : "cozy";
  const preset = DENSITY_PRESETS[density];
  const cols = raw.ledger?.columns;
  const perRow = raw.items_per_row;
  return {
    density,
    page_gap: cssLength(raw.page_gap, preset.page_gap),
    paper_pad: cssLength(raw.paper_pad, preset.paper_pad),
    section_gap: cssLength(raw.section_gap, preset.section_gap),
    chip_gap: cssLength(raw.chip_gap, preset.chip_gap),
    form_gap: cssLength(raw.form_gap, preset.form_gap),
    narrative_max_width: cssLength(raw.narrative_max_width, "42rem"),
    items_per_row:
      typeof perRow === "number" && perRow >= 1 && perRow <= 6
        ? Math.floor(perRow)
        : 3,
    textbox_own_line: raw.textbox_own_line !== false,
    ledger_columns:
      typeof cols === "number" && cols >= 1 && cols <= 4 ? Math.floor(cols) : 2,
    form_field_width: cssLength(raw.ledger?.form_field_width, "11rem"),
    chip_min_width: cssLength(raw.ledger?.chip_min_width, "8rem"),
    tree_width: cssLength(raw.workspace?.tree_width, "22rem"),
    wide_slots: Array.isArray(raw.wide_slots)
      ? raw.wide_slots.filter((s): s is string => typeof s === "string")
      : ["notes", "narrative", "sequence", "smiles", "inchi"],
  };
}

export type LedgerEntry = {
  id: string;
  project_id: string;
  class_name: string;
  payload: Record<string, unknown>;
  label: string;
  sort_order: number;
};

export type Subproject = {
  id: string;
  project_id: string;
  parent_id: string | null;
  title: string;
  narrative: string;
  sort_order: number;
  crate_uuids: string[];
  ledger_entry_ids: string[];
  updated_at?: string;
};

export type ProjectSummary = {
  id: string;
  title: string;
  narrative: string;
  crate_membership: "exclusive" | "shared" | string;
  updated_at?: string;
  subproject_count?: number;
  crate_count?: number;
  ledger_count?: number;
};

export type ProjectDetail = ProjectSummary & {
  subprojects: Subproject[];
  ledger: LedgerEntry[];
};

export type Placement = {
  crate_uuid: string;
  subproject_id: string;
  project_id: string;
  subproject_title: string;
};

export type ResolvedBookSchema = {
  schema: Record<string, unknown>;
  dashboard: ProjectBookDashboard;
  ledger_classes: string[];
};

function bookBase(): string {
  // Same origin as hydrate / Tiled — do not depend on a Vite proxy.
  return `${getTiledOrigin()}/api/v1/project-book`;
}

function headers(): HeadersInit {
  const key = getTiledApiKey();
  return {
    "Content-Type": "application/json",
    ...(key ? { Authorization: `Apikey ${key}` } : {}),
  };
}

async function bookFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${bookBase()}${path}`, {
    ...init,
    headers: { ...headers(), ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(body.error || `Project book HTTP ${res.status}`);
  }
  return body;
}

export function parsedSchemaFromDoc(doc: Record<string, unknown>): ParsedSchema {
  return {
    classes:
      (doc.classes as ParsedSchema["classes"]) ?? {},
    slots: (doc.slots as ParsedSchema["slots"]) ?? {},
    enums: (doc.enums as ParsedSchema["enums"]) ?? {},
    arrayBindings: { class_masks: [], instance_annotations: [] },
  };
}

export function fetchBookSchema(): Promise<ResolvedBookSchema> {
  return bookFetch("/schema");
}

export function fetchProjects(): Promise<{ projects: ProjectSummary[] }> {
  return bookFetch("/projects");
}

export function fetchProject(id: string): Promise<ProjectDetail> {
  return bookFetch(`/projects/${id}`);
}

export function createProject(body: {
  title: string;
  narrative?: string;
}): Promise<ProjectDetail> {
  return bookFetch("/projects", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function patchProject(
  id: string,
  body: Partial<Pick<ProjectSummary, "title" | "narrative" | "crate_membership">>,
): Promise<ProjectDetail> {
  return bookFetch(`/projects/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deleteProject(id: string): Promise<{ ok: boolean }> {
  return bookFetch(`/projects/${id}`, { method: "DELETE" });
}

export function addLedgerEntry(
  projectId: string,
  body: { class_name: string; payload: Record<string, unknown> },
): Promise<LedgerEntry> {
  return bookFetch(`/projects/${projectId}/ledger`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function deleteLedgerEntry(id: string): Promise<{ ok: boolean }> {
  return bookFetch(`/ledger/${id}`, { method: "DELETE" });
}

export function addSubproject(
  projectId: string,
  body: { title: string; narrative?: string; parent_id?: string | null },
): Promise<Subproject> {
  return bookFetch(`/projects/${projectId}/subprojects`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function patchSubproject(
  id: string,
  body: Partial<Pick<Subproject, "title" | "narrative" | "parent_id">>,
): Promise<Subproject> {
  return bookFetch(`/subprojects/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deleteSubproject(id: string): Promise<{ ok: boolean }> {
  return bookFetch(`/subprojects/${id}`, { method: "DELETE" });
}

export function setSubprojectCrates(
  id: string,
  body: { add?: string[]; remove?: string[] },
): Promise<Subproject> {
  return bookFetch(`/subprojects/${id}/crates`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function setSubprojectLedger(
  id: string,
  body: { add?: string[]; remove?: string[] },
): Promise<Subproject> {
  return bookFetch(`/subprojects/${id}/ledger`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function fetchPlacements(): Promise<{ placements: Placement[] }> {
  return bookFetch("/placements");
}

/** Default filing target: Unsorted, else a root subproject, else the first. */
export function findUnsortedSubproject(
  project: ProjectDetail,
  defaultTitle = "Unsorted",
): Subproject | undefined {
  const want = defaultTitle.trim().toLowerCase();
  const exact = project.subprojects.find(
    (s) => s.title.trim().toLowerCase() === want,
  );
  if (exact) return exact;
  return (
    project.subprojects.find((s) => !s.parent_id) ?? project.subprojects[0]
  );
}

export function classSlots(
  schema: ParsedSchema,
  className: string,
): string[] {
  const slots: string[] = [];
  let name: string | undefined = className;
  const seen = new Set<string>();
  const chain: string[] = [];
  while (name && !seen.has(name)) {
    seen.add(name);
    chain.push(name);
    name = schema.classes[name]?.is_a;
  }
  for (const cls of chain.reverse()) {
    for (const slot of schema.classes[cls]?.slots ?? []) {
      if (slot !== "id" && !slots.includes(slot)) slots.push(slot);
    }
  }
  return slots;
}

export function formSlotsForSection(
  schema: ParsedSchema,
  section: LedgerSection,
): string[] {
  if (section.form_slots?.length) {
    return section.form_slots.filter((s) => s !== "id");
  }
  return classSlots(schema, section.class);
}

export function enumNames(
  schema: ParsedSchema,
  slotName: string,
): string[] | null {
  const range = schema.slots[slotName]?.range;
  if (!range || !schema.enums[range]) return null;
  return Object.keys(schema.enums[range].permissible_values ?? {});
}

/** CSS grid for “at most N items per line” (chips, compact fields). */
export function itemsPerRowGrid(
  perRow: number,
  gap: string,
): { display: "grid"; gridTemplateColumns: string; gap: string } {
  const n = Math.max(1, Math.min(6, perRow));
  return {
    display: "grid",
    gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`,
    gap,
  };
}

export function isLongSlot(
  slotName: string,
  wideSlots?: string[],
): boolean {
  const wide = wideSlots?.length
    ? wideSlots
    : ["narrative", "notes", "sequence", "smiles", "inchi"];
  return wide.includes(slotName);
}
