import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useQueries, useQuery } from "@tanstack/react-query";
import { VegaEmbed } from "react-vega";
import { Paper } from "@blueskyproject/finch";
import { getJobOutputFile, listJobs } from "../lib/agentApi";
import { useBookSearchSync } from "../lib/bookContext";
import {
  bucketConsensus,
  DEFAULT_CONSENSUS_CUTOFF,
  latestCompletedPdbJobByCrate,
  parsePdbMatches,
  PDB_LATTICE_AGENT_UUID,
  PDB_MATCHES_PATH,
  type CratePdbAnalysis,
  type ConsensusBucket,
} from "../lib/consensusPdb";
import { resolveDashboardUri } from "../lib/dashboardConfig";
import { projectCrateIds } from "../lib/organizeScope";
import {
  fetchPlacements,
  fetchProject,
  type Subproject,
} from "../lib/projectBookApi";
import {
  enumDisplay,
  fetchDashboardConfig,
  fetchLinkmlSchema,
  slotLabel,
  type ParsedSchema,
} from "../lib/schema";
import { fetchCrates, shortId, type CrateSummary } from "../lib/tiledCrates";
import { cellSplomToVegaSpec, cratesToDataRows } from "../viz/bindVegaSpec";
import type { VisualizationSpec } from "vega-embed";

const FALLBACK_METRIC_SLOTS = [
  "resolution",
  "completeness",
  "cc_half",
  "mean_i_over_sigma",
  "rmerge",
  "multiplicity",
  "space_group",
  "unit_cell_a",
  "unit_cell_b",
  "unit_cell_c",
  "unit_cell_alpha",
  "unit_cell_beta",
  "unit_cell_gamma",
  "wavelength_angstrom",
];

function walkSubprojects(
  nodes: Subproject[],
  parentId: string | null = null,
): Subproject[] {
  const kids = nodes
    .filter((n) => (n.parent_id ?? null) === parentId)
    .sort(
      (a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title),
    );
  const out: Subproject[] = [];
  for (const kid of kids) {
    out.push(kid);
    out.push(...walkSubprojects(nodes, kid.id));
  }
  return out;
}

function sampleCode(crate: CrateSummary): string {
  const raw = crate.metadata.sample_code;
  return typeof raw === "string" ? raw.trim() : "";
}

function formatStatValue(
  slot: string,
  raw: unknown,
  schema: ParsedSchema | undefined,
): string {
  if (raw == null || raw === "") return "";
  if (slot.startsWith("unit_cell_")) {
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(n) ? n.toFixed(2) : String(raw);
  }
  if (schema) {
    const shown = enumDisplay(schema, slot, raw);
    return shown === "—" ? "" : shown;
  }
  if (typeof raw === "number") {
    return Number.isInteger(raw) ? String(raw) : raw.toFixed(3).replace(/\.?0+$/, "");
  }
  return String(raw);
}

function CellSplom({ crates }: { crates: CrateSummary[] }) {
  const spec = useMemo(() => {
    const base = cellSplomToVegaSpec() as Record<string, unknown>;
    return {
      ...base,
      data: { values: cratesToDataRows(crates) },
    };
  }, [crates]);
  return (
    <div className="overflow-x-auto">
      <VegaEmbed
        spec={spec as VisualizationSpec}
        options={{ actions: false, renderer: "canvas" }}
      />
    </div>
  );
}

