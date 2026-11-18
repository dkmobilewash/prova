/**
 * ── WHICH VIEW A SCRIPT MAY CALIBRATE A MULTI-VIEW SHEET FROM ──
 *
 * Ingest declines a page-wide scale on a sheet carrying several drawings and
 * stores each drawing's captioned scale instead (`viewScales`). The review
 * scripts used to calibrate such a sheet from its BIGGEST view, by width and
 * then by area (#1183, #1213). Mid-City A4.0 (p63) showed no size rule can be
 * right: its roof plan (1/16") out-areas the floor plan being keyed (3/32"),
 * so every wall measured 1.5x long.
 *
 * Diego's ruling (2026-11-18): when the views print DIFFERENT scales there is
 * no automatic calibration; the person picks the drawing's scale with one
 * press in the workspace (`ToolbarViewScaleOffer`). Only when every view
 * prints the same scale can the biggest one stand for the sheet, because then
 * it cannot pick wrong. Scales are compared as feet per paper inch, so two
 * spellings of 1/8" are one scale.
 */
export function viewToCalibrate(views) {
  const scales = [...new Map(views.map((v) => [Math.round(v.feetPerInch * 1000), v.scaleName])).values()];
  if (views.length === 0 || scales.length > 1) return { view: null, scales };
  const area = (v) => Math.abs(v.to - v.from) * Math.abs((v.toY ?? 0) - (v.fromY ?? 0));
  return { view: [...views].sort((a, b) => area(b) - area(a))[0], scales };
}
