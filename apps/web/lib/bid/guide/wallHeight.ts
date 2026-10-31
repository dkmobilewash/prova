import { fingerprint } from "./pastPriceCore";

/**
 * "HOW TALL ARE THE W2 WALLS?" — the one question the drawings a person has
 * measured cannot settle, and the one that changes the price. PURE: the job
 * guide's loader (`facts.ts`) and the guide's action (`lib/actions/bidGuide.ts`,
 * `setWallHeight`) both call `wallHeightQuestions` on the rows they read, so
 * the question the screen asked and the question the server re-derives are
 * worked out by one function.
 *
 * ── WHY HEIGHT, AND ONLY HEIGHT ──
 *
 * What the takeoff needs to turn a measured LENGTH into quantities is
 * `runGeometry` in `lib/wall-assemblies.ts`: the run's length, a HEIGHT (the
 * run's own, else its type's `defaultHeightFt`), the type's `sides` and
 * `studSpacingIn`, and the openings. Of those, only height can be MISSING:
 *
 *   - `WallRun.heightFt` and `WallType.defaultHeightFt` are both nullable, and
 *     with both null `runGeometry` returns null and the run produces NOTHING —
 *     not the board, not the studs, not even the track (`scheduleLines` lists it
 *     under `unpricedRuns`). The schema says so on purpose: "a type without a
 *     default and a run without a height produce NOTHING rather than a guessed
 *     10 feet." So those walls are silently absent from the bid.
 *   - `sides` defaults to 2 and `studSpacingIn` to 16, and neither is nullable.
 *     The schema cannot tell a deliberate 2 from an untouched one, so there is
 *     no fact to ask about; asking anyway would be inventing doubt.
 *   - `thicknessIn` is nullable, but it only matches a DETECTED wall to a type
 *     (the wall finder). It changes no quantity of a run already typed, so it
 *     does not change this job's price and is not asked here.
 *
 * (Since 2026-10-27 there is one more: `boardLayers`, which is never MISSING —
 * unanswered prices as the factor says — but which the drawings often leave
 * open and which doubles the board. It is its own question, asked after this
 * one: `./boardLayers.ts`.)
 *
 * ── WHEN IT IS ASKED ──
 *
 * A wall type used on this job's runs, with no default height, that has at
 * least one run with no height of its own, and at least one component (a type
 * with none prices nothing whatever its height; the unpriced-wall-type ask says
 * so instead). Runs with a height of their own are fine and are not counted.
 *
 * ── THE ANSWER ──
 *
 * Tap answers rather than typing: the common heights below. Anything else goes
 * to the wall-type library, where the person types it. The answer is written as
 * the TYPE's `defaultHeightFt` through the existing `updateWallType` action, so
 * it is the same write as editing the type by hand, under the same capability.
 * It reaches every run of that type with no height, on every job — which is what
 * a default height is, and the confirm says so.
 */

/** The heights a person can tap, in feet. Anything else is typed in the library. */
export const WALL_HEIGHT_CHOICES: readonly number[] = [8, 9, 10, 12];

export type WallHeightRun = { id: string; wallTypeId: string; lengthFt: number; heightFt: number | null };
export type WallHeightType = { id: string; code: string; defaultHeightFt: number | null; componentCount: number };

export type WallHeightQuestion = {
  wallTypeId: string;
  code: string;
  /** Runs of this type on the job with no height of their own. */
  runCount: number;
  /** Their total length, feet. */
  lengthFt: number;
  /** Fingerprint of the question as asked: which type, which runs. */
  token: string;
};

const hasHeight = (value: number | null): boolean => value != null && value > 0;

/**
 * Every height question a job has, by wall type code. The token covers the type
 * and the exact set of heightless runs, so an answer to a question that has
 * since changed (a run given its own height, a run added, a default set by
 * somebody else) is refused rather than applied to a different set of walls.
 */
export function wallHeightQuestions(runs: readonly WallHeightRun[], types: readonly WallHeightType[]): WallHeightQuestion[] {
  const out: WallHeightQuestion[] = [];
  for (const type of types) {
    if (hasHeight(type.defaultHeightFt) || type.componentCount === 0) continue;
    const heightless = runs.filter((run) => run.wallTypeId === type.id && !hasHeight(run.heightFt));
    if (heightless.length === 0) continue;
    const ids = heightless.map((run) => run.id).sort();
    out.push({
      wallTypeId: type.id,
      code: type.code,
      runCount: heightless.length,
      lengthFt: heightless.reduce((sum, run) => sum + run.lengthFt, 0),
      token: fingerprint(`${type.id}|${ids.join(",")}`),
    });
  }
  return out.sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * THE ARG CONTRACT: `wh:<WallType id>:<height in feet>:<token>`. The height is
 * one of `WALL_HEIGHT_CHOICES` — the browser chooses WHICH offered answer, never
 * an arbitrary number (a typed height goes through the library's own form).
 */
export function wallHeightArg(question: Pick<WallHeightQuestion, "wallTypeId" | "token">, heightFt: number): string {
  return `wh:${question.wallTypeId}:${heightFt}:${question.token}`;
}

export function parseWallHeightArg(arg: unknown): { wallTypeId: string; heightFt: number; token: string } | null {
  if (typeof arg !== "string") return null;
  const m = /^wh:([A-Za-z0-9_-]{1,64}):(\d{1,2}):([0-9a-f]{8})$/.exec(arg.trim());
  if (!m) return null;
  const heightFt = Number(m[2]);
  if (!WALL_HEIGHT_CHOICES.includes(heightFt)) return null;
  return { wallTypeId: m[1]!, heightFt, token: m[3]! };
}
