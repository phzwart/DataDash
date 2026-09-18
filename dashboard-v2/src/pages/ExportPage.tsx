import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Paper } from "@blueskyproject/finch";
import { DownloadSimple } from "@phosphor-icons/react";
import {
  exportCartZip,
  previewExportRows,
  type ExportProgress,
} from "../lib/cartExport";
import { useBookSearchSync } from "../lib/bookContext";
import { getCartIds, replaceCart, subscribeCart } from "../lib/crateCart";
import { fetchPlacements, fetchProject } from "../lib/projectBookApi";
import { projectWorkIds } from "../lib/organizeScope";
import { resolveDashboardUri } from "../lib/dashboardConfig";
import { fetchDashboardConfig, type ExportProfile } from "../lib/schema";
import { fetchCrates, shortId, type CrateSummary } from "../lib/tiledCrates";

export default function ExportPage() {
  const book = useBookSearchSync();
  const [cartIds, setCartIds] = useState(() => getCartIds());
  const [profileId, setProfileId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastOk, setLastOk] = useState<string | null>(null);

  useEffect(() => subscribeCart(() => setCartIds(getCartIds())), []);

  const dashUriQuery = useQuery({
    queryKey: ["dashboard-uri-resolved"],
    queryFn: resolveDashboardUri,
  });

  const dashQuery = useQuery({
    queryKey: ["dashboard-config", dashUriQuery.data?.uri],
    queryFn: () => fetchDashboardConfig(dashUriQuery.data!.uri),
    enabled: Boolean(dashUriQuery.data?.uri),
    staleTime: 0,
    refetchOnMount: "always",
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

  const profiles = dashQuery.data?.export?.profiles ?? [];

  useEffect(() => {
    if (!profiles.length) {
      setProfileId(null);
      return;
    }
    setProfileId((prev) =>
      prev && profiles.some((p) => p.id === prev) ? prev : profiles[0].id,
    );
  }, [profiles]);

  const profile: ExportProfile | null =
    profiles.find((p) => p.id === profileId) ?? null;

  const projectIds = useMemo(() => {
    const ids = new Set<string>();
    for (const p of placementsQuery.data?.placements ?? []) {
      if (p.project_id === book.projectId) ids.add(p.crate_uuid);
    }
    return ids;
  }, [placementsQuery.data, book.projectId]);
  const selectedSub = projectQuery.data?.subprojects.find(
    (s) => s.id === book.subId,
  );
  const work = useMemo(
    () => projectWorkIds(selectedSub, projectIds),
    [selectedSub, projectIds],
  );

  useEffect(() => {
    if (!book.projectId || !placementsQuery.isSuccess) return;
    if (book.subId && !projectQuery.isSuccess) return;
    replaceCart(work.ids, book.projectId);
  }, [
    book.projectId,
    book.subId,
    work.ids,
    placementsQuery.isSuccess,
    projectQuery.isSuccess,
  ]);

  const cartCrates: CrateSummary[] = useMemo(() => {
    const byId = new Map((cratesQuery.data ?? []).map((c) => [c.id, c]));
    return cartIds.map((id) => {
      const found = byId.get(id);
      return found ?? { id, metadata: {} };
    });
  }, [cartIds, cratesQuery.data]);

  const preview = useMemo(
    () =>
      profile
        ? previewExportRows(
            cartCrates,
            profile,
            dashQuery.data?.hero.title,
          )
        : [],
    [cartCrates, profile, dashQuery.data?.hero.title],
  );

  async function runExport() {
    if (!profile || cartCrates.length === 0) return;
    setBusy(true);
    setError(null);
    setLastOk(null);
    setProgress({ done: 0, total: 1, message: "Starting…" });
    try {
      const result = await exportCartZip({
        crates: cartCrates,
        profile,
        onProgress: setProgress,
      });
      setLastOk(
        `Downloaded ${result.filename} (${result.fileCount} entries including manifest)`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (dashUriQuery.isLoading || dashQuery.isLoading) {
    return <p className="p-6 text-slate-400">Loading export profiles…</p>;
  }

  return (
    <div className="flex flex-col gap-4 p-4 w-full h-full min-h-0 overflow-auto max-w-4xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100 inline-flex items-center gap-2">
            <DownloadSimple size={28} />
            Export
            <span className="text-base font-normal text-slate-400">
              ({cartIds.length} in Work)
            </span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Download the current project or subproject crates using profiles
            from the dashboard YAML{" "}
            <code className="text-slate-500">export:</code> section.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            to="/work/run"
            className="px-3 py-1.5 rounded-md bg-slate-700 text-slate-100 text-sm hover:bg-slate-600 no-underline"
          >
            Back to Work
          </Link>
          <Link
            to="/setup"
            className="px-3 py-1.5 rounded-md bg-slate-800 text-slate-300 text-sm hover:bg-slate-700 no-underline"
          >
            Setup
          </Link>
        </div>
      </div>

      {!dashQuery.data?.export?.profiles?.length && (
        <Paper className="p-4 text-amber-200 text-sm bg-slate-900/70">
          No <code className="text-amber-100">export.profiles</code> in the
          active dashboard YAML. Add an{" "}
          <code className="text-amber-100">export:</code> block under{" "}
          <Link to="/setup#schemas" className="text-sky-400 hover:underline">
            Setup → Schema files
          </Link>
          , then reload.
        </Paper>
      )}

      {cartIds.length === 0 && (
        <Paper className="p-6 text-slate-400 text-sm space-y-3">
          {book.projectId ? (
            <p>
              No crates in this project or subproject. File them on{" "}
              <Link to="/" className="text-sky-400 hover:underline">
                Data &amp; Projects
              </Link>{" "}
              or{" "}
              <Link to="/work/run" className="text-sky-400 hover:underline">
                Work
              </Link>
              .
            </p>
          ) : (
            <p>
              Select a project on{" "}
              <Link to="/work/run" className="text-sky-400 hover:underline">
                Work
              </Link>{" "}
              first.
            </p>
          )}
        </Paper>
      )}

      {profiles.length > 0 && (
        <Paper className="p-4 bg-slate-900/70 space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-slate-200">
              Export profile
            </span>
            <select
              value={profileId ?? ""}
              onChange={(e) => setProfileId(e.target.value)}
              className="mt-2 w-full rounded-md bg-slate-800 border border-slate-600 px-3 py-2 text-sm text-slate-100"
              disabled={busy}
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>

          {profile && (
            <div className="text-sm text-slate-400 space-y-1">
              {profile.description && <p>{profile.description}</p>}
              <p className="font-mono text-xs text-slate-500">
                id={profile.id} · assets:{" "}
                {profile.assets
                  .map((a) => `${a.child}/${a.format}`)
                  .join(", ")}
                {profile.naming?.pattern
                  ? ` · naming: ${profile.naming.pattern}`
                  : ""}
              </p>
            </div>
          )}

          <button
            type="button"
            disabled={busy || !profile || cartIds.length === 0}
            onClick={() => void runExport()}
            className="px-3 py-1.5 rounded-md bg-sky-700 text-slate-100 text-sm hover:bg-sky-600 disabled:opacity-40 inline-flex items-center gap-2"
          >
            <DownloadSimple size={16} />
            {busy ? "Exporting…" : "Download ZIP"}
          </button>

          {progress && (
            <p className="text-xs text-slate-400 font-mono">
              {progress.total > 0
                ? `${progress.done}/${progress.total} · `
                : ""}
              {progress.message}
            </p>
          )}
          {error && <p className="text-sm text-rose-300">{error}</p>}
          {lastOk && <p className="text-sm text-emerald-400">{lastOk}</p>}
        </Paper>
      )}

      {profile && cartIds.length > 0 && (
        <Paper className="p-4 bg-slate-900/70 overflow-auto">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-sky-300 mb-3">
            Preview ({preview.length} datasets)
          </h2>
          {cratesQuery.isLoading && (
            <p className="text-slate-400 text-sm mb-2">Loading dataset metadata…</p>
          )}
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="text-slate-500 text-xs uppercase tracking-wide border-b border-slate-700">
                <th className="py-2 pr-3 font-medium">Dataset</th>
                <th className="py-2 pr-3 font-medium">Id</th>
                <th className="py-2 font-medium">ZIP paths</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-slate-800/80 align-top"
                >
                  <td className="py-2 pr-3 text-slate-100">{row.label}</td>
                  <td className="py-2 pr-3 font-mono text-xs text-slate-500">
                    {shortId(row.id)}
                  </td>
                  <td className="py-2 font-mono text-xs text-slate-400">
                    {row.files.join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {profile.manifest && (
            <p className="mt-3 text-xs text-slate-500">
              Also includes{" "}
              <code>{profile.manifest.filename ?? "manifest.json"}</code> with
              slots: {profile.manifest.slots.join(", ")}
            </p>
          )}
        </Paper>
      )}
    </div>
  );
}
