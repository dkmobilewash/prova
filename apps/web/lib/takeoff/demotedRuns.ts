import type { WallClassifyLabel } from "@prova/integrations";
import { scoreCandidate, type WallModel } from "./wallClassifier";

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
/**
 * Two sources, one list. `MODEL` is the trained wall classifier doubting a
 * run at Find time (no model call, no cost); the Clerk-style labels are the
 * "Check these are walls" second opinion, which overwrites a MODEL verdict
 * for every run it sees — so an AI "WALL" puts a model-demoted run back.
 */
export type DemotionLabel = WallClassifyLabel | "MODEL";
export type RunVerdict = { label: DemotionLabel; reason: string; score?: number };

/** A verdict that takes the run out of the found-walls total. */
export function demotes(label: DemotionLabel): boolean {
  return label === "CASEWORK" || label === "REFERENCE" || label === "MODEL";
}

export type DemotedRun = { at: number; label: DemotionLabel; reason: string; lengthFeet: number };

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

/** The word after "probably not a wall —"; null when the reason says it all. */
export function demotedWord(label: DemotionLabel): string | null {
  if (label === "MODEL") return null;
  return label === "CASEWORK" ? "casework" : "reference line";
}

type Line = { x1: number; y1: number; x2: number; y2: number };
const lengthOf = (l: Line) => Math.hypot(l.x2 - l.x1, l.y2 - l.y1);

/**
 * Does this pairing lie along this run? Parallel, within a wall's thickness
 * of it, and at least half of it inside the run's extent. The finder merges
 * collinear pairings into one run, so a run can own several; the labelling
 * side matches the same way (`labelRows.belongsTo`, kept private there and
 * in another lane, hence the copy).
 */
function along(run: Line & { thicknessFeet: number }, p: Line & { thicknessFeet: number }, feetPerUnit: number): boolean {
  const rl = lengthOf(run);
  const pl = lengthOf(p);
  if (rl === 0 || pl === 0) return false;
  const ux = (run.x2 - run.x1) / rl;
  const uy = (run.y2 - run.y1) / rl;
  const cos = Math.abs(((p.x2 - p.x1) * ux + (p.y2 - p.y1) * uy) / pl);
  if (cos < 0.98) return false;
  const mx = (p.x1 + p.x2) / 2 - run.x1;
  const my = (p.y1 + p.y2) / 2 - run.y1;
  const band = Math.max(run.thicknessFeet, p.thicknessFeet, 0.1) / feetPerUnit;
  if (Math.abs(mx * uy - my * ux) > band) return false;
  const a = (p.x1 - run.x1) * ux + (p.y1 - run.y1) * uy;
  const b = (p.x2 - run.x1) * ux + (p.y2 - run.y1) * uy;
  const overlap = Math.min(Math.max(a, b), rl) - Math.max(Math.min(a, b), 0);
  return overlap >= 0.5 * pl;
}

export type ScoredPairing = Line & { thicknessFeet: number; features: number[] };

/**
 * The model's verdicts at Find time: a run is demoted when EVERY pairing it
 * is made of scores below the cut, and the reason carries the best of them.
 * A run with no pairing of its own (a template, a hand-drawn line) is never
 * demoted — the model has nothing to say about it. Conservative on purpose:
 * the finder's own veto drops a single refused pairing out of a merged run,
 * and a half-demoted run on screen would be a line nobody can attribute.
 */
export function modelVerdicts(
  model: WallModel,
  cut: number,
  runs: readonly (Line & { thicknessFeet: number })[],
  pairings: readonly ScoredPairing[],
  feetPerUnit: number,
): Map<number, RunVerdict> {
  const out = new Map<number, RunVerdict>();
  runs.forEach((run, at) => {
    let best = -1;
    for (const p of pairings) {
      if (!along(run, p, feetPerUnit)) continue;
      best = Math.max(best, scoreCandidate(model, p.features));
      if (best >= cut) break;
    }
    if (best >= 0 && best < cut) {
      // Floored, not rounded: 0.296 against a cut of 0.3 must not print as
      // "0.30", which reads as a run demoted at the cut itself.
      const shown = (Math.floor(best * 100) / 100).toFixed(2);
      out.set(at, { label: "MODEL", reason: `the wall model doubts this one (score ${shown})`, score: best });
    }
  });
  return out;
}
