import type { Gray } from "./pgm";

/**
 * Makes a clean render look like a scan, so the finder is scored on what a
 * scanner produces rather than on a perfect bitmap: a small skew (the sheet
 * was not square on the glass), speckle noise, and a one-pixel blur (the
 * optics). Deterministic — the noise comes from a seeded generator — so a run
 * is repeatable.
 */
export type Degrade = { skewDegrees: number; speckle: number; blur: boolean; seed: number };

export const SCAN_LIKE: Degrade = { skewDegrees: 0.7, speckle: 0.004, blur: true, seed: 7 };

function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Rotates about the centre by `degrees` (nearest neighbour), white outside. */
export function skew(gray: Gray, degrees: number): Gray {
  const { width, height, data } = gray;
  const out = new Uint8Array(width * height).fill(255);
  const t = (degrees * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  const cx = width / 2;
  const cy = height / 2;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // Inverse map: where in the source does this output pixel come from.
      const dx = x - cx;
      const dy = y - cy;
      const sx = Math.round(cx + dx * cos + dy * sin);
      const sy = Math.round(cy - dx * sin + dy * cos);
      if (sx >= 0 && sy >= 0 && sx < width && sy < height) out[y * width + x] = data[sy * width + sx];
    }
  }
  return { width, height, data: out };
}

/** Flips a fraction of pixels dark and lightens a few dark ones — scanner dust and dropouts. */
export function speckle(gray: Gray, fraction: number, seed: number): Gray {
  const out = new Uint8Array(gray.data);
  const rand = lcg(seed);
  const n = Math.round(fraction * out.length);
  for (let i = 0; i < n; i += 1) {
    const at = Math.floor(rand() * out.length);
    out[at] = rand() < 0.7 ? 0 : 255;
  }
  return { ...gray, data: out };
}

/** A 3×3 box blur. */
export function blur3(gray: Gray): Gray {
  const { width, height, data } = gray;
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          sum += data[yy * width + xx];
          n += 1;
        }
      }
      out[y * width + x] = Math.round(sum / n);
    }
  }
  return { width, height, data: out };
}

export function degrade(gray: Gray, how: Degrade): Gray {
  let out = how.skewDegrees !== 0 ? skew(gray, how.skewDegrees) : gray;
  if (how.blur) out = blur3(out);
  if (how.speckle > 0) out = speckle(out, how.speckle, how.seed);
  return out;
}
