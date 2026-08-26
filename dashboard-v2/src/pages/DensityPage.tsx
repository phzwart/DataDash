/**
 * Standalone Mol* structure + density viewer for the OS popup window.
 * Prefetches job output bytes (clear errors), then loads via blob URLs.
 */
import { useEffect, useRef, useState } from "react";
import { jobOutputRawUrl } from "../lib/agentApi";
import {
  parseDensityPopupParams,
  type DensityPopupParams,
} from "../lib/densityPopup";

const MOLSTAR_JS =
  "https://cdn.jsdelivr.net/npm/molstar@4.17.0/build/viewer/molstar.js";
const MOLSTAR_CSS =
  "https://cdn.jsdelivr.net/npm/molstar@4.17.0/build/viewer/molstar.css";

type MolstarViewer = {
  loadStructureFromUrl: (
    url: string,
    format?: string,
    isBinary?: boolean,
  ) => Promise<unknown>;
  loadVolumeFromUrl: (
    spec: { url: string; format: string; isBinary: boolean },
    isovalues: Array<{
      type: string;
      value: number;
      color: number;
      alpha?: number;
    }>,
  ) => Promise<unknown>;
  dispose?: () => void;
};

type MolstarNS = {
  Viewer: {
    create: (
      element: HTMLElement | string,
      options?: Record<string, unknown>,
    ) => Promise<MolstarViewer>;
  };
};

declare global {
  interface Window {
    molstar?: MolstarNS;
  }
}

function ensureMolstarAssets(): Promise<MolstarNS> {
  if (window.molstar?.Viewer) {
    return Promise.resolve(window.molstar);
  }
  return new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${MOLSTAR_CSS}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = MOLSTAR_CSS;
      document.head.appendChild(link);
    }
    const existing = document.querySelector(
      `script[src="${MOLSTAR_JS}"]`,
    ) as HTMLScriptElement | null;
    const finish = () => {
      if (window.molstar?.Viewer) resolve(window.molstar);
      else reject(new Error("Mol* failed to initialize after script load"));
    };
    if (existing) {
      if (window.molstar?.Viewer) {
        finish();
        return;
      }
      existing.addEventListener("load", finish);
      existing.addEventListener("error", () =>
        reject(new Error("Failed to load Mol* script")),
      );
      return;
    }
    const script = document.createElement("script");
    script.src = MOLSTAR_JS;
    script.async = true;
    script.onload = finish;
    script.onerror = () => reject(new Error("Failed to load Mol* script"));
    document.head.appendChild(script);
  });
}

function mapFormat(path: string): "ccp4" | "dsn6" {
  const lower = path.toLowerCase();
  if (lower.endsWith(".dsn6") || lower.endsWith(".omap")) return "dsn6";
  return "ccp4";
}

async function fetchJobBlob(
  jobUuid: string,
  path: string,
): Promise<{ blob: Blob; url: string }> {
  const href = jobOutputRawUrl(jobUuid, path);
  let rawStatus: number | null = null;
  try {
    const res = await fetch(href);
    rawStatus = res.status;
    if (res.ok) {
      const blob = await res.blob();
      if (!blob.size) throw new Error(`Empty file: ${path}`);
      return { blob, url: URL.createObjectURL(blob) };
    }
  } catch (e) {
    // Network/CORS — fall through to JSON text for PDB only.
    if (
      !path.toLowerCase().endsWith(".pdb") &&
      !path.toLowerCase().endsWith(".ent")
    ) {
      throw e instanceof Error ? e : new Error(String(e));
    }
  }

  const isPdb =
    path.toLowerCase().endsWith(".pdb") || path.toLowerCase().endsWith(".ent");
  if (isPdb && (rawStatus === null || rawStatus === 404 || rawStatus >= 500)) {
    const { getJobOutputFile } = await import("../lib/agentApi");
    const payload = await getJobOutputFile(jobUuid, path);
    if (payload.text?.trim()) {
      const blob = new Blob([payload.text], { type: "chemical/x-pdb" });
      return { blob, url: URL.createObjectURL(blob) };
    }
  }

  throw new Error(
    `Failed to fetch ${path}` +
      (rawStatus != null ? ` (HTTP ${rawStatus})` : "") +
      `. URL: ${href}. Restart agent_server so /output/raw is available.`,
  );
}

