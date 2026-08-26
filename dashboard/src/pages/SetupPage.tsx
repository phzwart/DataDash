import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Paper } from "@blueskyproject/finch";
import BrowsePage from "./BrowsePage";
import CollapsibleSection from "../components/CollapsibleSection";
import SchemaFilesSection from "../components/SchemaFilesSection";
import {
  clearStoredCollectionUri,
  EXAMPLE_COLLECTION_URI,
  exampleCollectionUri,
  fetchCollectionConfig,
  resolveCollectionUri,
  setStoredCollectionUri,
} from "../lib/collectionConfig";
import {
  clearStoredDashboardUri,
  DEFAULT_DASHBOARD_URI,
  defaultDashboardUri,
  fetchTiledDefaultDashboardUri,
  getStoredDashboardUri,
  resolveDashboardUri,
  setStoredDashboardUri,
} from "../lib/dashboardConfig";
import { fetchDashboardConfig } from "../lib/schema";
import { fetchAllCrates, fetchCrates } from "../lib/tiledCrates";
import {
  clearStoredTiledServer,
  ENV_TILED_API_KEY,
  ENV_TILED_API_URL,
  getStoredTiledApiUrl,
  getTiledApiKey,
  getTiledApiUrl,
  getTiledOrigin,
  probeTiledServer,
  setStoredTiledServer,
  TILED_SERVER_CHANGED,
} from "../lib/tiledServer";

type SectionKey = "workingSet" | "layout" | "schemas" | "catalog";

