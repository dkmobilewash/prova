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

/**
 * ── THE NARROWER, TWO-SIGNAL SOURCES, MEASURED 2026-11-09: NONE CLEARS, SO NONE IS BUILT ──
 *
 * Same runs (runs-ap, 16 sheets) and labels; held-out measured once. Precision is of
 * the footage the rule would post.
 *
 * | source | training | held-out |
 * | --- | --- | --- |
 * | type: printed tag AND drawn thickness = the type's legend thickness ±1/2" AND no other type's tag within 3 ft | 78 ft, 97.3% (2 ft wrong) | 0 ft — unproven |
 * | type: "unless noted" AND thickness ±1/2" AND no tag within 3 ft | 0 ft | 0 ft |
 * | height: a figure printed on the type ("fixed") | 0 ft | 142 ft, 17.6% |
 * | height: the type's own rule, exactly one section level | 172 ft, 100% | 0 ft — unproven |
 *
 * The thickness signal is what starves both type rules: most legends print no
 * thickness (Joplin 0 of 5 types, OReillys 0/6, Baker 2/8, Hutto 4/14), so the
 * second signal cannot agree, and on the sets that do print it no keyed held-out
 * footage passes. Windows (tag AND an exterior frame within 2 ft) and doors (after
 * ROUND 17's key) are measured by the window eval's owner. Touch-free stays 0.0% in
 * every group: no source posts.
 */

/** Whether a source's own measurement clears the bar — both numbers, held-out measured. */
export function clearsBar(e: SourceEvidence): boolean {
  return e.trainingPct !== null && e.heldOutPct !== null && e.trainingPct >= BAR.trainingPct && e.heldOutPct >= BAR.heldOutPct;
}

/** The sources that post themselves today: none, until one measures past the bar. */
export function autoPosts(source: PostSource): boolean {
  return clearsBar(EVIDENCE[source]);
}

/**
 * ── DOORS: THE FIRST SOURCE PAST THE BAR ──
 *
 * Measured 2026-11-10 against ROUND 17's door keys (labels-snap-20261110T0122; training
 * Baker A101, Topeka A-101, Joplin A-101; held-out USU A121, Riverbend A1.1, measured once).
 * A finder door matches a key door when the key point lies inside its swing (leaf width
 * + 1 ft of the hinge); the finder and the keys both see swing doors only.
 *
 * | source | training | held-out |
 * | --- | --- | --- |
 * | a door with a printed mark beside it (`doorMarks`) | 97.1% (34 doors, 1 false) | 100% (13, 0 false) |
 * | every door found | 93.6% (146, 10 false) | 86.5% (45, 7 false) |
 *
 * Marked doors clear ≥97% / ≥95%, so they post themselves as a count (one point per door,
 * "Doors (auto, from printed mark)"), with Undo. Every door found does not, and stays as
 * the wall openings it already was. A thin sample: 47 marked doors, and one false door on
 * training would have failed the bar; re-measure as keys are added.
 */
export type DoorSource = "door-marked" | "door-any";
export const DOOR_EVIDENCE: Record<DoorSource, SourceEvidence> = {
  "door-marked": { trainingPct: 97.1, trainingFt: 34, heldOutPct: 100, heldOutFt: 13, measured: "2026-11-10", trainingSheets: 3, heldOutSheets: 2 },
  "door-any": { trainingPct: 93.6, trainingFt: 146, heldOutPct: 86.5, heldOutFt: 45, measured: "2026-11-10", trainingSheets: 3, heldOutSheets: 2 },
};
/** Whether a door source posts itself: its own measurement against the same bar. (For doors the "Ft" fields count doors.) */
export function doorAutoPosts(source: DoorSource): boolean {
  return clearsBar(DOOR_EVIDENCE[source]);
}
/** The item the auto-posted doors are counted on, and the label their count carries. */
export const AUTO_DOORS_ITEM = "Doors";
export const AUTO_DOORS_LABEL = "Doors (auto, from printed mark)";

/** The label an auto-posted run carries — read back by the queue's count and by Undo. */
export const AUTO_MARK = "(auto, from ";
export function autoLabel(code: string, from: string): string {
  return `${code} wall ${AUTO_MARK}${from})`;
}
export function isAutoLabel(label: string | null): boolean {
  return label !== null && label.includes(AUTO_MARK);
}

/** "312 ft and 14 doors posted automatically · 4 groups need you" — the queue's first line. */
export function queueHeader(autoFeet: number, groupsLeft: number, autoDoors = 0): string | null {
  const auto = Math.round(autoFeet);
  if (auto <= 0 && autoDoors <= 0) return null;
  const what = [auto > 0 ? `${auto.toLocaleString("en-US")} ft` : null, autoDoors > 0 ? `${autoDoors} door${autoDoors === 1 ? "" : "s"}` : null].filter(Boolean).join(" and ");
  return `${what} posted automatically · ${groupsLeft} group${groupsLeft === 1 ? "" : "s"} need${groupsLeft === 1 ? "s" : ""} you`;
}
