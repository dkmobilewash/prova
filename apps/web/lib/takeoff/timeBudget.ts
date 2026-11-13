/**
 * ── NO SHEET MAY HOLD THE FINDER FOREVER ──
 *
 * Broadway A1.0 (a residential duplex whose notes and title block are drawn as outlined lettering:
 * 552,997 strokes) froze the tab for more than 3.5 minutes, twice, in Chrome Round 22. Every stage
 * of the finder is synchronous, and two of them were quadratic in the strokes; nothing stopped them.
 * `SheetTooDenseError` bounds the pairer's pair tests and nothing else.
 *
 * This bounds them all by TIME. A caller runs the finder inside `withTimeBudget`, and every heavy
 * loop calls `spendTime(stage)`: past the deadline it throws `SheetTooSlowError`, naming the stage,
 * and the caller says so in a sentence. Outside a budget `spendTime` does nothing, so the evals and
 * the training rows run to the end as they always have.
 *
 * It throws rather than returning what it had, for `SheetTooDenseError`'s reason: a partial set of
 * walls looks like an answer, and an estimator would price it.
 */
export class SheetTooSlowError extends Error {
  constructor(
    readonly stage: string,
    readonly seconds: number,
  ) {
    super(
      `This sheet took longer than ${seconds} seconds to read (it was ${stage}), so the wall finder stopped. ` +
        `Trace the walls by hand on this one.`,
    );
    this.name = "SheetTooSlowError";
  }
}

const clock = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

let deadline: number | null = null;
let allowedSeconds = 0;

/** Runs `work` with every `spendTime` inside it held to `ms` from now. Budgets nest; the inner one wins until it ends. */
export function withTimeBudget<T>(ms: number, work: () => T): T {
  const outer = { deadline, allowedSeconds };
  deadline = clock() + ms;
  allowedSeconds = Math.round(ms / 1000);
  try {
    return work();
  } finally {
    deadline = outer.deadline;
    allowedSeconds = outer.allowedSeconds;
  }
}

/** Throws `SheetTooSlowError` when the current budget has run out. Free outside one. */
export function spendTime(stage: string): void {
  if (deadline !== null && clock() > deadline) throw new SheetTooSlowError(stage, allowedSeconds);
}
