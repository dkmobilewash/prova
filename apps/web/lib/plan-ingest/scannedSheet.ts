/**
 * Whether a page is a SCAN — an image of a drawing rather than the drawing.
 *
 * Derived, never stored: the inventory records what the file has (a text
 * layer or not; for a page without one, how many path and image operators
 * its content stream carries) and this reads the verdict off those. A page
 * with no text, no paths and at least one image is a scan. A page the
 * inventory read before the counts existed (both null) is judged by its
 * text layer alone, which is what the viewer's "Read this sheet" has always
 * gone by.
 */
export function isScannedSheet(row: { hasTextLayer: boolean; pathOperators?: number | null; imageOperators?: number | null }): boolean {
  if (row.hasTextLayer) return false;
  if (row.pathOperators == null || row.imageOperators == null) return true;
  return row.pathOperators === 0 && row.imageOperators > 0;
}
