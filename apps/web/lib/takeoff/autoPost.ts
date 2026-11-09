import type { PostSource } from "./postingGate";

/**
 * ── WHICH SOURCES POST THEMSELVES, AND THE EVIDENCE FOR EACH ──
 *
 * Diego, 2026-11-08: a source posts its walls without a person only once it
 * is right ≥97% of the time on the training keys AND ≥95% on the held-out
 * keys (measured once). A wrong auto-post misprices a bid silently, so the
 * bar is both numbers, never one.
 *
 * Each row carries the numbers it was measured at: footage scored, share
 * correct, the date, and how many keyed sheets each figure covers. A source
 * goes on by changing its numbers to a new measurement, never by flipping
 * a flag: `autoPosts` reads the bar off the row.
 *
 * Measured 2026-11-08 on labels-snap-20261108T2022 (runs-r15b), every
 * training sheet with a type key and the held-out sheets once. Heldout
 * `null` = the source typed no keyed held-out footage, so it is unproven
 * there and cannot pass.
 */
export const BAR = { trainingPct: 97, heldOutPct: 95 } as const;

export type SourceEvidence = {
  trainingPct: number | null;
  trainingFt: number;
  heldOutPct: number | null;
  heldOutFt: number;
  measured: string;
  trainingSheets: number;
  heldOutSheets: number;
};

export const EVIDENCE: Record<PostSource, SourceEvidence> = {
  tag: { trainingPct: 95.5, trainingFt: 947, heldOutPct: 82.1, heldOutFt: 1681, measured: "2026-11-08", trainingSheets: 9, heldOutSheets: 7 },
  "tag-variant": { trainingPct: 78.0, trainingFt: 419, heldOutPct: 100, heldOutFt: 1788, measured: "2026-11-08", trainingSheets: 9, heldOutSheets: 7 },
  carried: { trainingPct: 82.4, trainingFt: 130, heldOutPct: 24.8, heldOutFt: 637, measured: "2026-11-08", trainingSheets: 9, heldOutSheets: 7 },
  sibling: { trainingPct: 71.0, trainingFt: 193, heldOutPct: null, heldOutFt: 0, measured: "2026-11-08", trainingSheets: 9, heldOutSheets: 7 },
  note: { trainingPct: 91.0, trainingFt: 1023, heldOutPct: null, heldOutFt: 0, measured: "2026-11-08", trainingSheets: 9, heldOutSheets: 7 },
  thickness: { trainingPct: null, trainingFt: 0, heldOutPct: 10.2, heldOutFt: 32, measured: "2026-11-08", trainingSheets: 9, heldOutSheets: 7 },
};

/** Whether a source's own measurement clears the bar — both numbers, held-out measured. */
export function clearsBar(e: SourceEvidence): boolean {
  return e.trainingPct !== null && e.heldOutPct !== null && e.trainingPct >= BAR.trainingPct && e.heldOutPct >= BAR.heldOutPct;
}

/** The sources that post themselves today: none, until one measures past the bar. */
export function autoPosts(source: PostSource): boolean {
  return clearsBar(EVIDENCE[source]);
}

/** The label an auto-posted run carries — read back by the queue's count and by Undo. */
export const AUTO_MARK = "(auto, from ";
export function autoLabel(code: string, from: string): string {
  return `${code} wall ${AUTO_MARK}${from})`;
}
export function isAutoLabel(label: string | null): boolean {
  return label !== null && label.includes(AUTO_MARK);
}

/** "312 ft posted automatically · 4 groups need you" — the queue's first line. */
export function queueHeader(autoFeet: number, groupsLeft: number): string | null {
  const auto = Math.round(autoFeet);
  if (auto <= 0) return null;
  return `${auto.toLocaleString("en-US")} ft posted automatically · ${groupsLeft} group${groupsLeft === 1 ? "" : "s"} need${groupsLeft === 1 ? "s" : ""} you`;
}
