function tangents(xs: number[], ys: number[]): number[] {
  const n = xs.length;
  const m = new Array<number>(n).fill(0);
  if (n < 2) return m;
  if (n === 2) {
    m[0] = m[1] = (ys[1] - ys[0]) / (xs[1] - xs[0] || 1);
    return m;
  }
  for (let i = 1; i < n - 1; i++) {
    const hPrev = xs[i] - xs[i - 1];
    const hNext = xs[i + 1] - xs[i];
    const sPrev = (ys[i] - ys[i - 1]) / (hPrev || 1);
    const sNext = (ys[i + 1] - ys[i]) / (hNext || 1);
    const p = (sPrev * hNext + sNext * hPrev) / (hPrev + hNext || 1);
    m[i] = (Math.sign(sPrev) + Math.sign(sNext)) * Math.min(Math.abs(sPrev), Math.abs(sNext), 0.5 * Math.abs(p)) || 0;
  }
  const h0 = xs[1] - xs[0];
  m[0] = h0 ? (3 * (ys[1] - ys[0])) / h0 / 2 - m[1] / 2 : m[1];
  const h1 = xs[n - 1] - xs[n - 2];
  m[n - 1] = h1 ? (3 * (ys[n - 1] - ys[n - 2])) / h1 / 2 - m[n - 2] / 2 : m[n - 2];
  return m;
}

export function monotonePath(xs: number[], ys: number[]): string {
  const n = xs.length;
  if (!n) return "";
  if (n === 1) return `M${xs[0].toFixed(2)},${ys[0].toFixed(2)}`;
  const m = tangents(xs, ys);
  let d = `M${xs[0].toFixed(2)},${ys[0].toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = (xs[i + 1] - xs[i]) / 3;
    d += `C${(xs[i] + h).toFixed(2)},${(ys[i] + m[i] * h).toFixed(2)} ${(xs[i + 1] - h).toFixed(2)},${(ys[i + 1] - m[i + 1] * h).toFixed(2)} ${xs[i + 1].toFixed(2)},${ys[i + 1].toFixed(2)}`;
  }
  return d;
}

export function catmullRomPath(xs: number[], ys: number[], smoothing = 0.2): string {
  const n = xs.length;
  if (!n) return "";
  if (n === 1) return `M ${xs[0].toFixed(2)} ${ys[0].toFixed(2)}`;

  let d = `M ${xs[0].toFixed(2)} ${ys[0].toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const prev = i - 1 < 0 ? i : i - 1;
    const next = i + 2 > n - 1 ? i + 1 : i + 2;
    const c1x = xs[i] + (xs[i + 1] - xs[prev]) * smoothing;
    const c1y = ys[i] + (ys[i + 1] - ys[prev]) * smoothing;
    const c2x = xs[i + 1] - (xs[next] - xs[i]) * smoothing;
    const c2y = ys[i + 1] - (ys[next] - ys[i]) * smoothing;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${xs[i + 1].toFixed(2)} ${ys[i + 1].toFixed(2)}`;
  }
  return d;
}

export function closeArea(line: string, x0: number, x1: number, baseY: number): string {
  return `${line}L${x1.toFixed(2)},${baseY.toFixed(2)}L${x0.toFixed(2)},${baseY.toFixed(2)}Z`;
}

export function resample(src: number[], n: number): number[] {
  if (src.length === n) return src.slice();
  if (src.length === 1) return new Array<number>(n).fill(src[0]);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * (src.length - 1);
    const j = Math.floor(t);
    const f = t - j;
    out[i] = src[j] + (src[Math.min(j + 1, src.length - 1)] - src[j]) * f;
  }
  return out;
}

export const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
