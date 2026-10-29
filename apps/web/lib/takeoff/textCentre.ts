/**
 * ── WHERE A TEXT ITEM'S MIDDLE IS, WHICHEVER WAY IT RUNS ──
 *
 * A text item from `pageText` carries the START of its run (`x`, `y`, screen
 * convention), its `width` ALONG the run, its `height` across it, and — since
 * 2026-10-29 — the run's `angle`. Every rule that asked "is there a number
 * near this line" computed the middle as (x + width/2, y − height/2), which
 * is right only for text that runs left to right. A vertical dimension
 * string's figures run up the page (angle −π/2), so that middle sat two to
 * three feet from the figure and the string read as an unlabelled pair of
 * lines. One helper, so the geometry is written once.
 */
export type TextItemLike = { x: number; y: number; width: number; height: number; angle?: number };

export function textItemCentre(item: TextItemLike): { x: number; y: number } {
  const a = item.angle ?? 0;
  const dx = Math.cos(a), dy = Math.sin(a);
  // "Up" for the glyphs is the run's direction turned a quarter turn
  // anticlockwise ON SCREEN, which with y down is (dy, −dx): for ordinary text
  // that is (0, −1), the old `y − height / 2`.
  return { x: item.x + (dx * item.width) / 2 + (dy * item.height) / 2, y: item.y + (dy * item.width) / 2 - (dx * item.height) / 2 };
}
