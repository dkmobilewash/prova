/**
 * Fetching for WH-347 page 2.
 *
 * Fetches here, decides in lib/wh347-statement.ts — the same split as
 * `das-query.ts` / `das-forms.ts` and `wh347-payroll-number.ts` / `wh347.ts`,
 * for the reason those headers give: the deciding half is where the bugs live
 * and has to be testable without a database.
 *
 * Dates cross this boundary as `Date` rather than a string, unlike
 * `das-query.ts`, and the difference is deliberate: `buildWh347Statement`
 * takes the SAME two `Date` objects page 1 already has, so the payroll period
 * on page 2 is the period page 1 printed rather than a second rendering of
 * it. Nothing here hands a `Date` to a client component — the page formats it
 * through the app's own date renderer, which is what #101 was about.
 */

import { prisma } from "@prova/db";

import type { Wh347FringeMode, Wh347StatementRecord } from "@/lib/wh347-statement";

/** Exactly the columns `buildWh347Statement` reads, and no more.
 *
 * Declared as a `satisfies` constant so the select and the type cannot drift —
 * the same reason `lib/portal-query.ts` does it, learned there from a whole
 * row being fetched for one field and nothing noticing. */
const STATEMENT_SELECT = {
  signatoryName: true,
  signatoryTitle: true,
  fringeMode: true,
  remarks: true,
  exceptions: {
    orderBy: { createdAt: "asc" },
    select: { id: true, craftName: true, explanation: true },
  },
} as const;

/** What the page needs beyond what the builder reads: the exception ids, so a
 * row can be removed without matching on its text. */
export type Wh347StatementRow = Wh347StatementRecord & {
  exceptions: readonly { id: string; craftName: string; explanation: string }[];
};

/**
 * The statement for one job-week, or null when none has been started.
 *
 * NULL IS A REAL ANSWER and the builder handles it: a week nobody has filled
 * in yet reports every fact as blocking, which is the honest state rather than
 * an error. There is no create-on-read here — reading a page must not write a
 * row, or every WH-347 anybody ever glanced at would own a statement record.
 */
export async function loadWh347Statement(
  jobId: string,
  weekStart: Date,
): Promise<Wh347StatementRow | null> {
  const row = await prisma.wh347Statement.findUnique({
    where: { jobId_weekStart: { jobId, weekStart } },
    select: STATEMENT_SELECT,
  });
  if (!row) return null;
  return {
    signatoryName: row.signatoryName,
    signatoryTitle: row.signatoryTitle,
    fringeMode: row.fringeMode as Wh347FringeMode | null,
    remarks: row.remarks,
    exceptions: row.exceptions,
  };
}