function StatsTable({
  crates,
  columns,
  schema,
}: {
  crates: CrateSummary[];
  columns: string[];
  schema: ParsedSchema | undefined;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-xs border-collapse">
        <thead>
          <tr className="text-left text-slate-300">
            <th className="sticky top-0 z-10 px-2 py-1.5 font-medium whitespace-nowrap border-b border-slate-700 bg-slate-900">
              Sample
            </th>
            <th className="sticky top-0 z-10 px-2 py-1.5 font-medium whitespace-nowrap border-b border-slate-700 bg-slate-900">
              Crate
            </th>
            {columns.map((col) => (
              <th
                key={col}
                className="sticky top-0 z-10 px-2 py-1.5 font-medium whitespace-nowrap border-b border-slate-700 bg-slate-900"
              >
                {schema ? slotLabel(schema, col) : col.replace(/_/g, " ")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {crates.map((c) => (
            <tr key={c.id} className="text-slate-200 odd:bg-slate-950/90">
              <td className="px-2 py-1 whitespace-nowrap border-b border-slate-800/80">
                <Link
                  to={`/crates/${c.id}`}
                  className="text-sky-300 hover:text-sky-100"
                >
                  {sampleCode(c) || shortId(c.id)}
                </Link>
              </td>
              <td className="px-2 py-1 whitespace-nowrap border-b border-slate-800/80 font-mono text-slate-400">
                {shortId(c.id)}
              </td>
              {columns.map((col) => (
                <td
                  key={col}
                  className="px-2 py-1 whitespace-nowrap border-b border-slate-800/80 font-mono tabular-nums"
                >
                  {formatStatValue(col, c.metadata[col], schema)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConsensusSection({
  buckets,
  cutoff,
  loading,
}: {
  buckets: ConsensusBucket[];
  cutoff: number;
  loading: boolean;
}) {
  if (loading) {
    return (
      <p className="text-sm text-slate-400">Loading PDB lattice matches…</p>
    );
  }
  if (!buckets.length) {
    return (
      <p className="text-sm text-slate-400">
        No hits at or below {cutoff} Å.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="report-consensus-table">
        <thead>
          <tr>
            <th>PDB</th>
            <th>Space group</th>
            <th>Unit cell</th>
            <th>Sample</th>
            <th>Crate</th>
            <th>Δ (Å)</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((b) =>
            b.crates.map((c, i) => (
              <tr
                key={`${b.pdb_id}:${c.crateUuid}`}
                className={i === 0 ? "report-consensus-group" : undefined}
              >
                <td>
                  {i === 0 ? (
                    <a
                      href={`https://www.rcsb.org/structure/${encodeURIComponent(b.pdb_id)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="pdb-id text-sky-300 hover:text-sky-100"
                    >
                      {b.pdb_id}
                    </a>
                  ) : null}
                </td>
                <td className="text-slate-200 whitespace-nowrap">
                  {i === 0 ? b.space_group || "—" : null}
                </td>
                <td className="unit-cell text-slate-300">
                  {i === 0 ? b.unit_cell || "—" : null}
                </td>
                <td>
                  <Link
                    to={`/crates/${c.crateUuid}`}
                    className="text-sky-300 hover:text-sky-100"
                  >
                    {c.sampleCode || shortId(c.crateUuid)}
                  </Link>
                </td>
                <td className="font-mono text-slate-400 whitespace-nowrap">
                  {shortId(c.crateUuid)}
                </td>
                <td className="delta text-slate-200">
                  {c.distance.toFixed(3)}
                </td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </div>
  );
}

function ReportBlock({
  title,
  subtitle,
  crates,
  columns,
  schema,
  analyses,
  cutoff,
  pendingCrateIds,
}: {
  title: string;
  subtitle?: string;
  crates: CrateSummary[];
  columns: string[];
  schema: ParsedSchema | undefined;
  analyses: CratePdbAnalysis[];
  cutoff: number;
  pendingCrateIds: Set<string>;
}) {
  const sampleByCrate = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of crates) m.set(c.id, sampleCode(c));
    return m;
  }, [crates]);
  const blockIds = useMemo(() => new Set(crates.map((c) => c.id)), [crates]);
  const blockAnalyses = useMemo(
    () => analyses.filter((a) => blockIds.has(a.crateUuid)),
    [analyses, blockIds],
  );
  const buckets = useMemo(
    () => bucketConsensus(blockAnalyses, sampleByCrate, cutoff),
    [blockAnalyses, sampleByCrate, cutoff],
  );
  const blockPending = crates.some((c) => pendingCrateIds.has(c.id));
  const showConsensus = blockAnalyses.length > 0 || blockPending;

  return (
    <Paper className="p-4 bg-slate-900/70 flex flex-col gap-4">
      <header>
        <h2 className="text-lg font-semibold text-slate-100">{title}</h2>
        {subtitle ? (
          <p className="text-sm text-slate-400">{subtitle}</p>
        ) : null}
      </header>
      {crates.length === 0 ? (
        <p className="text-sm text-slate-500">No crates in this group.</p>
      ) : (
        <>
          {showConsensus ? (
            <section>
              <h3 className="text-sm font-medium text-slate-200 mb-2">
                Consensus PDB
              </h3>
              <ConsensusSection
                buckets={buckets}
                cutoff={cutoff}
                loading={blockPending && blockAnalyses.length === 0}
              />
            </section>
          ) : null}
          <section>
            <h3 className="text-sm font-medium text-slate-200 mb-2">
              Cell lengths
            </h3>
            <CellSplom crates={crates} />
          </section>
          <section>
            <h3 className="text-sm font-medium text-slate-200 mb-2">Stats</h3>
            <StatsTable crates={crates} columns={columns} schema={schema} />
          </section>
        </>
      )}
    </Paper>
  );
}

export default function ReportPage() {
  const book = useBookSearchSync();
  const [cutoff, setCutoff] = useState(DEFAULT_CONSENSUS_CUTOFF);

  const dashUriQuery = useQuery({
    queryKey: ["dashboard-uri-resolved"],
    queryFn: resolveDashboardUri,
  });
  const dashQuery = useQuery({
    queryKey: ["dashboard-config", dashUriQuery.data?.uri],
    queryFn: () => fetchDashboardConfig(dashUriQuery.data!.uri),
    enabled: Boolean(dashUriQuery.data?.uri),
  });
  const schemaQuery = useQuery({
    queryKey: ["linkml-schema", dashQuery.data?.schema_uri],
    queryFn: () => fetchLinkmlSchema(dashQuery.data!.schema_uri),
    enabled: Boolean(dashQuery.data?.schema_uri),
  });
  const cratesQuery = useQuery({
    queryKey: ["crates"],
    queryFn: fetchCrates,
  });
  const placementsQuery = useQuery({
    queryKey: ["project-book-placements"],
    queryFn: fetchPlacements,
  });
  const projectQuery = useQuery({
    queryKey: ["project-book-project", book.projectId],
    queryFn: () => fetchProject(book.projectId!),
    enabled: Boolean(book.projectId),
  });
  const jobsQuery = useQuery({
    queryKey: ["agent-jobs", PDB_LATTICE_AGENT_UUID, "completed"],
    queryFn: () =>
      listJobs({
        agentUuid: PDB_LATTICE_AGENT_UUID,
        status: "completed",
        limit: 500,
      }),
    enabled: Boolean(book.projectId),
  });

  const projectIds = useMemo(
    () => projectCrateIds(placementsQuery.data?.placements ?? [], book.projectId),
    [placementsQuery.data, book.projectId],
  );
  const cratesById = useMemo(() => {
    const m = new Map<string, CrateSummary>();
    for (const c of cratesQuery.data ?? []) m.set(c.id, c);
    return m;
  }, [cratesQuery.data]);

  const projectCrates = useMemo(
    () =>
      [...projectIds]
        .map((id) => cratesById.get(id))
        .filter((c): c is CrateSummary => Boolean(c)),
    [projectIds, cratesById],
  );

  const jobsToFetch = useMemo(() => {
    const latest = latestCompletedPdbJobByCrate(jobsQuery.data ?? []);
    return [...latest.entries()].filter(([uuid]) => projectIds.has(uuid));
  }, [jobsQuery.data, projectIds]);

  const matchQueries = useQueries({
    queries: jobsToFetch.map(([crateUuid, job]) => ({
      queryKey: ["pdb-matches", job.job_uuid],
      queryFn: async (): Promise<CratePdbAnalysis> => {
        const file = await getJobOutputFile(job.job_uuid, PDB_MATCHES_PATH);
        return {
          crateUuid,
          jobUuid: job.job_uuid,
          hits: parsePdbMatches(file),
        };
      },
      retry: false,
    })),
  });

  const analyses = useMemo(
    () =>
      matchQueries
        .filter((q) => q.isSuccess && q.data)
        .map((q) => q.data as CratePdbAnalysis),
    [matchQueries],
  );
  const pendingCrateIds = useMemo(
    () =>
      new Set(
        jobsToFetch
          .filter((_, i) => matchQueries[i]?.isPending)
          .map(([id]) => id),
      ),
    [jobsToFetch, matchQueries],
  );

  const columns = useMemo(() => {
    const items = dashQuery.data?.crate?.metrics?.items ?? FALLBACK_METRIC_SLOTS;
    return items.filter((s) => s !== "sample_code");
  }, [dashQuery.data]);

  const subprojects = useMemo(
    () => walkSubprojects(projectQuery.data?.subprojects ?? []),
    [projectQuery.data],
  );

  if (!book.projectId) {
    return (
      <Paper className="p-6 bg-slate-900/70 max-w-xl">
        <h1 className="text-xl font-semibold text-slate-100 mb-2">Report</h1>
        <p className="text-slate-300">
          Select a project on{" "}
          <Link to="/" className="text-sky-300 hover:text-sky-100 underline">
            Data &amp; Projects
          </Link>{" "}
          to build a summary.
        </p>
      </Paper>
    );
  }

  const project = projectQuery.data;
  const loading =
    cratesQuery.isLoading ||
    placementsQuery.isLoading ||
    projectQuery.isLoading;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">
            {project?.title ?? "Report"}
          </h1>
          <p className="text-sm text-slate-400">
            Project and subproject summary from crate metadata and completed PDB
            searches.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          Consensus cutoff (Å)
          <input
            type="number"
            min={0}
            step={0.1}
            value={Number.isFinite(cutoff) ? cutoff : DEFAULT_CONSENSUS_CUTOFF}
            onChange={(e) => {
              const n = Number(e.target.value);
              setCutoff(Number.isFinite(n) ? n : DEFAULT_CONSENSUS_CUTOFF);
            }}
            className="w-20 rounded border border-slate-600 bg-slate-900 px-2 py-1 font-mono text-slate-100"
          />
        </label>
      </header>

      {loading ? (
        <p className="text-sm text-slate-400">Loading project…</p>
      ) : (
        <>
          <ReportBlock
            title={project?.title ?? "Project"}
            subtitle={`${projectCrates.length} crate${projectCrates.length === 1 ? "" : "s"} on this project`}
            crates={projectCrates}
            columns={columns}
            schema={schemaQuery.data}
            analyses={analyses}
            cutoff={cutoff}
            pendingCrateIds={pendingCrateIds}
          />
          {subprojects.map((sub) => {
            const crates = sub.crate_uuids
              .map((id) => cratesById.get(id))
              .filter((c): c is CrateSummary => Boolean(c));
            return (
              <ReportBlock
                key={sub.id}
                title={sub.title}
                subtitle={
                  crates.length
                    ? `${crates.length} crate${crates.length === 1 ? "" : "s"}`
                    : undefined
                }
                crates={crates}
                columns={columns}
                schema={schemaQuery.data}
                analyses={analyses}
                cutoff={cutoff}
                pendingCrateIds={pendingCrateIds}
              />
            );
          })}
        </>
      )}
    </div>
  );
}
