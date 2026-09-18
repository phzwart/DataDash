import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Paper } from "@blueskyproject/finch";
import { Selection } from "@phosphor-icons/react";
import AssignSelectionBar from "../components/AssignSelectionBar";
import CrateCard from "../components/CrateCard";
import MarkerFilterBar, {
  type MarkerFilters,
} from "../components/MarkerFilterBar";
import PushToNotesButton from "../components/PushToNotesButton";
import { useBookSearchSync } from "../lib/bookContext";
import {
  compareCratesByMarkers,
  filterCratesByMarkers,
  getCrateMarkerStore,
  subscribeCrateMarkers,
} from "../lib/crateMarkers";
import { resolveDashboardUri } from "../lib/dashboardConfig";
import {
  clearPlotSelection,
  getPlotSelection,
  removeFromPlotSelection,
  subscribePlotSelection,
} from "../lib/plotSelection";
import {
  fetchDashboardConfig,
  fetchLinkmlSchema,
  galleryGridStyle,
  resolveGallery,
} from "../lib/schema";
import { fetchPlacements } from "../lib/projectBookApi";
import { filterOrganizeUniverse } from "../lib/organizeScope";
import { fetchCrates, type CrateSummary } from "../lib/tiledCrates";

export default function SelectionPage() {
  const book = useBookSearchSync();
  const [selection, setSelection] = useState(getPlotSelection);
  const [markerFilters, setMarkerFilters] = useState<MarkerFilters>({
    minStars: 0,
    colorTag: "any",
    processedData: "any",
    sort: "default",
  });
  const [, markerBump] = useState(0);

  useEffect(() => subscribePlotSelection(() => setSelection(getPlotSelection())), []);
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

  const cratesQuery = useQuery({
    queryKey: ["crates"],
    queryFn: fetchCrates,
  });
  const placementsQuery = useQuery({
    queryKey: ["project-book-placements"],
    queryFn: fetchPlacements,
  });

  const gallery = dashQuery.data ? resolveGallery(dashQuery.data) : null;

  const cratesById = useMemo(() => {
    const map = new Map<string, CrateSummary>();
    for (const c of cratesQuery.data ?? []) {
      map.set(c.id, c);
    }
    return map;
  }, [cratesQuery.data]);

  const universeIds = useMemo(() => {
    const scoped = filterOrganizeUniverse(
      cratesQuery.data ?? [],
      placementsQuery.data?.placements ?? [],
      book,
    );
    return new Set(scoped.map((c) => c.id));
  }, [cratesQuery.data, placementsQuery.data, book]);

  const scopedIds = useMemo(
    () => selection.ids.filter((id) => universeIds.has(id)),
    [selection.ids, universeIds],
  );

  const allItems = useMemo(
    () =>
      scopedIds.map((id) => ({
        id,
        crate: cratesById.get(id) ?? { id, metadata: {} },
      })),
    [scopedIds, cratesById],
  );

  const filteredItems = useMemo(() => {
    const store = getCrateMarkerStore();
    let rows = filterCratesByMarkers(allItems, markerFilters, store);
    if (markerFilters.sort !== "default") {
      rows = [...rows].sort((a, b) =>
        compareCratesByMarkers(a.id, b.id, store, markerFilters.sort),
      );
    }
    return rows;
  }, [allItems, markerFilters, markerBump]);

  const filteredIds = useMemo(
    () => filteredItems.map((item) => item.id),
    [filteredItems],
  );

  const markerFilterActive =
    markerFilters.minStars > 0 ||
    markerFilters.colorTag !== "any" ||
    markerFilters.sort !== "default";

  const selectionCountLabel =
    scopedIds.length === 0
      ? "(0)"
      : filteredItems.length !== scopedIds.length
        ? `(${filteredItems.length} of ${scopedIds.length})`
        : `(${scopedIds.length})`;

  return (
    <div className="flex flex-col gap-4 p-4 w-full min-h-0 overflow-auto">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100 inline-flex items-center gap-2">
            <Selection size={28} />
            Organize selection
            <span className="text-base font-normal text-slate-400">
              {selectionCountLabel}
            </span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Crates in the current Organize scope that are also in the session
            selection. Assign them to a project or subproject, then run that
            set on Work.
          </p>
          {selection.source && (
            <p className="text-xs text-slate-500 mt-1 font-mono">
              from {selection.source}
            </p>
          )}
        </div>
        <Link
          to="/organize"
          className="px-3 py-1.5 rounded-md bg-slate-700 text-slate-100 text-sm hover:bg-slate-600 no-underline"
        >
          Back to Organize
        </Link>
      </div>

      <Paper className="p-4 bg-slate-900/70 space-y-3">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={scopedIds.length === 0}
            onClick={() => clearPlotSelection()}
            className="px-3 py-1.5 rounded-md bg-slate-800 text-slate-300 text-sm hover:bg-slate-700 disabled:opacity-40"
          >
            Clear selection
          </button>
          <Link
            to="/work/run"
            className="px-3 py-1.5 rounded-md bg-emerald-800/80 text-emerald-100 text-sm hover:bg-emerald-700 no-underline"
          >
            Open Work
          </Link>
          <PushToNotesButton
            crates={filteredIds.map((id) => {
              const crate = cratesById.get(id);
              const label =
                (gallery && crate
                  ? String(crate.metadata[gallery.title] ?? "")
                  : "") || id;
              return { id, label };
            })}
            label="Push to notes"
          />
        </div>
        <AssignSelectionBar crateIds={filteredIds} projectId={book.projectId} />
        {scopedIds.length === 0 && (
          <p className="text-sm text-slate-400">
            No crates in both the Organize scope and the session selection. On{" "}
            <Link to="/organize" className="text-sky-400 hover:underline">
              Organize
            </Link>
            , set inbox / project / all, then brush or lasso. Or pick a project
            on{" "}
            <Link to="/" className="text-sky-400 hover:underline">
              Data &amp; Projects
            </Link>
            .
          </p>
        )}
      </Paper>

      {scopedIds.length > 0 && (
        <MarkerFilterBar
          filters={markerFilters}
          onChange={setMarkerFilters}
          showSort
        />
      )}

      {scopedIds.length > 0 && markerFilterActive && (
        <p className="text-xs text-slate-500">
          Showing {filteredItems.length} of {scopedIds.length} in selection
          {filteredItems.length === 0 ? " — try relaxing marker filters" : ""}
        </p>
      )}

      {gallery && filteredItems.length > 0 && (
        <div style={galleryGridStyle(gallery)}>
          {filteredItems.map(({ id, crate }) => (
            <CrateCard
              key={id}
              crate={crate}
              gallery={gallery}
              schema={schemaQuery.data}
              to={`/crates/${id}`}
              state={{ backTo: "/work/selection", backLabel: "Selection" }}
              overlay={
                <button
                  type="button"
                  title="Remove from selection"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    removeFromPlotSelection(id);
                  }}
                  className="w-7 h-7 rounded-md bg-slate-800/90 text-slate-300 text-sm hover:bg-rose-900 hover:text-rose-100"
                >
                  ×
                </button>
              }
            />
          ))}
        </div>
      )}

      {gallery && scopedIds.length > 0 && filteredItems.length === 0 && (
        <Paper className="p-6 text-slate-400 text-sm">
          No datasets in the current selection match these marker filters.
        </Paper>
      )}
    </div>
  );
}
