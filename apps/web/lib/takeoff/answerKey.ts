/**
 * ── AN ANSWER KEY FOR ONE REAL SHEET ──
 *
 * Every accuracy number this repo trusts comes from a synthetic plan it drew
 * itself: the twenty fixtures and the bench both grade against a key computed
 * from the model, never from the PDF. That is the right way to build a bench
 * and it cannot answer the question that matters — what the detector does on a
 * drawing somebody actually issued.
 *
 * The real-plan report has therefore been reporting footage with no error bar
 * at all. "2,099 ft on A102" has been true, unchecked and unfalsifiable for
 * weeks: nobody could say whether it was 300 ft short or 400 ft over.
 *
 * A key is one person's reviewed answer for one sheet. It is slow to make —
 * which is why the workspace has a mode for it — and it is the only thing that
 * turns the real-plan numbers into measurements.
 *
 * ── IT LIVES OUTSIDE THE REPOSITORY ──
 *
 * The sheets are a client's confidential drawings. A key is DERIVED from one —
 * it is a list of wall centrelines — so it is treated exactly as the drawings
 * are: read from `REAL_PLAN_KEYS`, never committed, never copied into a
 * fixture. The format is here; the data is not.
 */

/** What counts as a wall for a key, in the words a reviewer is shown. */
export const KEY_RULES = [
  "A wall is measured along its CENTRELINE.",
  "GROSS: a door or a window does not break a wall. Measure through them.",
  "Interior and exterior partitions both count.",
  "Not furniture, casework, fixtures, curbs, grid lines, dimension strings or hatching.",
] as const;

/** One wall in a key, in page-WIDTH units like every other box in this repo. */
export type KeyWall = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  lengthFeet: number;
  /** As the reviewer judged it, in inches. Null where they did not say. */
  thicknessIn: number | null;
  /**
   * How the drawing showed this wall.
   *
   * `pair` — two faces a thickness apart, which is what the detector looks
   * for. `single` — one line, which NO pairing engine can reach. The split is
   * the point of recording it: 7,694 ft of unpaired long lines were measured
   * on one sheet and 93% of them turned out to be hatching, and only a key can
   * say what the rest are.
   */
  from: "pair" | "single";
};

export type AnswerKey = {
  /** Which sheet, by what the drawing calls itself rather than by page. */
  sheet: { set: string; page: number; number: string };
  /** Who reviewed it and when — a key is somebody's judgement, not a fact. */
  reviewedBy: string;
  reviewedAt: string;
  /** The scale it was reviewed at, so a re-scaled re-export is detectable. */
  feetPerUnit: number;
  walls: KeyWall[];
};

/**
 * Reads a key file, refusing anything that is not the shape it wrote.
 *
 * The same posture as `viewScalesFromJson`: a half-understood key is worse
 * than none, because it would silently grade a run against the wrong numbers
 * and nothing downstream could tell.
 */
