import { prisma } from "@prova/db";
import { bidsDueSoon, type DueSoonBid } from "@/lib/bids-due-soon";

/**
 * The "Due soon" rows for a company — invited bids due from `todayIso` on,
 * through `bidsDueSoon`'s window. Its own query, never the page's filtered
 * history, so a trade or status filter cannot hide what is still to price.
 *
 * One query for both products: the CRM's bid desk and C Stream Bid's bid log
 * read the same rows the same way. Moved verbatim out of the CRM page;
 * `bids-due-soon.ts` stays pure (no database).
 */
export async function loadBidsDueSoon(companyId: string, todayIso: string): Promise<DueSoonBid[]> {
  return bidsDueSoon(
    await prisma.bidInvitation.findMany({
      where: { companyId, status: "INVITED", dueDate: { gte: new Date(`${todayIso}T00:00:00.000Z`) } },
      select: { id: true, projectName: true, status: true, dueDate: true, contact: { select: { name: true } } },
    }),
    todayIso,
  );
}
