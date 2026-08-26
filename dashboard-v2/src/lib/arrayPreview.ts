import { getTiledApiKey, getTiledOrigin } from "./tiledServer";
import {
  bytesPerItem,
  decodeRawArray,
  gaussianDownsample,
  majorityDownsample,
  parseDtype,
  type DtypeKind,
} from "./downsample";

export type ArrayMeta = {
  shape: [number, number];
  dtype: DtypeKind;
  kind: string;
  itemsize: number;
};

type TiledMetaResponse = {
  data?: {
    attributes?: {
      structure?: {
        shape?: number[];
        data_type?: { kind?: string; itemsize?: number; endianness?: string };
      };
      metadata?: { dtype?: string; shape?: number[] };
    };
  };
};

export async function fetchArrayMeta(
  uuid: string,
  child: string,
): Promise<ArrayMeta> {
  const url = `${getTiledOrigin()}/api/v1/metadata/crates/${uuid}/${child}?api_key=${encodeURIComponent(getTiledApiKey())}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Metadata ${child} failed (${res.status})`);
  const json = (await res.json()) as TiledMetaResponse;
  const structure = json.data?.attributes?.structure;
  const shapeRaw = structure?.shape ?? json.data?.attributes?.metadata?.shape;
  if (!shapeRaw || shapeRaw.length < 2) {
    throw new Error(`Missing shape for crates/${uuid}/${child}`);
  }
  const dt = structure?.data_type ?? {};
  const dtype = parseDtype(dt);
  return {
    shape: [Number(shapeRaw[0]), Number(shapeRaw[1])],
    dtype,
    kind: dt.kind ?? "u",
    itemsize: dt.itemsize ?? bytesPerItem(dtype),
  };
}

/**
 * Fetch a strided raw array as ArrayBuffer (preserves dtype — no PNG stretch).
 */
export async function fetchArrayRaw(
  uuid: string,
  child: string,
  step: number,
): Promise<ArrayBuffer> {
  const params = new URLSearchParams({
    slice: `::${step},::${step}`,
    format: "application/octet-stream",
    api_key: getTiledApiKey(),
  });
  const url = `${getTiledOrigin()}/api/v1/array/full/crates/${uuid}/${child}?${params}`;
  const res = await fetch(url, {
    headers: { Accept: "application/octet-stream" },
  });
  if (!res.ok) throw new Error(`Array fetch ${child} failed (${res.status})`);
  return res.arrayBuffer();
}

export type PreviewBundle = {
  height: number;
  width: number;
  /** Continuous image samples, or null if image missing. */
  image?: Float32Array;
  /** Class-ID mask, or null if mask missing. */
  mask?: Uint8Array;
  fetchStep: number;
  sourceShape: [number, number];
};

/**
 * Load image (+ optional mask), oversample from Tiled, then properly downsample.
 * Images: Gaussian + stride. Masks: majority vote (categorical).
 */
export async function loadCratePreview(opts: {
  uuid: string;
  imageChild: string;
  maskChild?: string | null;
  /** Final preview edge ≈ source / stride. */
  stride: number;
  /** Fetch denser than display before filtering (reduces aliasing). */
  oversample?: number;
}): Promise<PreviewBundle> {
  const oversample = Math.max(2, opts.oversample ?? 4);
  const imageMeta = await fetchArrayMeta(opts.uuid, opts.imageChild);
  const [H, W] = imageMeta.shape;
  const target = Math.max(32, Math.ceil(Math.max(H, W) / Math.max(1, opts.stride)));
  const fetchMax = Math.min(Math.max(H, W), target * oversample);
  const fetchStep = Math.max(1, Math.ceil(Math.max(H, W) / fetchMax));
  const srcH = Math.ceil(H / fetchStep);
  const srcW = Math.ceil(W / fetchStep);
  const outH = Math.min(srcH, target);
  const outW = Math.min(srcW, Math.round((target * W) / Math.max(H, W)) || target);

  const imageBuf = await fetchArrayRaw(opts.uuid, opts.imageChild, fetchStep);
  const decoded = decodeRawArray(imageBuf, imageMeta.dtype, srcH, srcW);
  const image =
    outH === srcH && outW === srcW && decoded instanceof Float32Array
      ? decoded
      : gaussianDownsample(
          decoded instanceof Float32Array
            ? decoded
            : Float32Array.from(decoded as Uint8Array),
          srcH,
          srcW,
          outH,
          outW,
        );

  let mask: Uint8Array | undefined;
  if (opts.maskChild) {
    try {
      const maskMeta = await fetchArrayMeta(opts.uuid, opts.maskChild);
      const mH = Math.ceil(maskMeta.shape[0] / fetchStep);
      const mW = Math.ceil(maskMeta.shape[1] / fetchStep);
      const maskBuf = await fetchArrayRaw(opts.uuid, opts.maskChild, fetchStep);
      const rawMask = decodeRawArray(maskBuf, maskMeta.dtype, mH, mW);
      const asU8 =
        rawMask instanceof Uint8Array
          ? rawMask
          : Uint8Array.from(rawMask, (v) => Math.round(v));
      mask =
        outH === mH && outW === mW
          ? asU8
          : majorityDownsample(asU8, mH, mW, outH, outW);
    } catch {
      mask = undefined;
    }
  }

  return {
    height: outH,
    width: outW,
    image,
    mask,
    fetchStep,
    sourceShape: [H, W],
  };
}
