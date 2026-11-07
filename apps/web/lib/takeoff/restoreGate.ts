import type { ReviewState } from "./answerKeyReview";

/**
 * ── IS THIS SHEET'S REVIEW STILL UNTOUCHED, SO A SAVED FILE MAY BE RESTORED? ──
 *
 * A saved review must never overwrite work done since the sheet opened, and must
 * always come back onto a sheet nobody has touched. "Untouched" is: no more real
 * decisions than the sheet had when its candidates arrived. The finder pre-marks
 * some candidates (the grey pre-rejected duplicates), so that is not zero.
 *
 * Two mistakes made Hutto A102 reopen with 0 of its 450 saved decisions (Chrome,
 * 2026-11-07), and both are here so they cannot come back:
 *   - every candidate is a key in `verdicts`, "unreviewed" included, so counting
 *     keys counted CANDIDATES — 450 arriving read as 450 decisions;
 *   - the baseline was taken once, on the first state, which can come before the
 *     candidates do (an empty review). It is taken again whenever the candidate
 *     list changes, so the pre-marks that come with them are part of it.
 */
export type RestoreBaseline = { key: string; count: number };

export function decisionsIn(state: Pick<ReviewState, "verdicts" | "traced">): number {
  return Object.values(state.verdicts).filter((verdict) => verdict !== "unreviewed").length + state.traced.length;
}

export function restoreGate(
  baseline: RestoreBaseline,
  sheetKey: string,
  state: Pick<ReviewState, "candidates" | "verdicts" | "traced">,
): { baseline: RestoreBaseline; untouched: boolean } {
  const key = `${sheetKey}|${state.candidates.length}|${fingerprint(state.candidates.map((c) => c.id))}`;
  const decided = decisionsIn(state);
  const next = baseline.key === key ? baseline : { key, count: decided };
  return { baseline: next, untouched: decided <= next.count };
}

// A short, stable hash of the candidate ids (FNV-1a): which candidates, not just how many.
function fingerprint(ids: readonly string[]): string {
  let h = 0x811c9dc5;
  for (const id of ids) {
    for (let i = 0; i < id.length; i += 1) {
      h ^= id.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    h ^= 0x2c;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}