function hashSection(): SectionKey | null {
  const id = window.location.hash.replace(/^#/, "");
  if (id === "schemas") return "schemas";
  if (id === "catalog-browser") return "catalog";
  return null;
}

export default function SetupPage() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const [dashDraft, setDashDraft] = useState("");
  const [collDraft, setCollDraft] = useState("");
  const [tiledUrlDraft, setTiledUrlDraft] = useState(() => getTiledApiUrl());
  const [tiledKeyDraft, setTiledKeyDraft] = useState(() => getTiledApiKey());
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [sections, setSections] = useState<Record<SectionKey, boolean>>({
    workingSet: false,
    layout: false,
    schemas: false,
    catalog: false,
  });

  const tiledProbeQuery = useQuery({
    queryKey: ["tiled-probe", tiledUrlDraft, tiledKeyDraft],
    queryFn: () => probeTiledServer(tiledUrlDraft, tiledKeyDraft),
    enabled: Boolean(tiledUrlDraft.trim()),
    retry: false,
  });

  const resolvedDashQuery = useQuery({
    queryKey: ["dashboard-uri-resolved"],
    queryFn: resolveDashboardUri,
  });

  const resolvedCollQuery = useQuery({
    queryKey: ["collection-uri-resolved"],
    queryFn: () => Promise.resolve(resolveCollectionUri()),
  });

  const tiledDefaultQuery = useQuery({
    queryKey: ["dashboard-uri-tiled"],
    queryFn: fetchTiledDefaultDashboardUri,
  });

  useEffect(() => {
    if (resolvedDashQuery.data) {
      setDashDraft(resolvedDashQuery.data.uri);
    }
  }, [resolvedDashQuery.data]);

  useEffect(() => {
    setCollDraft(resolvedCollQuery.data?.uri ?? "");
  }, [resolvedCollQuery.data]);

  useEffect(() => {
    const open = hashSection();
    if (open) {
      setSections((s) => ({ ...s, [open]: true }));
    }
  }, [location.hash]);

  useEffect(() => {
    const onDash = () => {
      void queryClient.invalidateQueries({ queryKey: ["dashboard-uri-resolved"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard-config"] });
    };
    const onColl = () => {
      void queryClient.invalidateQueries({ queryKey: ["collection-uri-resolved"] });
      void queryClient.invalidateQueries({ queryKey: ["collection-config"] });
      void queryClient.invalidateQueries({ queryKey: ["crates"] });
    };
    const onTiled = () => {
      setTiledUrlDraft(getTiledApiUrl());
      setTiledKeyDraft(getTiledApiKey());
      void queryClient.invalidateQueries({ queryKey: ["tiled-server"] });
      void queryClient.invalidateQueries({ queryKey: ["tiled-probe"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard-uri-resolved"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard-uri-tiled"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard-config"] });
      void queryClient.invalidateQueries({ queryKey: ["collection-uri-resolved"] });
      void queryClient.invalidateQueries({ queryKey: ["crates"] });
      void queryClient.invalidateQueries({ queryKey: ["crates-all-count"] });
    };
    window.addEventListener("lambda-dashboard-uri-changed", onDash);
    window.addEventListener("lambda-collection-uri-changed", onColl);
    window.addEventListener(TILED_SERVER_CHANGED, onTiled);
    return () => {
      window.removeEventListener("lambda-dashboard-uri-changed", onDash);
      window.removeEventListener("lambda-collection-uri-changed", onColl);
      window.removeEventListener(TILED_SERVER_CHANGED, onTiled);
    };
  }, [queryClient]);

  const dashPreviewQuery = useQuery({
    queryKey: ["dashboard-config", dashDraft],
    queryFn: () => fetchDashboardConfig(dashDraft),
    enabled: Boolean(dashDraft.trim()),
    retry: false,
  });

  const collPreviewQuery = useQuery({
    queryKey: ["collection-config", collDraft],
    queryFn: () => fetchCollectionConfig(collDraft),
    enabled: Boolean(collDraft.trim()),
    retry: false,
  });

  const allCountQuery = useQuery({
    queryKey: ["crates-all-count"],
    queryFn: async () => (await fetchAllCrates()).length,
  });

  const scopedCountQuery = useQuery({
    queryKey: ["crates", collDraft || "all"],
    queryFn: fetchCrates,
  });

  function invalidateCrates() {
    void queryClient.invalidateQueries({ queryKey: ["crates"] });
    void queryClient.invalidateQueries({ queryKey: ["crates-all-count"] });
  }

  function saveTiledServer() {
    if (!tiledUrlDraft.trim()) return;
    setStoredTiledServer(tiledUrlDraft, tiledKeyDraft);
    if (!getStoredDashboardUri()) {
      setDashDraft(defaultDashboardUri());
    }
    setSavedMsg(`Connected to ${getTiledOrigin()}`);
    void queryClient.invalidateQueries({ queryKey: ["tiled-server"] });
    void queryClient.invalidateQueries({ queryKey: ["tiled-probe"] });
  }

  function resetTiledServer() {
    clearStoredTiledServer();
    setTiledUrlDraft(ENV_TILED_API_URL);
    setTiledKeyDraft(ENV_TILED_API_KEY);
    setSavedMsg("Reset to env default");
    void queryClient.invalidateQueries({ queryKey: ["tiled-server"] });
  }

  function saveDashboard() {
    if (!dashDraft.trim()) return;
    setStoredDashboardUri(dashDraft);
    setSavedMsg("Dashboard layout saved");
    void queryClient.invalidateQueries({ queryKey: ["dashboard-uri-resolved"] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard-config"] });
  }

  function resetDashboardToTiled() {
    clearStoredDashboardUri();
    const tiled = tiledDefaultQuery.data;
    setDashDraft(tiled ?? defaultDashboardUri());
    setSavedMsg(tiled ? "Using Tiled default layout" : "Using app default layout");
    void queryClient.invalidateQueries({ queryKey: ["dashboard-uri-resolved"] });
  }

  function resetDashboardToApp() {
    clearStoredDashboardUri();
    setDashDraft(defaultDashboardUri());
    setSavedMsg("Using app default layout");
    void queryClient.invalidateQueries({ queryKey: ["dashboard-uri-resolved"] });
  }

  function saveCollection() {
    if (!collDraft.trim()) {
      clearStoredCollectionUri();
      setSavedMsg("Working set cleared — all datasets");
    } else {
      setStoredCollectionUri(collDraft);
      setSavedMsg("Working set saved");
      void fetchCollectionConfig(collDraft.trim())
        .then((c) => {
          if (c.dashboard_uri) {
            setDashDraft(c.dashboard_uri);
            setSavedMsg("Working set saved · layout URL updated (save layout to apply)");
          }
        })
        .catch(() => undefined);
    }
    void queryClient.invalidateQueries({ queryKey: ["collection-uri-resolved"] });
    void queryClient.invalidateQueries({ queryKey: ["collection-config"] });
    invalidateCrates();
  }

  function useExampleCollection() {
    setCollDraft(exampleCollectionUri());
    setSavedMsg(null);
  }

  function clearCollection() {
    clearStoredCollectionUri();
    setCollDraft("");
    setSavedMsg("Working set cleared — all datasets");
    void queryClient.invalidateQueries({ queryKey: ["collection-uri-resolved"] });
    invalidateCrates();
  }

  function setSection(key: SectionKey, open: boolean) {
    setSections((s) => ({ ...s, [key]: open }));
  }

  const probe = tiledProbeQuery.data;
  const scoped = scopedCountQuery.data?.length;
  const total = allCountQuery.data;
  const workingSetSummary =
    scopedCountQuery.isLoading || allCountQuery.isLoading
      ? "…"
      : collDraft.trim()
        ? `${scoped ?? 0} of ${total ?? "?"} datasets`
        : `All datasets (${total ?? "?"})`;
  const layoutSummary =
    dashPreviewQuery.data?.title?.trim() ||
    (dashDraft.trim() ? "Custom layout URL" : "Default layout");

  return (
    <div className="flex flex-col gap-4 w-full h-full min-h-0 overflow-auto max-w-2xl">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">Setup</h1>
        <p className="text-sm text-slate-400 mt-1">
          Connect to Tiled. Advanced options are collapsed below.
        </p>
      </div>

      <Paper className="p-4 bg-slate-900/70 space-y-4">
        <h2 className="text-sm font-medium text-slate-200">Connection</h2>
        <label className="block">
          <span className="text-xs text-slate-400">Tiled server URL</span>
          <input
            type="url"
            value={tiledUrlDraft}
            onChange={(e) => {
              setTiledUrlDraft(e.target.value);
              setSavedMsg(null);
            }}
            onBlur={() => {
              void queryClient.invalidateQueries({
                queryKey: ["tiled-probe", tiledUrlDraft, tiledKeyDraft],
              });
            }}
            className="mt-1 w-full rounded-md bg-slate-800 border border-slate-600 px-3 py-2 text-sm text-slate-100 font-mono"
            placeholder={ENV_TILED_API_URL}
          />
        </label>
        <label className="block">
          <span className="text-xs text-slate-400">API key</span>
          <input
            type="password"
            value={tiledKeyDraft}
            onChange={(e) => {
              setTiledKeyDraft(e.target.value);
              setSavedMsg(null);
            }}
            className="mt-1 w-full rounded-md bg-slate-800 border border-slate-600 px-3 py-2 text-sm text-slate-100 font-mono"
            placeholder={ENV_TILED_API_KEY}
            autoComplete="off"
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={saveTiledServer}
            className="px-3 py-1.5 rounded-md bg-sky-700 text-slate-100 text-sm hover:bg-sky-600"
          >
            Save connection
          </button>
          <button
            type="button"
            onClick={resetTiledServer}
            className="text-xs text-slate-400 hover:text-sky-300 underline-offset-2 hover:underline"
          >
            Reset to env
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full font-medium ${
              tiledProbeQuery.isLoading
                ? "bg-slate-700 text-slate-300"
                : probe?.ok
                  ? "bg-emerald-900/60 text-emerald-200"
                  : "bg-rose-900/50 text-rose-200"
            }`}
          >
            {tiledProbeQuery.isLoading
              ? "Checking…"
              : probe?.ok
                ? "Connected"
                : "Not reachable"}
          </span>
          {!tiledProbeQuery.isLoading && probe && !probe.ok ? (
            <span className="text-rose-300">{probe.detail}</span>
          ) : null}
          <span className="text-slate-500">
            {scopedCountQuery.isLoading
              ? "…"
              : `${scoped ?? 0} datasets in working set`}
          </span>
        </div>
      </Paper>

      <CollapsibleSection
        title="Working set"
        summary={workingSetSummary}
        open={sections.workingSet}
        onOpenChange={(open) => setSection("workingSet", open)}
      >
        <label className="block">
          <span className="text-xs text-slate-400">Collection YAML URL (optional)</span>
          <input
            type="url"
            value={collDraft}
            onChange={(e) => {
              setCollDraft(e.target.value);
              setSavedMsg(null);
            }}
            className="mt-1 w-full rounded-md bg-slate-800 border border-slate-600 px-3 py-2 text-sm text-slate-100 font-mono"
            placeholder={EXAMPLE_COLLECTION_URI}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={saveCollection}
            className="px-3 py-1.5 rounded-md bg-sky-700 text-slate-100 text-sm hover:bg-sky-600"
          >
            Save working set
          </button>
          <button
            type="button"
            onClick={useExampleCollection}
            className="px-3 py-1.5 rounded-md bg-slate-700 text-slate-100 text-sm hover:bg-slate-600"
          >
            Lambda MX example
          </button>
          <button
            type="button"
            onClick={clearCollection}
            className="px-3 py-1.5 rounded-md bg-slate-800 text-slate-300 text-sm hover:bg-slate-700"
          >
            Clear (all datasets)
          </button>
        </div>
        {collPreviewQuery.error && collDraft.trim() ? (
          <p className="text-rose-300 text-sm">{String(collPreviewQuery.error)}</p>
        ) : null}
      </CollapsibleSection>

      <CollapsibleSection
        title="Layout override"
        summary={layoutSummary}
        open={sections.layout}
        onOpenChange={(open) => setSection("layout", open)}
      >
        <label className="block">
          <span className="text-xs text-slate-400">Dashboard YAML URL</span>
          <input
            type="url"
            value={dashDraft}
            onChange={(e) => {
              setDashDraft(e.target.value);
              setSavedMsg(null);
            }}
            className="mt-1 w-full rounded-md bg-slate-800 border border-slate-600 px-3 py-2 text-sm text-slate-100 font-mono"
            placeholder={DEFAULT_DASHBOARD_URI}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={saveDashboard}
            className="px-3 py-1.5 rounded-md bg-sky-700 text-slate-100 text-sm hover:bg-sky-600"
          >
            Save layout
          </button>
          <button
            type="button"
            onClick={resetDashboardToTiled}
            className="px-3 py-1.5 rounded-md bg-slate-700 text-slate-100 text-sm hover:bg-slate-600"
          >
            Tiled default
          </button>
          <button
            type="button"
            onClick={resetDashboardToApp}
            className="px-3 py-1.5 rounded-md bg-slate-800 text-slate-300 text-sm hover:bg-slate-700"
          >
            App default
          </button>
        </div>
        {dashPreviewQuery.error && dashDraft.trim() ? (
          <p className="text-rose-300 text-sm">{String(dashPreviewQuery.error)}</p>
        ) : null}
      </CollapsibleSection>

      <CollapsibleSection
        id="schemas"
        title="Schema files"
        summary="YAML & LinkML inspectors"
        open={sections.schemas}
        onOpenChange={(open) => setSection("schemas", open)}
      >
        <SchemaFilesSection
          collectionDraft={collDraft}
          dashboardDraft={dashDraft}
        />
      </CollapsibleSection>

      <CollapsibleSection
        id="catalog-browser"
        title="Catalog browser"
        summary="Raw Tiled tree"
        open={sections.catalog}
        onOpenChange={(open) => setSection("catalog", open)}
      >
        <BrowsePage />
      </CollapsibleSection>

      {savedMsg ? <p className="text-sm text-emerald-400">{savedMsg}</p> : null}

      <details className="text-xs text-slate-500">
        <summary className="cursor-pointer hover:text-slate-400">
          How overrides work
        </summary>
        <p className="mt-2 leading-relaxed">
          Tiled URL: localStorage, then{" "}
          <code className="text-slate-400">VITE_TILED_API_URL</code>. Working
          set: localStorage, then{" "}
          <code className="text-slate-400">VITE_COLLECTION_URI</code>, then all
          datasets. Layout: localStorage, then Tiled{" "}
          <code className="text-slate-400">dashboard_uri</code>, then env /
          built-in default.
          {getStoredTiledApiUrl() ? (
            <>
              {" "}
              Stored Tiled:{" "}
              <span className="font-mono text-slate-400">
                {getStoredTiledApiUrl()}
              </span>
            </>
          ) : null}
        </p>
      </details>
    </div>
  );
}
