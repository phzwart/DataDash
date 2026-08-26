/**
 * Proper preview downsampling for Tiled arrays.
 * Continuous (float) images: separable Gaussian blur, then subsample.
 * Categorical (uint8 class) masks: majority vote per output bin.
 */

export type DtypeKind = "f32" | "u8" | "u16" | "i16" | "i32" | "f64";

export function parseDtype(meta: {
  kind?: string;
  itemsize?: number;
}): DtypeKind {
  const kind = meta.kind ?? "u";
  const itemsize = meta.itemsize ?? 1;
  if (kind === "f" && itemsize === 4) return "f32";
  if (kind === "f" && itemsize === 8) return "f64";
  if (kind === "u" && itemsize === 1) return "u8";
  if (kind === "u" && itemsize === 2) return "u16";
  if (kind === "i" && itemsize === 2) return "i16";
  if (kind === "i" && itemsize === 4) return "i32";
  return "u8";
}

export function bytesPerItem(dtype: DtypeKind): number {
  switch (dtype) {
    case "u8":
      return 1;
    case "u16":
    case "i16":
      return 2;
    case "f32":
    case "i32":
      return 4;
    case "f64":
      return 8;
  }
}

export function decodeRawArray(
  buffer: ArrayBuffer,
  dtype: DtypeKind,
  height: number,
  width: number,
): Float32Array | Uint8Array {
  const expected = height * width * bytesPerItem(dtype);
  if (buffer.byteLength < expected) {
    throw new Error(
      `Array buffer too small: got ${buffer.byteLength}, need ${expected}`,
    );
  }
  switch (dtype) {
    case "u8":
      return new Uint8Array(buffer, 0, height * width);
    case "f32":
      return new Float32Array(buffer, 0, height * width);
    case "f64": {
      const src = new Float64Array(buffer, 0, height * width);
      const out = new Float32Array(height * width);
      out.set(src);
      return out;
    }
    case "u16": {
      const src = new Uint16Array(buffer, 0, height * width);
      const out = new Float32Array(height * width);
      for (let i = 0; i < out.length; i++) out[i] = src[i];
      return out;
    }
    case "i16": {
      const src = new Int16Array(buffer, 0, height * width);
      const out = new Float32Array(height * width);
      for (let i = 0; i < out.length; i++) out[i] = src[i];
      return out;
    }
    case "i32": {
      const src = new Int32Array(buffer, 0, height * width);
      const out = new Float32Array(height * width);
      for (let i = 0; i < out.length; i++) out[i] = src[i];
      return out;
    }
  }
}

/** Build a normalized 1D Gaussian kernel. */
export function gaussianKernel(sigma: number): Float32Array {
  const s = Math.max(0.5, sigma);
  const radius = Math.max(1, Math.ceil(s * 3));
  const size = radius * 2 + 1;
  const k = new Float32Array(size);
  let sum = 0;
  for (let i = 0; i < size; i++) {
    const x = i - radius;
    const v = Math.exp(-(x * x) / (2 * s * s));
    k[i] = v;
    sum += v;
  }
  for (let i = 0; i < size; i++) k[i] /= sum;
  return k;
}

function convolveRows(
  src: Float32Array,
  h: number,
  w: number,
  kernel: Float32Array,
): Float32Array {
  const radius = (kernel.length - 1) >> 1;
  const out = new Float32Array(h * w);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = 0; k < kernel.length; k++) {
        const xx = Math.min(w - 1, Math.max(0, x + k - radius));
        acc += src[row + xx] * kernel[k];
      }
      out[row + x] = acc;
    }
  }
  return out;
}

function convolveCols(
  src: Float32Array,
  h: number,
  w: number,
  kernel: Float32Array,
): Float32Array {
  const radius = (kernel.length - 1) >> 1;
  const out = new Float32Array(h * w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = 0; k < kernel.length; k++) {
        const yy = Math.min(h - 1, Math.max(0, y + k - radius));
        acc += src[yy * w + x] * kernel[k];
      }
      out[y * w + x] = acc;
    }
  }
  return out;
}

