import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Paper } from "@blueskyproject/finch";
import { MagnifyingGlass, Plus, Trash } from "@phosphor-icons/react";
import CrateCard, { crateSearchHaystack } from "../components/CrateCard";
import LedgerEntryForm from "../components/LedgerEntryForm";
import MarkerFilterBar, {
  type MarkerFilters,
} from "../components/MarkerFilterBar";
import SubprojectTree from "../components/SubprojectTree";
import { resolveDashboardUri } from "../lib/dashboardConfig";
import {
  addLedgerEntry,
  addSubproject,
  createProject,
  deleteLedgerEntry,
  deleteProject,
  deleteSubproject,
  fetchBookSchema,
  fetchPlacements,
  fetchProject,
  fetchProjects,
  parsedSchemaFromDoc,
  resolveBookLayout,
  itemsPerRowGrid,
  findUnsortedSubproject,
  patchProject,
  patchSubproject,
  setSubprojectCrates,
  setSubprojectLedger,
  type LedgerEntry,
  type LedgerSection,
  type Subproject,
} from "../lib/projectBookApi";
import {
  compareCratesByMarkers,
  filterCratesByMarkers,
  getCrateMarkerStore,
  subscribeCrateMarkers,
} from "../lib/crateMarkers";
import {
  defaultMxGallery,
  fetchDashboardConfig,
  fetchLinkmlSchema,
  galleryGridStyle,
  resolveGallery,
  type ParsedSchema,
} from "../lib/schema";
import { readBookContext, writeBookContext } from "../lib/bookContext";
import { fetchCrates } from "../lib/tiledCrates";
import {
  getTiledApiKey,
  getTiledApiUrl,
  probeTiledServer,
} from "../lib/tiledServer";

function useBookSchema() {
  return useQuery({
    queryKey: ["project-book-schema"],
    queryFn: fetchBookSchema,
  });
}

