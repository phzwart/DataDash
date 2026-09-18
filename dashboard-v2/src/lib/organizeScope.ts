import type { BookContext, OrganizeScope } from "./bookContext";
import type { Placement, Subproject } from "./projectBookApi";
import type { CrateSummary } from "./tiledCrates";

const INSTRUMENT_SLOTS = ["instrument_code", "beamline", "instrument"];
const DATE_SLOTS = ["workflow_started_at", "collection_started_at", "created_at"];

export function crateInstrument(crate: CrateSummary): string {
  for (const key of INSTRUMENT_SLOTS) {
    const raw = crate.metadata[key];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  }
  return "";
}

export function crateDateMs(crate: CrateSummary): number | null {
  for (const key of DATE_SLOTS) {
    const raw = crate.metadata[key];
    if (typeof raw !== "string" || !raw.trim()) continue;
    const ms = Date.parse(raw);
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

function dayStartMs(ymd: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const ms = Date.parse(`${ymd}T00:00:00`);
  return Number.isFinite(ms) ? ms : null;
}

function dayEndMs(ymd: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const ms = Date.parse(`${ymd}T23:59:59.999`);
  return Number.isFinite(ms) ? ms : null;
}

export function filterByScope(
  crates: CrateSummary[],
  placements: Placement[],
  scope: OrganizeScope,
  projectId: string | null,
): CrateSummary[] {
  const byCrate = new Map(placements.map((p) => [p.crate_uuid, p]));
  if (scope === "inbox") {
    return crates.filter((c) => !byCrate.has(c.id));
  }
  if (scope === "project") {
    if (!projectId) return [];
    return crates.filter((c) => byCrate.get(c.id)?.project_id === projectId);
  }
  return crates;
}

export function applyOrganizeFacets(
  crates: CrateSummary[],
  ctx: Pick<BookContext, "instrument" | "dateFrom" | "dateTo">,
): CrateSummary[] {
  const from = ctx.dateFrom ? dayStartMs(ctx.dateFrom) : null;
  const to = ctx.dateTo ? dayEndMs(ctx.dateTo) : null;
  return crates.filter((c) => {
    if (ctx.instrument) {
      if (crateInstrument(c) !== ctx.instrument) return false;
    }
    if (from != null || to != null) {
      const ms = crateDateMs(c);
      if (ms == null) return false;
      if (from != null && ms < from) return false;
      if (to != null && ms > to) return false;
    }
    return true;
  });
}

/** Scope then date/instrument facets. Marker filters stay with the caller. */
export function filterOrganizeUniverse(
  crates: CrateSummary[],
  placements: Placement[],
  ctx: BookContext,
): CrateSummary[] {
  return applyOrganizeFacets(
    filterByScope(crates, placements, ctx.scope, ctx.projectId),
    ctx,
  );
}

export function instrumentsInScope(crates: CrateSummary[]): string[] {
  const set = new Set<string>();
  for (const c of crates) {
    const inst = crateInstrument(c);
    if (inst) set.add(inst);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function projectCrateIds(
  placements: Placement[],
  projectId: string | null,
): Set<string> {
  const ids = new Set<string>();
  if (!projectId) return ids;
  for (const p of placements) {
    if (p.project_id === projectId) ids.add(p.crate_uuid);
  }
  return ids;
}

/** Crates to run on Work: the selected subproject, or the whole project. */
export function projectWorkIds(
  sub: Subproject | undefined,
  projectIds: Set<string>,
): { ids: string[]; reason: "subproject" | "project" | "empty" } {
  if (sub) {
    const ids = sub.crate_uuids.filter((id) => projectIds.has(id));
    return { ids, reason: ids.length ? "subproject" : "empty" };
  }
  if (projectIds.size) {
    return { ids: [...projectIds], reason: "project" };
  }
  return { ids: [], reason: "empty" };
}

export function workflowFocusIds(opts: {
  universeIds: string[];
  selectionIds: string[];
  sub: Subproject | undefined;
  projectId: string | null;
  projectIds: Set<string>;
}): { ids: string[]; reason: "selection" | "subproject" | "project" | "empty" } {
  const uni = new Set(opts.universeIds);
  const selected = opts.selectionIds.filter((id) => uni.has(id));
  if (selected.length) return { ids: selected, reason: "selection" };
  if (opts.sub) {
    const ids = opts.sub.crate_uuids.filter((id) =>
      opts.projectId ? opts.projectIds.has(id) : true,
    );
    if (ids.length) return { ids, reason: "subproject" };
  }
  if (opts.projectId && opts.projectIds.size) {
    return { ids: [...opts.projectIds], reason: "project" };
  }
  return { ids: [], reason: "empty" };
}

export function scopeLabel(scope: OrganizeScope): string {
  if (scope === "inbox") return "Inbox";
  if (scope === "project") return "Project";
  return "All";
}
