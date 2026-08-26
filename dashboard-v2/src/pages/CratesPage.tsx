import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Paper } from "@blueskyproject/finch";
import { MagnifyingGlass } from "@phosphor-icons/react";
import CrateCard, { crateSearchHaystack } from "../components/CrateCard";
import MarkerFilterBar, {
  type MarkerFilters,
} from "../components/MarkerFilterBar";
import { resolveDashboardUri } from "../lib/dashboardConfig";
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
} from "../lib/schema";
import { fetchCrates } from "../lib/tiledCrates";
import {
  getTiledApiKey,
  getTiledApiUrl,
  getTiledOrigin,
  probeTiledServer,
} from "../lib/tiledServer";

export default function CratesPage() {
  const [filter, setFilter] = useState("");
  const [markerFilters, setMarkerFilters] = useState<MarkerFilters>({
    minStars: 0,
    colorTag: "any",
    sort: "default",
  });
  const [, markerBump] = useState(0);

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

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["crates"],
    queryFn: fetchCrates,
  });

  const gallery = useMemo(() => {
    if (dashQuery.data) return resolveGallery(dashQuery.data);
    // Don't block the catalog on dashboard YAML — show default cards immediately.
    if (data?.length) return defaultMxGallery();
    return null;
  }, [dashQuery.data, data?.length]);
  const usingFallbackGallery = Boolean(
    !dashQuery.data && Boolean(data?.length),
  );
  const schema = schemaQuery.data;

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const store = getCrateMarkerStore();
    let rows = data ?? [];
    rows = filterCratesByMarkers(rows, markerFilters, store);
    if (q && gallery) {
      rows = rows.filter((c) =>
        crateSearchHaystack(c, gallery, schema).includes(q),
      );
    }
    if (markerFilters.sort !== "default") {
      rows = [...rows].sort((a, b) => {
        const byMarker = compareCratesByMarkers(
          a.id,
          b.id,
          store,
          markerFilters.sort,
        );
        if (byMarker !== 0) return byMarker;
        const sa = String(a.metadata.sample_code ?? a.id);
        const sb = String(b.metadata.sample_code ?? b.id);
        return sa.localeCompare(sb, undefined, { numeric: true });
      });
    } else {
      rows = [...rows].sort((a, b) => {
        const sa = String(a.metadata.sample_code ?? a.id);
        const sb = String(b.metadata.sample_code ?? b.id);
        return sa.localeCompare(sb, undefined, { numeric: true });
      });
    }
    return rows;
  }, [data, filter, gallery, schema, markerFilters]);

  const blurb =
    dashQuery.data?.description ??
    "Browse indexed datasets from the active working set. Search filters within the list below.";

  const searchHint = gallery?.search_slots?.length
    ? `Filter by ${gallery.search_slots
        .slice(0, 3)
        .map((s) => s.replace(/_/g, " "))
        .join(", ")}…`
    : "Filter datasets…";

  const connectionFailed =
    !connectionQuery.isLoading &&
    connectionQuery.data &&
    !connectionQuery.data.ok;

  return (
    <div className="flex flex-col gap-4 w-full h-full min-h-0 overflow-auto">
      {connectionFailed && (
        <Paper className="p-4 bg-rose-950/40 border border-rose-800/60 text-rose-100 text-sm">
          Cannot reach Tiled ({connectionQuery.data?.detail}). Check your
          connection under{" "}
          <Link to="/setup" className="text-sky-300 hover:underline">
            Setup
          </Link>
          .
        </Paper>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-slate-400 max-w-2xl">{blurb}</p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          className="px-3 py-1.5 rounded-md bg-slate-700 text-slate-100 text-sm hover:bg-slate-600"
        >
          {isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="relative max-w-md">
        <MagnifyingGlass
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
        />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={searchHint}
          className="w-full pl-9 pr-3 py-2 rounded-md bg-slate-800 border border-slate-600 text-slate-100 text-sm placeholder:text-slate-500"
        />
      </div>

      <MarkerFilterBar
        filters={markerFilters}
        onChange={setMarkerFilters}
        showSort
      />

      {isLoading && (
        <p className="text-slate-400 text-sm">Loading datasets…</p>
      )}
      {!isLoading && dashQuery.isLoading && data?.length ? (
        <p className="text-slate-500 text-xs">Loading dashboard layout…</p>
      ) : null}
      {error && (
        <Paper className="p-4 text-rose-300 text-sm">
          Failed to load datasets. Check Tiled under{" "}
          <Link to="/setup" className="text-sky-400 hover:underline">
            Setup
          </Link>
          .
          <pre className="mt-2 text-xs whitespace-pre-wrap opacity-80">
            {String(error)}
          </pre>
        </Paper>
      )}
      {dashQuery.error && (
        <Paper className="p-4 text-amber-300 text-sm">
          Dashboard layout unavailable from YAML — showing default cards. Check
          Setup or ensure{" "}
          <code className="text-amber-100">
            {getTiledOrigin()}/schemas/lambda_mx_dashboard.yaml
          </code>{" "}
          is reachable. {String(dashQuery.error)}
        </Paper>
      )}
      {usingFallbackGallery && !dashQuery.error && !dashQuery.isLoading ? (
        <p className="text-xs text-slate-500">
          Using default card layout (dashboard YAML still loading or missing).
        </p>
      ) : null}

      {!isLoading && !error && data?.length === 0 && (
        <Paper className="p-6 text-slate-400 text-sm">
          No datasets in local Tiled yet. Use{" "}
          <Link to="/search" className="text-sky-400 hover:underline">
            Search
          </Link>{" "}
          to store experiments on the local Tiled server.
        </Paper>
      )}

      {!isLoading && !error && (
        <p className="text-xs text-slate-500">
          Showing {filtered.length} of {data?.length ?? 0} datasets
        </p>
      )}

      {gallery && (
        <div style={galleryGridStyle(gallery)}>
          {filtered.map((crate) => (
            <CrateCard
              key={crate.id}
              crate={crate}
              gallery={gallery}
              schema={schema}
              to={`/crates/${crate.id}`}
              state={{ backTo: "/", backLabel: "Data overview" }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
