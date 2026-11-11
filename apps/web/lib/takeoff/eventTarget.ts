/**
 * The `target` of a takeoff event: which wall group an act was on, as a hash of the
 * group's run coordinates, so a later Undo or Set type on the same group can be
 * matched to the accept before it (`TakeoffEvent`). Nothing of the drawing can be
 * read back from it. Pure and import-free: the queue (client) and the actions
 * (server) must compute the same value.
 *
 * Coordinates are rounded to 4 places (a page-width unit; ~0.2 pt on a 2592 pt
 * sheet) and each run's ends put in order, so the same group read again a hair off
 * or drawn the other way hashes the same.
 */
export type TargetRun = { x1: number; y1: number; x2: number; y2: number };

const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

export function groupTarget(planId: string, pageNumber: number, runs: readonly TargetRun[]): string {
  const canonical = runs
    .map((r) => {
      const a = [r4(r.x1), r4(r.y1)];
      const b = [r4(r.x2), r4(r.y2)];
      const [p, q] = a[0]! < b[0]! || (a[0] === b[0] && a[1]! <= b[1]!) ? [a, b] : [b, a];
      return `${p.join(",")};${q.join(",")}`;
    })
    .sort()
    .join("|");
  return `${fnv1a(`${planId}:${pageNumber}:${canonical}`, 0x811c9dc5)}${fnv1a(canonical, 0x01000193)}`;
}

/** 32-bit FNV-1a as 8 hex digits: a fingerprint, not security. */
function fnv1a(text: string, seed: number): string {
  let hash = seed >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