function toFloat32(
  src: Float32Array | Uint8Array,
): Float32Array {
  if (src instanceof Float32Array) return src;
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = src[i];
  return out;
}

/**
 * Gaussian-filter then subsample continuous data to outH×outW.
 * sigma scales with the downsample factor so aliases are suppressed.
 */
export function gaussianDownsample(
  src: Float32Array | Uint8Array,
  srcH: number,
  srcW: number,
  outH: number,
  outW: number,
): Float32Array {
  const f = toFloat32(src);
  const scaleY = srcH / outH;
  const scaleX = srcW / outW;
  const sigma = Math.max(0.5, 0.5 * Math.max(scaleX, scaleY));
  const kernel = gaussianKernel(sigma);
  const blurred = convolveCols(convolveRows(f, srcH, srcW, kernel), srcH, srcW, kernel);
  const out = new Float32Array(outH * outW);
  for (let y = 0; y < outH; y++) {
    const sy = Math.min(srcH - 1, Math.floor((y + 0.5) * scaleY));
    for (let x = 0; x < outW; x++) {
      const sx = Math.min(srcW - 1, Math.floor((x + 0.5) * scaleX));
      out[y * outW + x] = blurred[sy * srcW + sx];
    }
  }
  return out;
}

/**
 * Majority-vote downsample for categorical class masks (preserves labels).
 */
export function majorityDownsample(
  src: Uint8Array,
  srcH: number,
  srcW: number,
  outH: number,
  outW: number,
): Uint8Array {
  const out = new Uint8Array(outH * outW);
  const scaleY = srcH / outH;
  const scaleX = srcW / outW;
  const counts = new Map<number, number>();
  for (let y = 0; y < outH; y++) {
    const y0 = Math.floor(y * scaleY);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * scaleY));
    for (let x = 0; x < outW; x++) {
      const x0 = Math.floor(x * scaleX);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * scaleX));
      counts.clear();
      let best = src[y0 * srcW + x0];
      let bestN = 0;
      for (let yy = y0; yy < y1 && yy < srcH; yy++) {
        const row = yy * srcW;
        for (let xx = x0; xx < x1 && xx < srcW; xx++) {
          const v = src[row + xx];
          const n = (counts.get(v) ?? 0) + 1;
          counts.set(v, n);
          if (n > bestN) {
            bestN = n;
            best = v;
          }
        }
      }
      out[y * outW + x] = best;
    }
  }
  return out;
}

/** Percentile stretch of float image → grayscale ImageData (RGB). */
export function floatToGrayImageData(
  values: Float32Array,
  height: number,
  width: number,
  loPct = 1,
  hiPct = 99,
): ImageData {
  const n = values.length;
  const sample: number[] = [];
  const step = Math.max(1, Math.floor(n / 20000));
  for (let i = 0; i < n; i += step) sample.push(values[i]);
  sample.sort((a, b) => a - b);
  const lo = sample[Math.floor(((loPct / 100) * (sample.length - 1)))] ?? 0;
  const hi = sample[Math.floor(((hiPct / 100) * (sample.length - 1)))] ?? 1;
  const span = hi - lo || 1;
  const rgba = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const t = Math.min(1, Math.max(0, (values[i] - lo) / span));
    const g = Math.round(t * 255);
    const o = i * 4;
    rgba[o] = g;
    rgba[o + 1] = g;
    rgba[o + 2] = g;
    rgba[o + 3] = 255;
  }
  return new ImageData(rgba, width, height);
}

/** Class-ID mask → RGBA ImageData using tissue palette. */
export function maskToRgbaImageData(
  classes: Uint8Array,
  height: number,
  width: number,
  opacity: number,
  colorOf: (id: number) => readonly [number, number, number, number],
): ImageData {
  const rgba = new Uint8ClampedArray(classes.length * 4);
  const aScale = Math.min(1, Math.max(0, opacity));
  for (let i = 0; i < classes.length; i++) {
    const [r, g, b, a] = colorOf(classes[i]);
    const o = i * 4;
    rgba[o] = r;
    rgba[o + 1] = g;
    rgba[o + 2] = b;
    rgba[o + 3] = Math.round(a * aScale);
  }
  return new ImageData(rgba, width, height);
}