export default function DensityPage() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<MolstarViewer | null>(null);
  const blobUrlsRef = useRef<string[]>([]);
  const [params] = useState<DensityPopupParams | null>(() =>
    parseDensityPopupParams(),
  );
  const [status, setStatus] = useState("Loading Mol*…");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.classList.add("density-popup");
    document.body.classList.add("density-popup");
    return () => {
      document.documentElement.classList.remove("density-popup");
      document.body.classList.remove("density-popup");
    };
  }, []);

  useEffect(() => {
    if (!params) return;
    let cancelled = false;
    let viewer: MolstarViewer | null = null;

    const revokeBlobs = () => {
      for (const u of blobUrlsRef.current) {
        try {
          URL.revokeObjectURL(u);
        } catch {
          /* ignore */
        }
      }
      blobUrlsRef.current = [];
    };

    // Wait a frame so the host div is laid out with non-zero size.
    const raf = requestAnimationFrame(() => {
      void (async () => {
        try {
          if (!hostRef.current || cancelled) return;
          setError(null);
          setStatus("Starting Mol*…");
          const molstar = await ensureMolstarAssets();
          if (cancelled || !hostRef.current) return;

          // Clear any leftover canvas from StrictMode remount.
          hostRef.current.innerHTML = "";

          viewer = await molstar.Viewer.create(hostRef.current, {
            layoutIsExpanded: false,
            layoutShowControls: true,
            layoutShowRemoteState: false,
            layoutShowSequence: true,
            layoutShowLog: false,
            layoutShowLeftPanel: true,
            viewportShowExpand: true,
            viewportShowSelectionMode: true,
            viewportShowAnimation: false,
            pdbProvider: "rcsb",
            emdbProvider: "rcsb",
          });
          if (cancelled) {
            viewer.dispose?.();
            return;
          }
          viewerRef.current = viewer;

          setStatus(`Fetching structure ${params.pdb}…`);
          const pdb = await fetchJobBlob(params.jobUuid, params.pdb);
          if (cancelled) {
            URL.revokeObjectURL(pdb.url);
            return;
          }
          blobUrlsRef.current.push(pdb.url);

          setStatus(`Loading structure into Mol*…`);
          await viewer.loadStructureFromUrl(pdb.url, "pdb", false);

          if (params.map?.trim()) {
            const mapPath = params.map.trim();
            setStatus(`Fetching density ${mapPath}…`);
            const map = await fetchJobBlob(params.jobUuid, mapPath);
            if (cancelled) {
              URL.revokeObjectURL(map.url);
              return;
            }
            blobUrlsRef.current.push(map.url);
            setStatus(`Loading density into Mol*…`);
            await viewer.loadVolumeFromUrl(
              {
                url: map.url,
                format: mapFormat(mapPath),
                isBinary: true,
              },
              [
                {
                  type: "relative",
                  value: 1.5,
                  color: 0x3362b2,
                  alpha: 0.45,
                },
              ],
            );
            setStatus("Structure + density ready");
          } else {
            setStatus("Structure ready (no density map in this job)");
          }
        } catch (e) {
          if (!cancelled) {
            setError(e instanceof Error ? e.message : String(e));
            setStatus("Failed");
          }
        }
      })();
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      try {
        viewer?.dispose?.();
        viewerRef.current?.dispose?.();
      } catch {
        /* ignore */
      }
      viewerRef.current = null;
      revokeBlobs();
      if (hostRef.current) hostRef.current.innerHTML = "";
    };
  }, [params]);

  if (!params) {
    return (
      <div className="density-page density-page--error">
        <p>Missing job / pdb query parameters.</p>
      </div>
    );
  }

  const heading =
    params.title?.trim() ||
    (params.map ? "Structure + density" : "Structure");

  return (
    <div className="density-page">
      <header className="density-page__bar">
        <div className="density-page__titles">
          <h1>{heading}</h1>
          <p className="density-page__meta">
            job {params.jobUuid.slice(0, 8)} · {params.pdb}
            {params.map ? ` · ${params.map}` : ""}
          </p>
        </div>
        <p
          className={`density-page__status${error ? " density-page__status--err" : ""}`}
        >
          {error ?? status}
        </p>
      </header>
      <div ref={hostRef} className="density-page__viewer" />
    </div>
  );
}
