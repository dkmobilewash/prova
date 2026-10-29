// ── WHICH TILES OF A GREY GET READ, AND IN WHAT ORDER ──
//
// Pure, so it can be tested without Tesseract. The worker walks the tiles
// in this order, reads only the ones that touch a region and were not read
// before, and skips a tile with no ink in it — Tesseract on a blank tile
// returns nothing after a quarter of a second, and a plan sheet's margins
// are a third of its tiles. Every tile considered is still reported in
// `tileKeys`, blank or not, so a later call over the rest of the page does
// not come back to it.

/** Dark pixels below which a tile is blank. A single glyph at 200 dpi leaves hundreds. */
export const BLANK_TILE_INK = 40;

/** Dark pixels in a window of the grey, counted only up to `enough`. */
export function inkIn(gray, width, x0, y0, tw, th, enough) {
  let ink = 0;
  for (let y = 0; y < th; y += 1) {
    const row = (y0 + y) * width + x0;
    for (let x = 0; x < tw; x += 1) {
      if (gray[row + x] < 128) {
        ink += 1;
        if (ink >= enough) return ink;
      }
    }
  }
  return ink;
}

/**
 * The tiles to read, in order, and the keys of every tile considered.
 * `regions` null means the whole page; `skip` holds keys already read.
 */
export function planTiles(gray, width, height, tile, overlap, regions, skip) {
  const touches = (x0, y0, tw, th) =>
    regions === null || regions.some((r) => x0 < r.x + r.width && x0 + tw > r.x && y0 < r.y + r.height && y0 + th > r.y);
  const plan = [];
  const tileKeys = [];
  for (let y0 = 0; y0 < height; y0 += tile - overlap) {
    const th = Math.min(tile, height - y0);
    for (let x0 = 0; x0 < width; x0 += tile - overlap) {
      const tw = Math.min(tile, width - x0);
      const key = `${x0}:${y0}`;
      if (touches(x0, y0, tw, th) && !skip.has(key)) {
        tileKeys.push(key);
        if (inkIn(gray, width, x0, y0, tw, th, BLANK_TILE_INK) >= BLANK_TILE_INK) plan.push({ x0, y0, tw, th });
      }
      if (x0 + tw >= width) break;
    }
    if (y0 + th >= height) break;
  }
  return { plan, tileKeys };
}
