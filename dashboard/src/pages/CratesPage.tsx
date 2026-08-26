import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Paper } from "@blueskyproject/finch";
import { MagnifyingGlass } from "@phosphor-icons/react";
import CrateCard, { crateSearchHaystack } from "../components/CrateCard";
import { resolveDashboardUri } from "../lib/dashboardConfig";
import {
  fetchDashboardConfig,
  fetchLinkmlSchema,
  galleryGridStyle,
  resolveGallery,
} from "../lib/schema";
import { fetchCrates } from "../lib/tiledCrates";
import {
  getTiledApiKey,
  getTiledApiUrl,
  probeTiledServer,
} from "../lib/tiledServer";

export default function CratesPage() {
  const [filter, setFilter] = useState("");

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

  const gallery = dashQuery.data ? resolveGallery(dashQuery.data) : null;
  const schema = schemaQuery.data;

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!data) return [];
    if (!q || !gallery) return data;
    return data.filter((c) =>
      crateSearchHaystack(c, gallery, schema).includes(q),
    );
  }, [data, filter, gallery, schema]);

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

      {(isLoading || dashQuery.isLoading) && (
        <p className="text-slate-400 text-sm">Loading datasets…</p>
      )}
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
          Dashboard layout unavailable — cards need gallery settings from YAML.{" "}
          {String(dashQuery.error)}
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
