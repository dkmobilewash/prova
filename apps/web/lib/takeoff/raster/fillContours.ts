import type { Gray } from "./pgm";
import { blur3 } from "./rasterDegrade";

/**
 * ── THE EDGES OF GREY FILLS, BY CONTOUR RATHER THAN BY RUNS ──
 *
 * A sheet that draws its existing walls as light-grey poché, or its rooms
 * as grey fills, carries the walls as the WHITE gaps between greys. The
 * run-based fill pass found those edges but drew one at every line of
 * lettering inside a room too, because text splits a row's run and so
 * splits the band (Baker A100: 99% by vector, 36% by runs).
 *
 * This reads the fills as SHAPES. A white region SMALLER than a few square
 * inches is a hole in a fill — lettering, a symbol, a door swing — and is
 * filled in; a larger one is paper, or a wall drawn as the white gap between
 * two greys. The fill's edge is then the pixels of the shape that touch
 * large white: the room's walls, and nothing inside the room. Those edge
 * pixels go back through the run-and-band pass as thin ink, which turns
 * them into straight faces.
 *
 * NOT "white reachable from the border": that was the first version, and it
 * sealed every wall the door lines closed off into a hole, so a whole wing
 * came out as one shape with one outline (Baker A100: 163 ft of 1,681).
 *
 * Done at half resolution: a fill is a coarse thing, and the flood fill is
 * one pass over the pixels with an explicit stack.
 */

export type FillEdges = {
  /** A page of the same size whose edge pixels are 0 and everything else 255. */
  edges: Gray;
  /** How many fills had an edge, for the eval's own control. */
  shapes: number;
};

export function fillEdges(gray: Gray, options: { fillThreshold?: number; downsample?: number; dpi?: number; maxHoleInches2?: number } = {}): FillEdges {
  const cut = options.fillThreshold ?? 245;
  const k = options.downsample ?? 2;
  // A hole no bigger than this, in square inches on the sheet, is filled in.
  const dpi = options.dpi ?? 150;
  const maxHole = Math.round(((options.maxHoleInches2 ?? 1.5) * dpi * dpi) / (k * k));
  const soft = blur3(gray);
  const W = Math.floor(gray.width / k);
  const H = Math.floor(gray.height / k);
  // 1 = grey or ink (part of some fill, or line work), 0 = white.
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      // The darkest of the k×k block: a thin edge survives the downsample.
      let v = 255;
      for (let dy = 0; dy < k; dy += 1) for (let dx = 0; dx < k; dx += 1) v = Math.min(v, soft.data[(y * k + dy) * gray.width + x * k + dx]);
      mask[y * W + x] = v < cut ? 1 : 0;
    }
  }
  // Outside: every white component bigger than a hole, 4-connected. Each
  // white component is flooded once; small ones are left as fill.
  const outside = new Uint8Array(W * H);
  const seen = new Uint8Array(W * H);
  const stack: number[] = [];
  const members: number[] = [];
  for (let start = 0; start < W * H; start += 1) {
    if (mask[start] !== 0 || seen[start] !== 0) continue;
    seen[start] = 1;
    stack.push(start);
    members.length = 0;
    while (stack.length > 0) {
      const i = stack.pop()!;
      members.push(i);
      const x = i % W;
      const y = (i - x) / W;
      const step = (j: number) => {
        if (mask[j] === 0 && seen[j] === 0) {
          seen[j] = 1;
          stack.push(j);
        }
      };
      if (x > 0) step(i - 1);
      if (x < W - 1) step(i + 1);
      if (y > 0) step(i - W);
      if (y < H - 1) step(i + W);
    }
    if (members.length > maxHole) for (const i of members) outside[i] = 1;
  }
  // Edge: a non-outside pixel with an outside 4-neighbour. A drawn LINE is
  // a shape too, and its outline is the line itself twice over — so an edge
  // counts only beside an INTERIOR pixel (non-outside, not itself an edge):
  // a fill has an inside, a line does not. Written back at full resolution
  // over the k×k block, so a face sits where the fill's edge was.
  const rim = new Uint8Array(W * H);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = y * W + x;
      if (outside[i] === 1) continue;
      if ((x > 0 && outside[i - 1] === 1) || (x < W - 1 && outside[i + 1] === 1) || (y > 0 && outside[i - W] === 1) || (y < H - 1 && outside[i + W] === 1)) rim[i] = 1;
    }
  }
  const interior = (i: number) => outside[i] === 0 && rim[i] === 0;
  const edges = new Uint8Array(gray.width * gray.height).fill(255);
  let edgePixels = 0;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = y * W + x;
      if (rim[i] === 0) continue;
      let beside = false;
      for (let dy = -1; dy <= 1 && !beside; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          if (interior(yy * W + xx)) {
            beside = true;
            break;
          }
        }
      }
      if (!beside) continue;
      edgePixels += 1;
      for (let dy = 0; dy < k; dy += 1) for (let dx = 0; dx < k; dx += 1) edges[(y * k + dy) * gray.width + x * k + dx] = 0;
    }
  }
  // Shapes: count components of the edge mask would be another flood; the
  // eval only needs "something was found", so edge pixels stand in.
  return { edges: { width: gray.width, height: gray.height, data: edges }, shapes: edgePixels };
}
