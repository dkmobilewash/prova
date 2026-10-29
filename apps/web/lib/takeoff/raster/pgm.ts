/**
 * An 8-bit greyscale raster, the way the scanned-plans lane passes a page
 * around: one byte per pixel, rows top to bottom. PGM (P5) is the file form —
 * a 3-line header and the bytes — because nothing here needs a PNG decoder.
 */
export type Gray = { width: number; height: number; data: Uint8Array };

export function readPgm(bytes: Uint8Array): Gray {
  // Header fields separated by whitespace: P5, width, height, maxval.
  const fields: string[] = [];
  let i = 0;
  let cur = "";
  while (fields.length < 4 && i < bytes.length) {
    const c = bytes[i++];
    if (c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09) {
      if (cur !== "") fields.push(cur);
      cur = "";
    } else cur += String.fromCharCode(c);
  }
  if (fields[0] !== "P5") throw new Error("not a P5 PGM");
  const width = Number(fields[1]);
  const height = Number(fields[2]);
  return { width, height, data: bytes.subarray(i, i + width * height) };
}

export function writePgm(gray: Gray): Uint8Array {
  const header = new TextEncoder().encode(`P5\n${gray.width} ${gray.height}\n255\n`);
  const out = new Uint8Array(header.length + gray.data.length);
  out.set(header);
  out.set(gray.data, header.length);
  return out;
}

/** A blank white page, for tests and for drawing synthetic lines into. */
export function blank(width: number, height: number): Gray {
  return { width, height, data: new Uint8Array(width * height).fill(255) };
}

/** Draws a dark line of the given pixel thickness, for tests. */
export function drawLine(gray: Gray, x1: number, y1: number, x2: number, y2: number, thickness = 1, value = 0): void {
  const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1)));
  const half = thickness / 2;
  for (let s = 0; s <= steps; s += 1) {
    const cx = x1 + ((x2 - x1) * s) / steps;
    const cy = y1 + ((y2 - y1) * s) / steps;
    for (let dy = -half; dy < half || (half === 0.5 && dy === -0.5); dy += 1) {
      for (let dx = -half; dx < half || (half === 0.5 && dx === -0.5); dx += 1) {
        const px = Math.round(cx + dx);
        const py = Math.round(cy + dy);
        if (px >= 0 && py >= 0 && px < gray.width && py < gray.height) gray.data[py * gray.width + px] = value;
      }
    }
  }
}
