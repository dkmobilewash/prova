/** Types for `tilePlan.mjs`, which stays plain JS because the sheet worker imports it without a build step. */
export const BLANK_TILE_INK: number;
export function inkIn(gray: Uint8Array, width: number, x0: number, y0: number, tw: number, th: number, enough: number): number;
export function planTiles(
  gray: Uint8Array,
  width: number,
  height: number,
  tile: number,
  overlap: number,
  regions: readonly { x: number; y: number; width: number; height: number }[] | null,
  skip: ReadonlySet<string>,
): { plan: { x0: number; y0: number; tw: number; th: number }[]; tileKeys: string[] };
