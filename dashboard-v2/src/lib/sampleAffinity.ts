/** Token-aware string distance + classical MDS for sample-code scatters. */

export function tokenizeSampleCode(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array<number>(b.length + 1);
  const cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

function normLev(a: string, b: string): number {
  const denom = Math.max(a.length, b.length, 1);
  return levenshtein(a, b) / denom;
}

/** Jaro similarity in [0, 1]. */
export function jaro(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const matchDist = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatch = new Array<boolean>(a.length).fill(false);
  const bMatch = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - matchDist);
    const hi = Math.min(i + matchDist + 1, b.length);
    for (let j = lo; j < hi; j++) {
      if (bMatch[j] || a[i] !== b[j]) continue;
      aMatch[i] = true;
      bMatch[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatch[i]) continue;
    while (!bMatch[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  return (
    (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) /
    3
  );
}

export function jaroWinkler(a: string, b: string, p = 0.1): number {
  const j = jaro(a, b);
  let prefix = 0;
  const lim = Math.min(4, a.length, b.length);
  while (prefix < lim && a[prefix] === b[prefix]) prefix++;
  return j + prefix * p * (1 - j);
}

/** Mix full-string Jaro-Winkler with best-match token Levenshtein. */
export function sampleCodeDistance(a: string, b: string): number {
  const left = a.trim();
  const right = b.trim();
  if (left === right) return 0;
  const jw = 1 - jaroWinkler(left.toLowerCase(), right.toLowerCase());
  const ta = tokenizeSampleCode(left);
  const tb = tokenizeSampleCode(right);
  if (!ta.length && !tb.length) return jw;
  if (!ta.length || !tb.length) return 0.4 * jw + 0.6;
  const pairAvg = (from: string[], to: string[]) => {
    let sum = 0;
    for (const token of from) {
      let best = 1;
      for (const other of to) best = Math.min(best, normLev(token, other));
      sum += best;
    }
    return sum / from.length;
  };
  const token = (pairAvg(ta, tb) + pairAvg(tb, ta)) / 2;
  return 0.55 * token + 0.45 * jw;
}

function matVec(A: number[][], v: number[]): number[] {
  return A.map((row) => row.reduce((s, aij, j) => s + aij * v[j], 0));
}

function dot(a: number[], b: number[]): number {
  return a.reduce((s, ai, i) => s + ai * b[i], 0);
}

function norm(v: number[]): number {
  return Math.sqrt(dot(v, v));
}

function powerIteration(
  A: number[][],
  exclude?: number[],
): { value: number; vector: number[] } {
  const n = A.length;
  let v = Array.from({ length: n }, (_, i) => Math.sin(i + 1.5) + 0.1);
  if (exclude?.length) {
    const e = exclude;
    const proj = dot(v, e);
    v = v.map((vi, i) => vi - proj * e[i]);
  }
  let nrm = norm(v);
  if (nrm < 1e-12) v = v.map((_, i) => (i === 0 ? 1 : 0));
  else v = v.map((vi) => vi / nrm);

  for (let iter = 0; iter < 48; iter++) {
    let w = matVec(A, v);
    if (exclude?.length) {
      const e = exclude;
      const proj = dot(w, e);
      w = w.map((wi, i) => wi - proj * e[i]);
    }
    nrm = norm(w);
    if (nrm < 1e-12) return { value: 0, vector: v };
    v = w.map((wi) => wi / nrm);
  }
  return { value: dot(v, matVec(A, v)), vector: v };
}

/** 2D classical MDS (PCA on double-centered squared distances). */
export function classicalMds2d(dist: number[][]): [number, number][] {
  const n = dist.length;
  if (n === 0) return [];
  if (n === 1) return [[0, 0]];

  const D2 = dist.map((row) => row.map((d) => d * d));
  const rowMean = D2.map((row) => row.reduce((s, v) => s + v, 0) / n);
  const colMean = Array.from(
    { length: n },
    (_, j) => D2.reduce((s, row) => s + row[j], 0) / n,
  );
  const grand = rowMean.reduce((s, v) => s + v, 0) / n;
  const B = D2.map((row, i) =>
    row.map((v, j) => -0.5 * (v - rowMean[i] - colMean[j] + grand)),
  );

  const ev1 = powerIteration(B);
  const ev2 = powerIteration(B, ev1.vector);
  const s1 = Math.sqrt(Math.max(ev1.value, 0));
  const s2 = Math.sqrt(Math.max(ev2.value, 0));
  return B.map((_, i) => [ev1.vector[i] * s1, ev2.vector[i] * s2]);
}

export function sampleAffinityCoords(
  labels: string[],
): [number, number][] {
  const n = labels.length;
  const dist = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) =>
      i === j ? 0 : sampleCodeDistance(labels[i], labels[j]),
    ),
  );
  return classicalMds2d(dist);
}