export function answerKeyFromJson(value: unknown): AnswerKey | null {
  if (value === null || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const sheet = v.sheet as Record<string, unknown> | undefined;
  if (
    sheet === undefined ||
    typeof sheet.set !== "string" ||
    typeof sheet.number !== "string" ||
    typeof sheet.page !== "number"
  ) {
    return null;
  }
  if (typeof v.reviewedBy !== "string" || typeof v.reviewedAt !== "string") return null;
  if (typeof v.feetPerUnit !== "number" || !(v.feetPerUnit > 0)) return null;
  if (!Array.isArray(v.walls)) return null;

  const walls: KeyWall[] = [];
  for (const one of v.walls) {
    if (one === null || typeof one !== "object") return null;
    const w = one as Record<string, unknown>;
    const numbers = ["x1", "y1", "x2", "y2", "lengthFeet"] as const;
    if (numbers.some((k) => typeof w[k] !== "number" || !Number.isFinite(w[k] as number))) {
      return null;
    }
    if (w.from !== "pair" && w.from !== "single") return null;
    const thickness = w.thicknessIn;
    if (thickness !== null && typeof thickness !== "number") return null;
    walls.push({
      x1: w.x1 as number,
      y1: w.y1 as number,
      x2: w.x2 as number,
      y2: w.y2 as number,
      lengthFeet: w.lengthFeet as number,
      thicknessIn: (thickness as number | null) ?? null,
      from: w.from,
    });
  }
  return {
    sheet: { set: sheet.set, page: sheet.page, number: sheet.number },
    reviewedBy: v.reviewedBy,
    reviewedAt: v.reviewedAt,
    feetPerUnit: v.feetPerUnit,
    walls,
  };
}

export type ScoredWall = { lengthFeet: number; from?: "pair" | "single" };

export type KeyScore = {
  keyFeet: number;
  foundFeet: number;
  /** Signed, so over-reporting and under-reporting read differently. */
  errorPercent: number;
  missed: { lengthFeet: number; from: "pair" | "single" }[];
  extra: { lengthFeet: number }[];
  missedFeet: number;
  extraFeet: number;
  /** How the key's walls were drawn — the question only a key can answer. */
  keyFromPairs: number;
  keyFromSingles: number;
  keyFeetFromSingles: number;
};

type Run = { x1: number; y1: number; x2: number; y2: number };

/** How far a found wall's midpoint may sit from a key wall and still be it. */
const SAME_WALL_FEET = 2;

function overlapsSameLine(a: Run, b: Run, feetPerUnit: number): boolean {
  // Parallel within a few degrees, and each midpoint near the other's body.
  const angle = (r: Run) => {
    const t = Math.atan2(r.y2 - r.y1, r.x2 - r.x1);
    return t < 0 ? t + Math.PI : t;
  };
  let gap = Math.abs(angle(a) - angle(b));
  if (gap > Math.PI / 2) gap = Math.PI - gap;
  if (gap > 0.15) return false;
  const near = (r: Run, px: number, py: number) => {
    const dx = r.x2 - r.x1;
    const dy = r.y2 - r.y1;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - r.x1) * dx + (py - r.y1) * dy) / len2));
    return Math.hypot(px - (r.x1 + t * dx), py - (r.y1 + t * dy)) * feetPerUnit;
  };
  return (
    near(b, (a.x1 + a.x2) / 2, (a.y1 + a.y2) / 2) <= SAME_WALL_FEET ||
    near(a, (b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2) <= SAME_WALL_FEET
  );
}

/**
 * Grades one sheet's detection against its key.
 *
 * ── MATCHED BY PLACE, NOT BY COUNT ──
 *
 * A detector that splits one key wall into three is not wrong by three walls;
 * it is right about the footage and wrong about the count. So a key wall
 * counts as FOUND when any reported wall lies along it, and a reported wall
 * counts as EXTRA when no key wall does. Footage is reported alongside, and is
 * the number that matters for a bid.
 */
export function scoreAgainstKey(
  found: readonly (Run & ScoredWall)[],
  key: AnswerKey,
): KeyScore {
  const feetPerUnit = key.feetPerUnit;
  const keyFeet = key.walls.reduce((n, w) => n + w.lengthFeet, 0);
  const foundFeet = found.reduce((n, w) => n + w.lengthFeet, 0);

  const missed = key.walls
    .filter((k) => !found.some((f) => overlapsSameLine(k, f, feetPerUnit)))
    .map((k) => ({ lengthFeet: k.lengthFeet, from: k.from }));
  const extra = found
    .filter((f) => !key.walls.some((k) => overlapsSameLine(k, f, feetPerUnit)))
    .map((f) => ({ lengthFeet: f.lengthFeet }));

  return {
    keyFeet,
    foundFeet,
    errorPercent: keyFeet === 0 ? 0 : ((foundFeet - keyFeet) / keyFeet) * 100,
    missed: missed.sort((a, b) => b.lengthFeet - a.lengthFeet),
    extra: extra.sort((a, b) => b.lengthFeet - a.lengthFeet),
    missedFeet: missed.reduce((n, w) => n + w.lengthFeet, 0),
    extraFeet: extra.reduce((n, w) => n + w.lengthFeet, 0),
    keyFromPairs: key.walls.filter((w) => w.from === "pair").length,
    keyFromSingles: key.walls.filter((w) => w.from === "single").length,
    keyFeetFromSingles: key.walls
      .filter((w) => w.from === "single")
      .reduce((n, w) => n + w.lengthFeet, 0),
  };
}
