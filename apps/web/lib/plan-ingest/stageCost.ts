import type { PlanIngestStage } from "@prova/db";

/**
 * WHAT A STAGE COSTS, IN A MODULE WITH NO DATABASE IN IT.
 *
 * This lived in `stages.ts` for about an hour, which was wrong for a reason #533
 * already paid for: `stages.ts` imports the stage implementations, those import
 * prisma, and `PlanIngestPanel` is a client component that needs this map to say what
 * a Retry button costs. Importing it from there would have put a Prisma client in the
 * browser bundle — exactly what `client-prisma-boundary.test.ts` caught when the AI
 * settings form imported the module that reads its row, and the reason
 * `lib/ai/features.ts` exists as a database-free sibling of `lib/ai/settings.ts`.
 *
 * Same split, same reason. A type import is erased; a value import is not.
 */

/**
 * WHETHER A STAGE SPENDS MONEY PER PAGE, which decides what a Retry button does.
 *
 * `retryPlanIngestPage` resets `attempts` to 0, and its own comment argues for that:
 * the ceiling exists to stop an automatic loop spending without end, a person
 * clicking Retry is not that loop, and "decrementing by one would give them a single
 * try and then refuse again with the same message, which reads as a broken button."
 *
 * THAT ARGUMENT IS CORRECT FOR A FREE STAGE AND WRONG FOR A PAID ONE, and it was
 * written when every stage was free. `PAGE_INVENTORY` makes no model call, so a full
 * reset costs nothing and giving somebody three real tries is simply kinder.
 * `TITLE_BLOCK` claims a plan sheet before each call, so the same reset turns ONE
 * CLICK INTO THREE PAID ATTEMPTS — and since a retry resets the counter again, there
 * was no ceiling at all: a page could be charged without limit, with nothing on
 * screen saying so.
 *
 * So a paid stage grants ONE attempt per click and the button says what it costs. The
 * "broken button" objection is answered by telling the person rather than by silently
 * buying them two more tries they did not ask for.
 *
 * A TOTAL `Record`, so a new stage cannot be added without deciding this — and
 * `stageSpendCensus.test.ts` derives the answer from which stage files import a model
 * caller and refuses a map that disagrees, because the compiler can force a decision
 * but not a correct one.
 */
export const STAGE_SPENDS: Record<PlanIngestStage, boolean> = {
  // Reads the PDF. No model call, so a retry costs a fetch and a parse.
  PAGE_INVENTORY: false,
  // Not built. Recorded as free because nothing it could spend exists yet; the
  // census will refuse this the moment it gains a model call.
  CLASSIFY: false,
  // One model call per page, one plan sheet claimed before it.
  TITLE_BLOCK: true,
  // Not built, and would be pure computation over rows if it were.
  SHEET_INDEX: false,
};

