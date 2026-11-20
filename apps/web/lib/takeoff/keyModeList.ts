import type { WallCandidate } from "./wallVectors";

/**
 * ── THE CUSTOMER PANEL NEVER SHOWS ANSWER-KEY MODE'S LIST ──
 *
 * Answer-key mode keeps the finder's RAW runs, on purpose: a key grades the
 * finder, so nothing may be filtered before a reviewer sees it. That list is
 * written into the same `found` state the customer's Layers / Quantities panel
 * reads, and nothing cleared it when key mode was turned off. Jane Hahan A2.1,
 * :3010, 2026-11-19: a key-mode find left "Found 119 runs of wall, 1,332 ft"
 * on the customer panel — the title block, the notes column, the legend's
 * sample lines, the grid lines — where the customer's own find offers 4.
 * Every measurement of the offered list was right; the screen was showing a
 * different list.
 *
 * So every find also keeps the customer offer (`offeredCandidates`, the same
 * call the customer find makes), and turning key mode off puts THAT on the
 * panel. On a sheet paired with its demolition plan the panel is cleared
 * instead: key mode skips the plan comparison, so the kept offer would hold
 * walls the customer find sets aside as existing to remain.
 */
export type KeyModeOff =
  | { kind: "keep" }
  | { kind: "offer"; runs: WallCandidate[] }
  | { kind: "clear" };

export function afterKeyModeOff(input: {
  /** The list on the panel came from a find made in answer-key mode. */
  builtInKeyMode: boolean;
  pageNumber: number;
  /** The customer offer that find kept, and the page it was for. */
  customer: { page: number; runs: WallCandidate[] } | null;
  /** This sheet is paired with a demolition plan for the plan comparison. */
  paired: boolean;
}): KeyModeOff {
  if (!input.builtInKeyMode) return { kind: "keep" };
  if (input.paired || input.customer === null || input.customer.page !== input.pageNumber) return { kind: "clear" };
  return { kind: "offer", runs: input.customer.runs };
}
