import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Paper } from "@blueskyproject/finch";
import { Selection } from "@phosphor-icons/react";
import CrateCard from "../components/CrateCard";
import PushToNotesButton from "../components/PushToNotesButton";
import { addToCart, getCartIds, replaceCart, subscribeCart } from "../lib/crateCart";
import { resolveDashboardUri } from "../lib/dashboardConfig";
import {
  clearPlotSelection,
  getPlotSelection,
  subscribePlotSelection,
} from "../lib/plotSelection";
import {
  fetchDashboardConfig,
  fetchLinkmlSchema,
  galleryGridStyle,
  resolveGallery,
} from "../lib/schema";
import { fetchCrates, type CrateSummary } from "../lib/tiledCrates";

export default function SelectionPage() {
  const [selection, setSelection] = useState(getPlotSelection);
  const [cartCount, setCartCount] = useState(() => getCartIds().length);

  useEffect(() => subscribePlotSelection(() => setSelection(getPlotSelection())), []);
  useEffect(() => subscribeCart(() => setCartCount(getCartIds().length)), []);

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

  const gallery = dashQuery.data ? resolveGallery(dashQuery.data) : null;

  const cratesById = useMemo(() => {
    const map = new Map<string, CrateSummary>();
    for (const c of cratesQuery.data ?? []) {
      map.set(c.id, c);
    }
    return map;
  }, [cratesQuery.data]);

  const items = selection.ids.map((id) => ({
    id,
    crate: cratesById.get(id) ?? { id, metadata: {} },
  }));

  return (
    <div className="flex flex-col gap-4 p-4 w-full min-h-0 overflow-auto max-w-3xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100 inline-flex items-center gap-2">
            <Selection size={28} />
            Plot selection
            <span className="text-base font-normal text-slate-400">
              ({selection.ids.length})
            </span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Datasets from plot brushing or lasso. Add to cart when ready.
          </p>
          {selection.source && (
            <p className="text-xs text-slate-500 mt-1 font-mono">
              from {selection.source}
            </p>
          )}
        </div>
        <Link
          to="/plots"
          className="px-3 py-1.5 rounded-md bg-slate-700 text-slate-100 text-sm hover:bg-slate-600 no-underline"
        >
          Back to plots
        </Link>
      </div>

      <Paper className="p-4 bg-slate-900/70 space-y-3">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={selection.ids.length === 0}
            onClick={() => addToCart(selection.ids)}
            className="px-3 py-1.5 rounded-md bg-sky-700 text-slate-100 text-sm hover:bg-sky-600 disabled:opacity-40"
          >
            Add to cart
          </button>
          <button
            type="button"
            disabled={selection.ids.length === 0}
            onClick={() => replaceCart(selection.ids)}
            className="px-3 py-1.5 rounded-md bg-slate-700 text-slate-100 text-sm hover:bg-slate-600 disabled:opacity-40"
          >
            Replace cart
          </button>
          <button
            type="button"
            disabled={selection.ids.length === 0}
            onClick={() => clearPlotSelection()}
            className="px-3 py-1.5 rounded-md bg-slate-800 text-slate-300 text-sm hover:bg-slate-700 disabled:opacity-40"
          >
            Clear selection
          </button>
          <Link
            to="/workflow/cart"
            className="px-3 py-1.5 rounded-md bg-emerald-800/80 text-emerald-100 text-sm hover:bg-emerald-700 no-underline"
          >
            Open cart ({cartCount})
          </Link>
          <PushToNotesButton
            crates={selection.ids.map((id) => {
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
        {selection.ids.length === 0 && (
          <p className="text-sm text-slate-400">
            No active selection. On{" "}
            <Link to="/plots" className="text-sky-400 hover:underline">
              Plots
            </Link>
            , expand a chart and brush or lasso datasets — the selection appears
            here. Then add to cart and export from the Workflow tabs.
          </p>
        )}
      </Paper>

      {gallery && selection.ids.length > 0 && (
        <div style={galleryGridStyle(gallery)}>
          {items.map(({ id, crate }) => (
            <CrateCard
              key={id}
              crate={crate}
              gallery={gallery}
              schema={schemaQuery.data}
              to={`/crates/${id}`}
              state={{ backTo: "/workflow/selection", backLabel: "Selection" }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
