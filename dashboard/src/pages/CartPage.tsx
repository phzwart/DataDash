import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Paper } from "@blueskyproject/finch";
import { ShoppingCart } from "@phosphor-icons/react";
import CrateCard from "../components/CrateCard";
import PushToNotesButton from "../components/PushToNotesButton";
import {
  clearCart,
  getCartIds,
  removeFromCart,
  subscribeCart,
} from "../lib/crateCart";
import { resolveDashboardUri } from "../lib/dashboardConfig";
import {
  fetchDashboardConfig,
  fetchLinkmlSchema,
  galleryGridStyle,
  resolveGallery,
} from "../lib/schema";
import { fetchCrates, type CrateSummary } from "../lib/tiledCrates";

export default function CartPage() {
  const [cartIds, setCartIds] = useState(() => getCartIds());

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

  return (
    <div className="flex flex-col gap-4 p-4 w-full h-full min-h-0 overflow-auto">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100 inline-flex items-center gap-2">
            <ShoppingCart size={28} />
            Cart
            <span className="text-base font-normal text-slate-400">
              ({cartIds.length})
            </span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Datasets saved from plot selections. Open a card to inspect.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            to="/plots"
            className="px-3 py-1.5 rounded-md bg-slate-700 text-slate-100 text-sm hover:bg-slate-600 no-underline"
          >
            Back to plots
          </Link>
          <Link
            to="/workflow/export"
            className="px-3 py-1.5 rounded-md bg-sky-700 text-slate-100 text-sm hover:bg-sky-600 no-underline"
          >
            Export cart
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
            Clear cart
          </button>
        </div>
      </div>

      {cartIds.length === 0 && (
        <Paper className="p-6 text-slate-400 text-sm">
          Cart is empty. Brush on{" "}
          <Link to="/plots" className="text-sky-400 hover:underline">
            Plots
          </Link>
          →{" "}
          <Link to="/workflow/selection" className="text-sky-400 hover:underline">
            Selection
          </Link>
          → add to cart →{" "}
          <Link to="/workflow/export" className="text-sky-400 hover:underline">
            Export
          </Link>
          .
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
              state={{ backTo: "/workflow/cart", backLabel: "Cart" }}
              overlay={
                <button
                  type="button"
                  title="Remove from cart"
                  onClick={() => removeFromCart(id)}
                  className="absolute top-3 right-3 z-10 w-7 h-7 rounded-md bg-slate-800/90 text-slate-300 text-sm hover:bg-rose-900 hover:text-rose-100"
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
