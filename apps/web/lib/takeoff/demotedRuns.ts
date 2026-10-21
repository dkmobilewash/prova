import type { WallClassifyLabel } from "@prova/integrations";

/**
 * ── DEMOTE, DON'T HIDE ──
 *
 * "Check these are walls" labels each run in view, and a run labelled
 * casework or reference leaves the found-walls list. Before this it left the
 * SHEET too — no row, no line, and the only way back was Find the walls,
 * which starts the whole sheet over. So a wrong verdict cost the estimator
 * everything they had already accepted.
 *
 * With the company's switch on (`Company.demotedWallsOn`, OFF by default) a
 * demoted run stays drawn, greyed, with the model's own reason beside it and
 * one button to take it back. It is still OUT of the total: the number on
 * the panel never includes a run nobody has accepted. Never in `?key=1`
 * labelling mode, which has its own review of every line.
 *
 * Pure and small on purpose: the viewer cannot be driven through a check in
 * happy-dom (it crops a canvas), so what it does with the verdicts is tested
 * here and the real browser proves the wiring.
 */
export type RunVerdict = { label: WallClassifyLabel; reason: string };

/** A verdict that takes the run out of the found-walls total. */
export function demotes(label: WallClassifyLabel): boolean {
  return label === "CASEWORK" || label === "REFERENCE";
}

export type DemotedRun = { at: number; label: WallClassifyLabel; reason: string; lengthFeet: number };

/** The runs the check set aside, in run order, with what it said and why. */
export function demotedRuns(
  verdicts: ReadonlyMap<number, RunVerdict> | null,
  runs: readonly { lengthFeet: number }[],
): DemotedRun[] {
  if (verdicts === null) return [];
  const out: DemotedRun[] = [];
  for (const [at, v] of verdicts) {
    const run = runs[at];
    if (run === undefined || !demotes(v.label)) continue;
    out.push({ at, label: v.label, reason: v.reason, lengthFeet: run.lengthFeet });
  }
  return out.sort((a, b) => a.at - b.at);
}

export function demotedSentence(list: readonly DemotedRun[]): string {
  const feet = Math.round(list.reduce((n, d) => n + d.lengthFeet, 0));
  const one = list.length === 1;
  return `${list.length} run${one ? "" : "s"} probably not ${one ? "a wall" : "walls"} — ${feet.toLocaleString()} ft, not in the total.`;
}

export function demotedWord(label: WallClassifyLabel): string {
  return label === "CASEWORK" ? "casework" : "reference line";
}