export default function CratesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const projectId = searchParams.get("project") ?? undefined;
  const subId = searchParams.get("sub") ?? undefined;

  function selectProject(id: string, sub?: string) {
    writeBookContext({ projectId: id, subId: sub ?? null });
    const next = new URLSearchParams();
    next.set("project", id);
    if (sub) next.set("sub", sub);
    setSearchParams(next, { replace: true });
  }
  const qc = useQueryClient();
  const [filter, setFilter] = useState("");
  const [markerFilters, setMarkerFilters] = useState<MarkerFilters>({
    minStars: 0,
    colorTag: "any",
    processedData: "any",
    sort: "default",
  });
  const [, markerBump] = useState(0);
  const [newProjectTitle, setNewProjectTitle] = useState("");
  const [newSubTitle, setNewSubTitle] = useState("");
  const [openFormClass, setOpenFormClass] = useState<string | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);

  useEffect(() => subscribeCrateMarkers(() => markerBump((n) => n + 1)), []);

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
    queryKey: ["schema", dashQuery.data?.schema_uri],
    queryFn: () => fetchLinkmlSchema(dashQuery.data!.schema_uri),
    enabled: Boolean(dashQuery.data?.schema_uri),
  });
  const connectionQuery = useQuery({
    queryKey: ["tiled-probe-overview", getTiledApiUrl(), getTiledApiKey()],
    queryFn: () => probeTiledServer(getTiledApiUrl(), getTiledApiKey()),
    retry: false,
  });
  const cratesQuery = useQuery({ queryKey: ["crates"], queryFn: fetchCrates });
  const bookSchemaQuery = useBookSchema();
  const projectsQuery = useQuery({
    queryKey: ["project-book-projects"],
    queryFn: fetchProjects,
  });
  const projectQuery = useQuery({
    queryKey: ["project-book-project", projectId],
    queryFn: () => fetchProject(projectId!),
    enabled: Boolean(projectId),
  });
  const placementsQuery = useQuery({
    queryKey: ["project-book-placements"],
    queryFn: fetchPlacements,
  });

  const gallery = useMemo(() => {
    if (dashQuery.data) return resolveGallery(dashQuery.data);
    if (cratesQuery.data?.length) return defaultMxGallery();
    return null;
  }, [dashQuery.data, cratesQuery.data?.length]);
  const crateSchema = schemaQuery.data;
  const bookSchema = bookSchemaQuery.data
    ? parsedSchemaFromDoc(bookSchemaQuery.data.schema)
    : null;
  const sections: LedgerSection[] =
    bookSchemaQuery.data?.dashboard.ledger?.sections ?? [];
  const bookLayout = resolveBookLayout(bookSchemaQuery.data?.dashboard);

  const filed = useMemo(() => {
    const map = new Map<string, { projectId: string; subId: string; title: string }>();
    for (const p of placementsQuery.data?.placements ?? []) {
      map.set(p.crate_uuid, {
        projectId: p.project_id,
        subId: p.subproject_id,
        title: p.subproject_title,
      });
    }
    return map;
  }, [placementsQuery.data]);

  const inbox = useMemo(() => {
    return (cratesQuery.data ?? []).filter((c) => !filed.has(c.id));
  }, [cratesQuery.data, filed]);

  useEffect(() => {
    if (projectId) {
      writeBookContext({ projectId, subId: subId ?? null });
      return;
    }
    if (!projectsQuery.isSuccess) return;
    const persisted = readBookContext();
    const known = projectsQuery.data?.projects ?? [];
    if (
      persisted.projectId &&
      known.some((p) => p.id === persisted.projectId)
    ) {
      selectProject(persisted.projectId, persisted.subId ?? undefined);
      return;
    }
    const first = known[0];
    if (first) selectProject(first.id);
  }, [projectId, subId, projectsQuery.isSuccess, projectsQuery.data]);

  const selectedSub: Subproject | undefined = projectQuery.data?.subprojects.find(
    (s) => s.id === subId,
  );
  const defaultSubTitle =
    bookSchemaQuery.data?.dashboard.default_subproject_title ?? "Unsorted";
  const fileTarget: Subproject | undefined =
    selectedSub ??
    (projectQuery.data
      ? findUnsortedSubproject(projectQuery.data, defaultSubTitle)
      : undefined);

  const paneCrates = useMemo(() => {
    const all = cratesQuery.data ?? [];
    const ids = new Set(selectedSub?.crate_uuids ?? []);
    let rows = selectedSub ? all.filter((c) => ids.has(c.id)) : [];
    const store = getCrateMarkerStore();
    rows = filterCratesByMarkers(rows, markerFilters, store);
    const q = filter.trim().toLowerCase();
    if (q && gallery) {
      rows = rows.filter((c) =>
        crateSearchHaystack(c, gallery, crateSchema).includes(q),
      );
    }
    return [...rows].sort((a, b) => {
      if (markerFilters.sort !== "default") {
        const byMarker = compareCratesByMarkers(
          a.id,
          b.id,
          store,
          markerFilters.sort,
        );
        if (byMarker !== 0) return byMarker;
      }
      const sa = String(a.metadata.sample_code ?? a.id);
      const sb = String(b.metadata.sample_code ?? b.id);
      return sa.localeCompare(sb, undefined, { numeric: true });
    });
  }, [
    cratesQuery.data,
    selectedSub,
    markerFilters,
    filter,
    gallery,
    crateSchema,
  ]);

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["project-book-projects"] }),
      qc.invalidateQueries({ queryKey: ["project-book-project"] }),
      qc.invalidateQueries({ queryKey: ["project-book-placements"] }),
    ]);
  };

  const createMut = useMutation({
    mutationFn: () => createProject({ title: newProjectTitle }),
    onSuccess: async (rec) => {
      setNewProjectTitle("");
      await invalidate();
      selectProject(rec.id);
    },
  });
  const addSubMut = useMutation({
    mutationFn: () =>
      addSubproject(projectId!, {
        title: newSubTitle,
        parent_id: selectedSub?.id ?? null,
      }),
    onSuccess: async (sub) => {
      setNewSubTitle("");
      await invalidate();
      selectProject(projectId!, sub.id);
    },
  });
  const fileMut = useMutation({
    mutationFn: (crateId: string) => {
      if (!fileTarget) throw new Error("Select a project first");
      return setSubprojectCrates(fileTarget.id, { add: [crateId] });
    },
    onSuccess: invalidate,
  });
  const unfileMut = useMutation({
    mutationFn: (crateId: string) =>
      setSubprojectCrates(selectedSub!.id, { remove: [crateId] }),
    onSuccess: invalidate,
  });

  const connectionFailed =
    !connectionQuery.isLoading &&
    connectionQuery.data &&
    !connectionQuery.data.ok;

  const projects = projectsQuery.data?.projects ?? [];
  const project = projectQuery.data;

  return (
    <div
      className="flex flex-col w-full min-h-0 overflow-auto"
      style={{ gap: bookLayout.page_gap, paddingBottom: bookLayout.page_gap }}
    >
      {connectionFailed && (
        <Paper className="h-auto p-4 bg-rose-950/40 border border-rose-800/60 text-rose-100 text-sm">
          Cannot reach Tiled ({connectionQuery.data?.detail}). Check{" "}
          <Link to="/setup" className="text-sky-300 hover:underline">
            Setup
          </Link>
          .
        </Paper>
      )}

      {bookSchemaQuery.isError && (
        <Paper className="h-auto p-4 bg-amber-950/50 border border-amber-700/60 text-amber-100 text-sm">
          Project Book API is not reachable at {getTiledApiUrl().replace(/\/$/, "")}
          /api/v1/project-book. Ledger, subprojects, and filing stay hidden
          until the client store is up.{" "}
          {bookSchemaQuery.error instanceof Error
            ? bookSchemaQuery.error.message
            : ""}
        </Paper>
      )}

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">
            Data &amp; Projects
          </h1>
          <p className="text-base text-slate-400 max-w-3xl mt-2 leading-relaxed">
            Facility search pulls crates into this store. Inbox crates are not
            assigned to any project. File them into the selected project
            (Unsorted unless a subproject is selected), then organize and run
            workflow against that book.
          </p>
        </div>
        <button
          type="button"
          onClick={() => cratesQuery.refetch()}
          className="px-3.5 py-2 rounded-md bg-slate-700 text-slate-100 text-base hover:bg-slate-600"
        >
          {cratesQuery.isFetching ? "Refreshing…" : "Refresh crates"}
        </button>
      </div>

      <div style={{ display: "grid", gap: bookLayout.form_gap }}>
        <div
          style={itemsPerRowGrid(
            bookLayout.items_per_row,
            bookLayout.chip_gap,
          )}
        >
          {projects.map((p) => {
            const active = p.id === projectId;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => selectProject(p.id)}
                className={`px-4 py-2.5 rounded-lg border text-left min-w-0 ${
                  active
                    ? "border-sky-500 bg-sky-900/50 text-sky-50"
                    : "border-slate-600 bg-slate-800 text-slate-100 hover:border-slate-400"
                }`}
              >
                <div className="text-base font-medium">{p.title}</div>
                <div className="text-sm text-slate-400">
                  {p.subproject_count ?? 0} sub · {p.crate_count ?? 0} crates
                </div>
              </button>
            );
          })}
        </div>
        <form
          className="flex flex-col items-start"
          style={{ gap: bookLayout.form_gap }}
          onSubmit={(e) => {
            e.preventDefault();
            if (newProjectTitle.trim()) createMut.mutate();
          }}
        >
          <input
            value={newProjectTitle}
            onChange={(e) => setNewProjectTitle(e.target.value)}
            placeholder="New project…"
            className="w-full max-w-md px-3 py-2 rounded-md bg-slate-800 border border-slate-600 text-base text-slate-100"
          />
          <button
            type="submit"
            disabled={!newProjectTitle.trim() || createMut.isPending}
            className="inline-flex items-center gap-1 px-3 py-2 rounded-md bg-sky-700 text-white text-base disabled:opacity-50"
          >
            <Plus size={16} /> Project
          </button>
        </form>
      </div>

      {!projectId && (
        <Paper className="h-auto p-4 bg-slate-900/70 text-slate-300 text-sm space-y-2">
          <p>
            Create a project to open the ledger (collaborators, sequences,
            compounds, conditions) and the subproject tree. Crates not assigned
            to any project stay in the inbox below.
          </p>
          {sections.length > 0 && (
            <p className="text-xs text-slate-400">
              Ledger kinds from developer YAML:{" "}
              {sections.map((s) => s.title).join(" · ")}
            </p>
          )}
        </Paper>
      )}

      {project && bookSchema && (
        <div className="min-h-0" style={{ display: "grid", gap: bookLayout.page_gap }}>
          <Paper
            className="h-auto min-w-0 bg-slate-900/70"
            style={{ padding: bookLayout.paper_pad }}
          >
            <div className="flex flex-col" style={{ gap: bookLayout.section_gap }}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-3 min-w-0 flex-1">
                <h2 className="text-xl font-semibold text-slate-100">Ledger</h2>
                <label
                  className="block space-y-2"
                  style={{ maxWidth: bookLayout.narrative_max_width }}
                >
                  <span className="text-sm text-slate-400">Project narrative</span>
                  <textarea
                    defaultValue={project.narrative}
                    key={`nar-${project.id}-${project.updated_at ?? ""}`}
                    onBlur={(e) => {
                      if (e.target.value !== project.narrative) {
                        patchProject(project.id, { narrative: e.target.value }).then(
                          invalidate,
                        );
                      }
                    }}
                    className="w-full min-h-[4.5rem] rounded-md bg-slate-950/70 border border-slate-600 text-slate-100 text-base p-3"
                  />
                </label>
              </div>
              <button
                type="button"
                className="text-sm text-rose-300 hover:underline"
                onClick={async () => {
                  if (!confirm(`Delete project “${project.title}”?`)) return;
                  await deleteProject(project.id);
                  await invalidate();
                  setSearchParams({}, { replace: true });
                }}
              >
                Delete project
              </button>
            </div>
            <div
              className={
                bookLayout.ledger_columns >= 4
                  ? "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4"
                  : bookLayout.ledger_columns === 3
                    ? "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3"
                    : bookLayout.ledger_columns === 1
                      ? "grid grid-cols-1"
                      : "grid grid-cols-1 md:grid-cols-2"
              }
              style={{ gap: bookLayout.section_gap }}
            >
              {sections.map((section) => {
                const rows = (project.ledger ?? []).filter(
                  (e) => e.class_name === section.class,
                );
                const open = openFormClass === section.class;
                return (
                  <div
                    key={section.id}
                    className="min-w-0"
                    style={{ display: "grid", gap: bookLayout.chip_gap }}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <h3 className="text-base font-semibold text-slate-200">
                        {section.title}
                      </h3>
                      <button
                        type="button"
                        className="text-sm text-sky-300 hover:text-sky-200"
                        onClick={() =>
                          setOpenFormClass((c) =>
                            c === section.class ? null : section.class,
                          )
                        }
                      >
                        {open ? "Close" : "Add"}
                      </button>
                    </div>
                    <ul
                      style={itemsPerRowGrid(
                        bookLayout.items_per_row,
                        bookLayout.chip_gap,
                      )}
                    >
                      {rows.length === 0 && !open && (
                        <li className="text-sm text-slate-500">None yet.</li>
                      )}
                      {rows.map((entry) => (
                        <LedgerChip
                          key={entry.id}
                          entry={entry}
                          chipSlots={section.chip_slots}
                          minWidth={bookLayout.chip_min_width}
                          onDelete={async () => {
                            await deleteLedgerEntry(entry.id);
                            await invalidate();
                          }}
                        />
                      ))}
                    </ul>
                    {open && (
                      <LedgerEntryForm
                        schema={bookSchema}
                        section={section}
                        layout={bookLayout}
                        busy={false}
                        onSubmit={async (payload) => {
                          await addLedgerEntry(project.id, {
                            class_name: section.class,
                            payload,
                          });
                          setOpenFormClass(null);
                          await invalidate();
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
            </div>
          </Paper>

          <div
            className="grid grid-cols-1 xl:grid-cols-[minmax(12rem,var(--pb-tree-width))_1fr] items-start"
            style={
              {
                gap: bookLayout.page_gap,
                "--pb-tree-width": bookLayout.tree_width,
              } as CSSProperties
            }
          >
          <Paper
            className="h-auto min-w-0 bg-slate-900/70"
            style={{
              padding: bookLayout.paper_pad,
              display: "flex",
              flexDirection: "column",
              gap: bookLayout.section_gap,
            }}
          >
            <h2 className="text-xl font-semibold text-slate-100">Subprojects</h2>
            <SubprojectTree
              nodes={project.subprojects}
              selectedId={subId ?? null}
              onSelect={(id) => selectProject(project.id, id)}
              chipGap={bookLayout.chip_gap}
              itemsPerRow={bookLayout.items_per_row}
            />
            <form
              className="flex flex-col items-start"
              style={{ gap: bookLayout.form_gap }}
              onSubmit={(e) => {
                e.preventDefault();
                if (newSubTitle.trim()) addSubMut.mutate();
              }}
            >
              <input
                value={newSubTitle}
                onChange={(e) => setNewSubTitle(e.target.value)}
                placeholder={
                  selectedSub
                    ? `Child of ${selectedSub.title}…`
                    : "New subproject…"
                }
                className="w-full px-3 py-2 rounded-md bg-slate-950/70 border border-slate-600 text-base text-slate-100"
              />
              <button
                type="submit"
                disabled={!newSubTitle.trim() || addSubMut.isPending}
                className="px-3 py-2 rounded-md bg-slate-700 text-slate-100 text-base hover:bg-slate-600 disabled:opacity-50"
              >
                Add
              </button>
              {selectedSub && (
                <button
                  type="button"
                  className="text-sm text-rose-300 hover:underline"
                  onClick={async () => {
                    if (!confirm(`Delete “${selectedSub.title}”?`)) return;
                    await deleteSubproject(selectedSub.id);
                    await invalidate();
                    selectProject(project.id);
                  }}
                >
                  Delete selected
                </button>
              )}
            </form>
          </Paper>

          <div className="space-y-5 min-w-0">
            {selectedSub ? (
              <Paper
                className="h-auto bg-slate-900/70"
                style={{
                  padding: bookLayout.paper_pad,
                  display: "flex",
                  flexDirection: "column",
                  gap: bookLayout.section_gap,
                }}
              >
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-xl font-semibold text-slate-100">
                    {selectedSub.title}
                  </h2>
                  <span className="text-sm text-slate-400">
                    {selectedSub.crate_uuids.length} filed
                  </span>
                </div>
                <label
                  className="block space-y-2"
                  style={{ maxWidth: bookLayout.narrative_max_width }}
                >
                  <span className="text-sm text-slate-400">Narrative</span>
                  <textarea
                    defaultValue={selectedSub.narrative}
                    key={`subnar-${selectedSub.id}-${selectedSub.updated_at ?? ""}`}
                    onBlur={(e) => {
                      if (e.target.value !== selectedSub.narrative) {
                        patchSubproject(selectedSub.id, {
                          narrative: e.target.value,
                        }).then(invalidate);
                      }
                    }}
                    className="w-full min-h-[4.5rem] rounded-md bg-slate-950/70 border border-slate-600 text-slate-100 text-base p-3"
                  />
                </label>
                <div className="space-y-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="text-base font-semibold text-slate-200">
                      Assigned from ledger
                    </h3>
                    <button
                      type="button"
                      className="text-sm text-sky-300 hover:text-sky-200"
                      onClick={() => setAssignOpen((v) => !v)}
                    >
                      {assignOpen ? "Done" : "Assign…"}
                    </button>
                  </div>
                  <AssignedList
                    projectLedger={project.ledger ?? []}
                    assignedIds={selectedSub.ledger_entry_ids}
                    sections={sections}
                    chipGap={bookLayout.chip_gap}
                    itemsPerRow={bookLayout.items_per_row}
                  />
                  {assignOpen && (
                    <AssignPicker
                      ledger={project.ledger ?? []}
                      assignedIds={new Set(selectedSub.ledger_entry_ids)}
                      sections={sections}
                      chipGap={bookLayout.chip_gap}
                      itemsPerRow={bookLayout.items_per_row}
                      onToggle={async (entryId, on) => {
                        await setSubprojectLedger(selectedSub.id, {
                          add: on ? [entryId] : [],
                          remove: on ? [] : [entryId],
                        });
                        await invalidate();
                      }}
                    />
                  )}
                </div>
                <div className="relative w-72 max-w-full">
                  <MagnifyingGlass
                    size={18}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Filter filed crates…"
                    className="w-full pl-10 pr-3 py-2 rounded-md bg-slate-800 border border-slate-600 text-slate-100 text-base"
                  />
                </div>
                <MarkerFilterBar
                  filters={markerFilters}
                  onChange={setMarkerFilters}
                  showSort
                />
                {gallery && (
                  <div style={galleryGridStyle(gallery)}>
                    {paneCrates.map((crate) => (
                      <CrateCard
                        key={crate.id}
                        crate={crate}
                        gallery={gallery}
                        schema={crateSchema}
                        to={`/crates/${crate.id}`}
                        state={{
                          backTo: `/?project=${project.id}&sub=${selectedSub.id}`,
                          backLabel: selectedSub.title,
                        }}
                        overlay={
                          <button
                            type="button"
                            title="Unfile"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              unfileMut.mutate(crate.id);
                            }}
                            className="p-1 rounded bg-slate-900/80 text-rose-300"
                          >
                            <Trash size={14} />
                          </button>
                        }
                      />
                    ))}
                  </div>
                )}
                {paneCrates.length === 0 && (
                  <p className="text-sm text-slate-500">
                    No crates in this subproject. File from the inbox.
                  </p>
                )}
              </Paper>
            ) : (
              <Paper
                className="h-auto bg-slate-900/70 text-slate-400 text-base"
                style={{ padding: bookLayout.paper_pad }}
              >
                Select a subproject to see its narrative, assigned ledger rows,
                and crates.
              </Paper>
            )}
          </div>
          </div>
        </div>
      )}

      <InboxStrip
        crates={inbox}
        gallery={gallery}
        schema={crateSchema}
        canFile={Boolean(fileTarget)}
        fileHint={
          fileTarget
            ? `File into ${projectQuery.data?.title ?? "project"} / ${fileTarget.title}`
            : undefined
        }
        onFile={(id) => fileMut.mutate(id)}
        busy={fileMut.isPending}
        paperPad={bookLayout.paper_pad}
        pageGap={bookLayout.page_gap}
      />

      {cratesQuery.error && (
        <Paper className="h-auto p-4 bg-slate-900/70 text-rose-300 text-sm">
          Failed to load datasets. {String(cratesQuery.error)}
        </Paper>
      )}
    </div>
  );
}

function chipHint(entry: LedgerEntry, slots?: string[]): string {
  const payload = entry.payload ?? {};
  const keys =
    slots?.length
      ? slots
      : ["role", "sequence_type", "condition_type", "formula", "affiliation"];
  const bits: string[] = [];
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) bits.push(value.trim());
  }
  return bits.join(" · ");
}

function LedgerChip({
  entry,
  chipSlots,
  minWidth,
  onDelete,
}: {
  entry: LedgerEntry;
  chipSlots?: string[];
  minWidth?: string;
  onDelete: () => void;
}) {
  const hint = chipHint(entry, chipSlots);
  return (
    <li
      className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-3.5 py-2 text-base text-slate-100 min-w-0"
      style={{ minWidth }}
    >
      <span className="font-medium">{entry.label || entry.id.slice(0, 8)}</span>
      {hint ? <span className="text-sm text-slate-400">{hint}</span> : null}
      <button
        type="button"
        onClick={onDelete}
        className="text-rose-300 hover:text-rose-200"
        title="Remove from ledger"
      >
        <Trash size={14} />
      </button>
    </li>
  );
}

function AssignedList({
  projectLedger,
  assignedIds,
  sections,
  chipGap,
  itemsPerRow,
}: {
  projectLedger: LedgerEntry[];
  assignedIds: string[];
  sections: LedgerSection[];
  chipGap: string;
  itemsPerRow: number;
}) {
  const assigned = projectLedger.filter((e) => assignedIds.includes(e.id));
  if (!assigned.length) {
    return <p className="text-sm text-slate-500">None assigned.</p>;
  }
  return (
    <ul style={itemsPerRowGrid(itemsPerRow, chipGap)}>
      {assigned.map((e) => (
        <li
          key={e.id}
          className="inline-flex items-baseline gap-2 rounded-lg bg-slate-800 px-3.5 py-2 text-base text-slate-100"
        >
          <span className="text-sm text-slate-400">
            {sections.find((s) => s.class === e.class_name)?.title ?? e.class_name}
          </span>
          {e.label}
        </li>
      ))}
    </ul>
  );
}

function AssignPicker({
  ledger,
  assignedIds,
  sections,
  onToggle,
  chipGap,
  itemsPerRow,
}: {
  ledger: LedgerEntry[];
  assignedIds: Set<string>;
  sections: LedgerSection[];
  onToggle: (id: string, on: boolean) => void;
  chipGap: string;
  itemsPerRow: number;
}) {
  return (
    <div className="rounded-md border border-slate-700 p-4 space-y-4">
      {sections.map((section) => {
        const rows = ledger.filter((e) => e.class_name === section.class);
        if (!rows.length) return null;
        return (
          <div key={section.id} className="space-y-3">
            <div className="text-sm font-medium text-slate-400">
              {section.title}
            </div>
            <div style={itemsPerRowGrid(itemsPerRow, chipGap)}>
              {rows.map((e) => {
                const on = assignedIds.has(e.id);
                return (
                  <label
                    key={e.id}
                    className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-base cursor-pointer ${
                      on
                        ? "bg-sky-800/80 text-sky-50 ring-1 ring-sky-400/60"
                        : "bg-slate-800 text-slate-100 hover:bg-slate-700"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={on}
                      onChange={(ev) => onToggle(e.id, ev.target.checked)}
                    />
                    {e.label}
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function InboxStrip({
  crates,
  gallery,
  schema,
  canFile,
  fileHint,
  onFile,
  busy,
  paperPad,
  pageGap,
}: {
  crates: import("../lib/tiledCrates").CrateSummary[];
  gallery: ReturnType<typeof resolveGallery> | ReturnType<typeof defaultMxGallery> | null;
  schema?: ParsedSchema;
  canFile: boolean;
  fileHint?: string;
  onFile: (id: string) => void;
  busy: boolean;
  paperPad: string;
  pageGap: string;
}) {
  return (
    <Paper
      className="h-auto bg-slate-900/70"
      style={{
        padding: paperPad,
        display: "flex",
        flexDirection: "column",
        gap: pageGap,
      }}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-slate-100">
          Inbox · not assigned to any project
        </h2>
        <span className="text-sm text-slate-400">{crates.length}</span>
      </div>
      {!canFile ? (
        <p className="text-base text-slate-500">
          Select a project to file crates into it (Unsorted unless a subproject
          is selected).
        </p>
      ) : fileHint ? (
        <p className="text-base text-slate-500">{fileHint}</p>
      ) : null}
      {crates.length === 0 && (
        <p className="text-base text-slate-500">
          All local crates are assigned to a project, or none have been pulled
          yet. Use{" "}
          <Link to="/search" className="text-sky-400 hover:underline">
            Search
          </Link>
          .
        </p>
      )}
      {gallery && crates.length > 0 && (
        <div style={galleryGridStyle(gallery)}>
          {crates.map((crate) => (
            <CrateCard
              key={crate.id}
              crate={crate}
              gallery={gallery}
              schema={schema}
              to={`/crates/${crate.id}`}
              state={{ backTo: "/", backLabel: "Data & Projects" }}
              overlay={
                canFile ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onFile(crate.id);
                    }}
                    className="px-2 py-0.5 rounded bg-sky-800 text-sky-50 text-xs"
                  >
                    File
                  </button>
                ) : null
              }
            />
          ))}
        </div>
      )}
    </Paper>
  );
}
