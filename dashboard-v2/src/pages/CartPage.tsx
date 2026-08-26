import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Paper } from "@blueskyproject/finch";
import { CloudArrowDown, HardDrives } from "@phosphor-icons/react";
import CrateCard from "../components/CrateCard";
import PushToNotesButton from "../components/PushToNotesButton";
import {
  clearCart,
  getCartIds,
  removeFromCart,
  subscribeCart,
} from "../lib/crateCart";
import { resolveDashboardUri } from "../lib/dashboardConfig";
import { getFacilityUrl } from "../lib/facilityApi";
import { getHydrateUrl, storeCratesToLocalTiled } from "../lib/hydrateApi";
import {
  fetchDashboardConfig,
  fetchLinkmlSchema,
  galleryGridStyle,
  resolveGallery,
} from "../lib/schema";
import { fetchCrates, type CrateSummary } from "../lib/tiledCrates";

export default function CartPage() {
  const queryClient = useQueryClient();
  const [cartIds, setCartIds] = useState(() => getCartIds());
  const [storeMessage, setStoreMessage] = useState<string | null>(null);

  useEffect(() => subscribeCart(() => setCartIds(getCartIds())), []);

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

  const storeMutation = useMutation({
    mutationFn: () => storeCratesToLocalTiled(getCartIds()),
    onSuccess: (result) => {
      const n = result.count ?? result.hydrated?.length ?? 0;
      const errs = result.error_count ?? result.errors?.length ?? 0;
      setStoreMessage(
        errs > 0
          ? `Stored ${n} experiment(s) on the local Tiled server with ${errs} error(s). Check client_store logs.`
          : `Stored ${n} experiment(s) on the local Tiled server. Open Data Overview / Plots.`,
      );
      void queryClient.invalidateQueries({ queryKey: ["crates"] });
    },
    onError: (err) => {
      setStoreMessage(err instanceof Error ? err.message : String(err));
    },
  });

  const gallery = dashQuery.data ? resolveGallery(dashQuery.data) : null;

  const cratesById = useMemo(() => {
    const map = new Map<string, CrateSummary>();
    for (const c of cratesQuery.data ?? []) {
      map.set(c.id, c);
    }
    return map;
  }, [cratesQuery.data]);

  const items = cartIds.map((id) => ({
    id,
    crate: cratesById.get(id) ?? { id, metadata: {} },
  }));

  const hydratedCount = cartIds.filter((id) => cratesById.has(id)).length;

  return (
    <div className="flex flex-col gap-4 p-4 w-full h-full min-h-0 overflow-auto">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100 inline-flex items-center gap-2">
            <HardDrives size={28} />
            Action queue
            <span className="text-base font-normal text-slate-400">
              ({cartIds.length})
            </span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Staging area for experiment UUIDs from{" "}
            <Link to="/workflow/selection" className="text-sky-400 hover:underline">
              plot selection
            </Link>
            . Store downloads RO-Crates + sidecars onto the local Tiled server
            ({hydratedCount}/{cartIds.length} already stored). Facility:{" "}
            <code className="text-slate-300">{getFacilityUrl()}</code> → local:{" "}
            <code className="text-slate-300">{getHydrateUrl()}</code>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/search"
            className="px-3 py-1.5 rounded-md bg-slate-700 text-slate-100 text-sm hover:bg-slate-600 no-underline"
          >
            Search
          </Link>
          <button
            type="button"
            disabled={cartIds.length === 0 || storeMutation.isPending}
            onClick={() => {
              setStoreMessage(null);
              storeMutation.mutate();
            }}
            className="px-3 py-1.5 rounded-md bg-emerald-700 text-white text-sm hover:bg-emerald-600 disabled:opacity-40 inline-flex items-center gap-2"
          >
            <CloudArrowDown size={16} />
            {storeMutation.isPending
              ? "Storing…"
              : "Store to local Tiled server"}
          </button>
          <Link
            to="/workflow/export"
            className="px-3 py-1.5 rounded-md bg-sky-700 text-slate-100 text-sm hover:bg-sky-600 no-underline"
          >
            Export action queue
          </Link>
          <PushToNotesButton
            crates={cartIds.map((id) => {
              const crate = cratesById.get(id);
              const label =
                (gallery && crate
                  ? String(crate.metadata[gallery.title] ?? "")
                  : "") || id;
              return { id, label };
            })}
            label="Push to notes"
          />
          <button
            type="button"
            disabled={cartIds.length === 0}
            onClick={() => clearCart()}
            className="px-3 py-1.5 rounded-md bg-rose-900/70 text-rose-100 text-sm hover:bg-rose-800 disabled:opacity-40"
          >
            Clear action queue
          </button>
        </div>
      </div>

      {storeMessage && (
        <p
          className={`text-sm ${
            storeMutation.isError ? "text-rose-300" : "text-emerald-300"
          }`}
        >
          {storeMessage}
        </p>
      )}

      {cartIds.length === 0 && (
        <Paper className="p-6 text-slate-400 text-sm">
          Action queue is empty. On{" "}
          <Link to="/plots" className="text-sky-400 hover:underline">
            Plots
          </Link>
          , brush or lasso datasets, add them to the action queue, then store to
          the local Tiled server. Facility search stores selections directly — no
          action queue needed.
        </Paper>
      )}

      {cratesQuery.isLoading && cartIds.length > 0 && (
        <p className="text-slate-400 text-sm">Loading dataset metadata…</p>
      )}

      {gallery && (
        <div style={galleryGridStyle(gallery)}>
          {items.map(({ id, crate }) => (
            <CrateCard
              key={id}
              crate={crate}
              gallery={gallery}
              schema={schemaQuery.data}
              to={`/crates/${id}`}
              state={{ backTo: "/workflow/cart", backLabel: "Action queue" }}
              overlay={
                <button
                  type="button"
                  title="Remove from action queue"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    removeFromCart(id);
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
    </div>
  );
}
