import type { JobListItem, JobOutputFilePayload } from "./agentApi";

export const PDB_LATTICE_AGENT_UUID = "035c162b-c868-4fd7-bd7d-f9404dfb250c";
export const PDB_MATCHES_PATH = "data/pdb_matches.json";
export const DEFAULT_CONSENSUS_CUTOFF = 1.0;

export type PdbHit = {
  pdb_id: string;
  distance: number;
  space_group: string;
  unit_cell: string;
};

export type CratePdbAnalysis = {
  crateUuid: string;
  jobUuid: string;
  hits: PdbHit[];
};

export type ConsensusCrateRef = {
  crateUuid: string;
  sampleCode: string;
  distance: number;
};

export type ConsensusBucket = {
  pdb_id: string;
  space_group: string;
  unit_cell: string;
  minDistance: number;
  crates: ConsensusCrateRef[];
};

export function crateUuidFromJob(job: JobListItem): string | null {
  for (const ref of job.input_refs ?? []) {
    if (ref?.type === "rocrate_ref" && typeof ref.ref === "string" && ref.ref) {
      return ref.ref;
    }
  }
  return null;
}

/** Latest completed PDB lattice-search job per input crate. */
export function latestCompletedPdbJobByCrate(
  jobs: JobListItem[],
): Map<string, JobListItem> {
  const latest = new Map<string, JobListItem>();
  for (const job of jobs) {
    if (String(job.status) !== "completed") continue;
    if (job.agent_uuid && job.agent_uuid !== PDB_LATTICE_AGENT_UUID) continue;
    const crate = crateUuidFromJob(job);
    if (!crate) continue;
    const prev = latest.get(crate);
    if (!prev || (job.created_at ?? "") > (prev.created_at ?? "")) {
      latest.set(crate, job);
    }
  }
  return latest;
}

function formatCell(raw: unknown): string {
  if (Array.isArray(raw)) {
    return raw
      .map((v) => {
        const n = typeof v === "number" ? v : Number(v);
        return Number.isFinite(n) ? n.toFixed(2) : String(v);
      })
      .join(" ");
  }
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parsePdbMatches(payload: JobOutputFilePayload): PdbHit[] {
  let body: unknown = payload.data;
  if (body == null && typeof payload.text === "string" && payload.text.trim()) {
    try {
      body = JSON.parse(payload.text);
    } catch {
      return [];
    }
  }
  const root = asRecord(body);
  const table = Array.isArray(root?.table)
    ? root.table
    : Array.isArray(body)
      ? body
      : [];
  const hits: PdbHit[] = [];
  for (const row of table) {
    const rec = asRecord(row);
    if (!rec) continue;
    const pdbRaw = rec.pdb_id ?? rec.pdbid ?? rec.pdb;
    const pdb_id =
      typeof pdbRaw === "string" && pdbRaw.trim()
        ? pdbRaw.trim().toUpperCase()
        : "";
    const distance = Number(rec.distance);
    if (!pdb_id || !Number.isFinite(distance)) continue;
    hits.push({
      pdb_id,
      distance,
      space_group:
        typeof rec.space_group === "string" ? rec.space_group : "",
      unit_cell: formatCell(rec.unit_cell),
    });
  }
  return hits;
}

export function bucketConsensus(
  analyses: CratePdbAnalysis[],
  sampleByCrate: Map<string, string>,
  cutoff: number,
): ConsensusBucket[] {
  const byPdb = new Map<
    string,
    {
      space_group: string;
      unit_cell: string;
      minDistance: number;
      crates: Map<string, ConsensusCrateRef>;
    }
  >();
  for (const analysis of analyses) {
    const below = analysis.hits.filter((h) => h.distance <= cutoff);
    const seen = new Set<string>();
    for (const hit of below) {
      if (seen.has(hit.pdb_id)) continue;
      seen.add(hit.pdb_id);
      let bucket = byPdb.get(hit.pdb_id);
      if (!bucket) {
        bucket = {
          space_group: hit.space_group,
          unit_cell: hit.unit_cell,
          minDistance: hit.distance,
          crates: new Map(),
        };
        byPdb.set(hit.pdb_id, bucket);
      }
      if (hit.distance < bucket.minDistance) {
        bucket.minDistance = hit.distance;
        if (hit.space_group) bucket.space_group = hit.space_group;
        if (hit.unit_cell) bucket.unit_cell = hit.unit_cell;
      }
      const prevCrate = bucket.crates.get(analysis.crateUuid);
      if (!prevCrate || hit.distance < prevCrate.distance) {
        bucket.crates.set(analysis.crateUuid, {
          crateUuid: analysis.crateUuid,
          sampleCode: sampleByCrate.get(analysis.crateUuid) ?? "",
          distance: hit.distance,
        });
      }
    }
  }
  return [...byPdb.entries()]
    .map(([pdb_id, b]) => ({
      pdb_id,
      space_group: b.space_group,
      unit_cell: b.unit_cell,
      minDistance: b.minDistance,
      crates: [...b.crates.values()].sort((a, c) => {
        const byDist = a.distance - c.distance;
        if (byDist !== 0) return byDist;
        return (a.sampleCode || a.crateUuid).localeCompare(
          c.sampleCode || c.crateUuid,
        );
      }),
    }))
    .sort((a, b) => {
      const byCount = b.crates.length - a.crates.length;
      if (byCount !== 0) return byCount;
      return a.minDistance - b.minDistance;
    });
}
