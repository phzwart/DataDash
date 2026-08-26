/**
 * Density / structure viewer OS popup (Mol*).
 * Opens when a Phaser (or other) job exposes a PDB under job output/.
 */

export const DENSITY_WINDOW_NAME = "lambda-density";

const DEFAULT_FEATURES =
  "popup=yes,width=1100,height=800,left=120,top=60,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes";

export type DensityPopupParams = {
  jobUuid: string;
  pdb: string;
  map?: string | null;
  title?: string | null;
};

export function isDensityPopupWindow(): boolean {
  if (typeof window === "undefined") return false;
  if (window.name === DENSITY_WINDOW_NAME) return true;
  try {
    const q = new URLSearchParams(window.location.search);
    return (
      window.location.pathname === "/density" && q.get("popup") === "1"
    );
  } catch {
    return false;
  }
}

export function densityPopupUrl(params: DensityPopupParams): string {
  const q = new URLSearchParams();
  q.set("popup", "1");
  q.set("job", params.jobUuid);
  q.set("pdb", params.pdb);
  if (params.map?.trim()) q.set("map", params.map.trim());
  if (params.title?.trim()) q.set("title", params.title.trim());
  return `${window.location.origin}/density?${q.toString()}`;
}

let densityWindowRef: Window | null = null;

/**
 * Open (or focus) the density Mol* popup.
 * Must be called from a user gesture when the browser blocks automatic popups.
 */
export function openDensityWindow(
  params: DensityPopupParams,
): Window | null {
  const url = densityPopupUrl(params);
  try {
    if (densityWindowRef && !densityWindowRef.closed) {
      densityWindowRef.location.href = url;
      densityWindowRef.focus();
      return densityWindowRef;
    }
  } catch {
    densityWindowRef = null;
  }

  const win = window.open(url, DENSITY_WINDOW_NAME, DEFAULT_FEATURES);
  if (win) {
    densityWindowRef = win;
    try {
      win.focus();
    } catch {
      /* ignore */
    }
  }
  return win;
}

export function parseDensityPopupParams(
  search = typeof window !== "undefined" ? window.location.search : "",
): DensityPopupParams | null {
  try {
    const q = new URLSearchParams(search);
    const jobUuid = q.get("job")?.trim() ?? "";
    const pdb = q.get("pdb")?.trim() ?? "";
    if (!jobUuid || !pdb) return null;
    return {
      jobUuid,
      pdb,
      map: q.get("map")?.trim() || null,
      title: q.get("title")?.trim() || null,
    };
  } catch {
    return null;
  }
}
