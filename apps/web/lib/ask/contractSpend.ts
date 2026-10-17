import { prisma } from "@prova/db";
import { pageChargeNote } from "./pageCount";
import { periodStartFor } from "./allowance";

/**
 * SUBCONTRACT PAGES: the sixth unit of the monthly AI allowance, claimed before
 * each chunk of a subcontract review — `specSpend.ts`'s shape exactly, with one
 * difference that is the reason this is not a call to it.
 *
 * The spec reader charges a FILE, so it counts pages out of the PDF's bytes. A
 * review charges the READABLE pages of one chunk, which code has already
 * counted: scanned pages are never sent and must never be charged, and pages a
 * chunk shares with the one before it (the overlap that keeps a clause across a
 * break quotable) were paid for once already. So the caller passes the count.
 *
 * Same rules otherwise, and they are not negotiable:
 *
 *   - CLAIM BEFORE THE CALL, as one conditional UPDATE, so two tabs cannot both
 *     take the last pages.
 *   - FAIL CLOSED: a ledger that cannot be read refuses the chunk rather than
 *     running it unmetered.
 *   - A FAILED CALL IS MARKED, NEVER RELEASED (`markContractFailure`), and the
 *     settings page says how many.
 */

export type ContractClaim = { companyId: string; periodStart: Date };

export type ContractClaimResult =
  | { ok: true; claim: ContractClaim; pages: number; note: string; pagesLeft: number }
  | { ok: false; error: string };

const UNREADABLE =
  "This month's subcontract allowance couldn't be checked, so the review stopped here. Nothing more was " +
  "charged. Try again in a minute — and if it keeps happening, the account owner can see the month on " +
  "Settings → Assistant.";

function stopSentence(ceiling: number, used: number, wanted: number): string {
  const left = Math.max(0, ceiling - used);
  return (
    `The next part of this contract is ${wanted} ${wanted === 1 ? "page" : "pages"} and there ` +
    `${left === 1 ? "is" : "are"} ${left} of ${ceiling} subcontract pages left this month, so the review ` +
    `stopped here. What it already found is kept below. The account owner can see the month on ` +
    `Settings → Assistant.`
  );
}

export async function claimContractPages(
  companyId: string,
  ceiling: number,
  pages: number,
  now: Date = new Date(),
): Promise<ContractClaimResult> {
  const periodStart = periodStartFor(now);
  const charge = { pages, basis: "pdf" as const };

  try {
    try {
      await prisma.askAllowancePeriod.upsert({
        where: { companyId_periodStart: { companyId, periodStart } },
        create: { companyId, periodStart },
        update: {},
      });
    } catch (err) {
      // Two first-of-the-month claims racing the create: the loser's row exists.
      const code = (err as { code?: unknown } | null)?.code;
      if (code !== "P2002") throw err;
    }

    const claimed =
      pages === 0
        ? { count: 1 }
        : await prisma.askAllowancePeriod.updateMany({
            where: { companyId, periodStart, contractPagesUsed: { lte: ceiling - pages } },
            data: { contractPagesUsed: { increment: pages } },
          });

    const row = await prisma.askAllowancePeriod.findUnique({
      where: { companyId_periodStart: { companyId, periodStart } },
      select: { contractPagesUsed: true },
    });
    if (!row) {
      console.error("[subcontract-review] the allowance period row disappeared mid-claim, so the chunk was REFUSED");
      return { ok: false, error: UNREADABLE };
    }
    if (claimed.count === 0) return { ok: false, error: stopSentence(ceiling, row.contractPagesUsed, pages) };

    const pagesLeft = Math.max(0, ceiling - row.contractPagesUsed);
    return {
      ok: true,
      claim: { companyId, periodStart },
      pages,
      pagesLeft,
      note: pageChargeNote(charge, { noun: "subcontract pages", left: pagesLeft, ceiling }),
    };
  } catch (err) {
    console.error(
      "[subcontract-review] pages could not be claimed against the monthly allowance, so the chunk was REFUSED " +
        "rather than run unbounded — this cap fails closed.",
      err,
    );
    return { ok: false, error: UNREADABLE };
  }
}

export async function markContractFailure(claim: ContractClaim, pages: number): Promise<void> {
  if (pages === 0) return;
  try {
    await prisma.askAllowancePeriod.updateMany({
      where: { companyId: claim.companyId, periodStart: claim.periodStart },
      data: { failedContractPages: { increment: pages } },
    });
  } catch (err) {
    console.error("[subcontract-review] a failed chunk could not be marked; the claim stands regardless", err);
  }
}
