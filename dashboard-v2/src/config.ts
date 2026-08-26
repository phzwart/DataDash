/**
 * Build-time defaults from Vite env.
 * Runtime target (possibly overridden in Setup / localStorage) lives in
 * `lib/tiledServer.ts` — prefer getTiledApiUrl() / getTiledOrigin() / getTiledApiKey().
 */
export {
  ENV_TILED_API_URL as TILED_API_URL,
  ENV_TILED_API_KEY as TILED_API_KEY,
  getTiledApiUrl,
  getTiledApiKey,
  getTiledOrigin,
  originFromApiUrl,
} from "./lib/tiledServer";

import { ENV_TILED_API_URL, originFromApiUrl } from "./lib/tiledServer";

/** Build-time origin only — use getTiledOrigin() for the live target. */
export const TILED_ORIGIN = originFromApiUrl(ENV_TILED_API_URL);
