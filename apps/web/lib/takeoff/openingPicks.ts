import type { ProposedOpening } from "./openingProposals";

/**
 * ── FROM "N OPENINGS DRAWN ON THESE WALLS" TO OPENINGS ON THE ESTIMATE ──
 *
 * The decisions behind the row `ProposedOpenings` renders, kept pure so a test
 * can be their caller — the same move `wallProposal.ts` made for the detector's
 * writes.
 *
 * The rule it enforces is the one `openingProposals.ts` states: the drawing
 * gives a WIDTH and never a height. So a proposal becomes an opening on the
 * estimate only once a person has typed its height, and an untouched row sends
 * nothing at all. A pre-filled 7'-0" would have been faster and would have been
 * a number nobody chose, deducted from a bid.
 *
 * Where they go: the same `openingWidth`/`openingHeight` pairs the measurement
 * list's "Add an opening" rows post, read by the same `wallOpeningsFromForm`,
 * onto the same `WallRun.openings` — so the company's own deduction answer
 * (never / only the big ones / all, `OpeningDeductionForm`) applies to them in
 * `boardedArea` exactly as it does to a typed one. Nothing downstream can tell
 * a confirmed proposal from a hand-typed row, which is the point.
 */

/** One row a person can confirm. Strings, because they are form fields. */
export type OpeningPick = {
  kind: ProposedOpening["kind"];
  leaves: 1 | 2;
  /** As measured, editable: a drawn 2'-11.5" is a 3'-0" door to most people. */
  width: string;
  /** Blank until somebody types it. Never defaulted. */
  height: string;
  /** Ticked by default only because a blank height already sends nothing. */
  keep: boolean;
};

type RunWithOpenings = { proposedOpenings?: readonly ProposedOpening[] };

/** Every drawn opening on a group's runs, in run order then along each run. */
export function drawnOpenings(runs: readonly RunWithOpenings[]): ProposedOpening[] {
  return runs.flatMap((run) => run.proposedOpenings ?? []);
}

/** The rows, widths to the inch — the drawing is not more precise than that. */
export function initialPicks(runs: readonly RunWithOpenings[]): OpeningPick[] {
  return drawnOpenings(runs).map((opening) => ({
    kind: opening.kind,
    leaves: opening.leaves ?? 1,
    width: (Math.round(opening.widthFt * 12) / 12).toFixed(2),
    height: "",
    keep: true,
  }));
}

/** `3'-0"` from feet, for the summary. */
function feetInches(ft: number): string {
  const inches = Math.round(ft * 12);
  return `${Math.floor(inches / 12)}'-${inches % 12}"`;
}

/**
 * "2 doors (3'-0", 6'-0" pair) and 1 window (4'-0") drawn in these walls", or
 * null when there are none — the row renders nothing rather than "0 openings".
 */
export function openingsSentence(runs: readonly RunWithOpenings[]): string | null {
  const all = drawnOpenings(runs);
  if (all.length === 0) return null;
  const part = (kind: ProposedOpening["kind"], one: string, many: string) => {
    const these = all.filter((o) => o.kind === kind);
    if (these.length === 0) return null;
    const widths = these.map((o) => `${feetInches(o.widthFt)}${o.leaves === 2 ? " pair" : ""}`);
    return `${these.length} ${these.length === 1 ? one : many} (${widths.join(", ")})`;
  };
  const parts = [part("door", "door", "doors"), part("window", "window", "windows")].filter(
    (p): p is string => p !== null,
  );
  return `${parts.join(" and ")} drawn in these walls`;
}

/**
 * Put the confirmed openings on a form, as the `openingWidth`/`openingHeight`
 * pairs `wallOpeningsFromForm` (`lib/actions/takeoff.ts`) reads — the same two
 * field names the measurement list's typed rows use, so the server cannot tell
 * them apart. Returns the problems instead of appending anything when there
 * are any: a half-sent set of openings is worse than none.
 */
export function appendOpeningPairs(form: FormData, picks: readonly OpeningPick[]): string[] {
  const { pairs, problems } = openingPairs(picks);
  if (problems.length > 0) return problems;
  for (const pair of pairs) {
    form.append("openingWidth", String(pair.widthFt));
    form.append("openingHeight", String(pair.heightFt));
  }
  return [];
}

/** A positive number typed the way this app reads numbers, or null. */
function positive(raw: string): number | null {
  const text = raw.trim();
  if (text === "") return null;
  const n = Number(text);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The pairs to post, and the rows that cannot be — in words.
 *
 * A ticked row with a height but an unreadable width, or a height that is not a
 * number, is NAMED rather than dropped: the estimator typed something and
 * expects it to count. A ticked row with NO height is simply not sent, and is
 * counted so the screen can say how many are still waiting on one.
 */
export function openingPairs(picks: readonly OpeningPick[]): {
  pairs: { widthFt: number; heightFt: number }[];
  waiting: number;
  problems: string[];
} {
  const pairs: { widthFt: number; heightFt: number }[] = [];
  const problems: string[] = [];
  let waiting = 0;
  picks.forEach((pick, index) => {
    if (!pick.keep) return;
    if (pick.height.trim() === "") {
      waiting += 1;
      return;
    }
    const width = positive(pick.width);
    const height = positive(pick.height);
    const name = `${pick.kind === "door" ? "Door" : "Window"} ${index + 1}`;
    if (width === null) problems.push(`${name}: the width needs a number of feet.`);
    else if (height === null) problems.push(`${name}: the height needs a number of feet.`);
    else pairs.push({ widthFt: width, heightFt: height });
  });
  return { pairs, waiting, problems };
}
