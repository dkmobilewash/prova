import { prisma } from "@prova/db";
import { carriedLinePlan } from "@/lib/estimating/carried-quote";
import type { CrossCheckCarriedQuote, CrossCheckMeasurement } from "@/lib/estimating/estimate-crosschecks";

/**
 * The two quantities `estimate-crosschecks.ts` needs that the estimate tab
 * does not already hold.
 *
 * The LINES are already in hand — `job.lineItems` is loaded with its
 * descriptions, categories and costs — so only the implying quantities are
 * fetched here: what was traced on a drawing, and what was carried on a bid.
 * Both live outside the job's own row, which is exactly why no single-row
 * check could ever have found them.
 *
 * SCOPED BY COMPANY ON BOTH SIDES, not only by job id. A `jobId` arriving from
 * a route is a parameter; the tenant check is what makes reading it safe, and
 * `BidInvitation` carries its own `companyId` rather than inheriting one
 * through the job.
 */
export type CrossCheckInputs = {
  measurements: CrossCheckMeasurement[];
  carried: CrossCheckCarriedQuote[];
};

export async function loadCrossCheckInputs(jobId: string, companyId: string): Promise<CrossCheckInputs> {
  const [plan, bids] = await Promise.all([
    // THE NEWEST PLAN ONLY, which is the same one the takeoff tab shows. An
    // older plan's measurements belong to a drawing nobody is working from,
    // and reporting them as "not on the estimate" would be true and useless.
    prisma.takeoffPlan.findFirst({
      where: { jobId, companyId },
      orderBy: { createdAt: "desc" },
      select: {
        pages: {
          select: {
            measurements: {
              orderBy: { createdAt: "asc" },
              select: { id: true, kind: true, label: true, postedAt: true },
            },
          },
        },
      },
    }),
    prisma.bidInvitation.findMany({
      where: { companyId, wonJobId: jobId },
      select: {
        quotes: {
          // Carried only. An uncarried quote is a price somebody looked at and
          // did not choose, and it has no business implying a line.
          where: { carriedAt: { not: null } },
          orderBy: { packageLabel: "asc" },
          select: {
            id: true,
            vendorName: true,
            packageLabel: true,
            amount: true,
            declinedAt: true,
            carriedAt: true,
          },
        },
      },
    }),
  ]);

  const measurements: CrossCheckMeasurement[] = (plan?.pages ?? []).flatMap((page) =>
    page.measurements.map((row) => ({
      id: row.id,
      kind: row.kind,
      label: row.label,
      postedAt: row.postedAt ? row.postedAt.toISOString() : null,
    })),
  );

  // THE EXPECTED DESCRIPTION COMES FROM `carriedLinePlan`, NOT FROM A STRING
  // BUILT HERE. That is the function `addCarriedQuoteToEstimate` uses to write
  // the line and to find a duplicate, so the comparison cannot drift from what
  // the app would actually have written — a second copy of that format is the
  // defect this repo keeps writing censuses to catch.
  //
  // Its refusals are honoured rather than worked around: a carried quote with
  // no amount, or from a sub who declined, CANNOT be put on an estimate, so
  // reporting it as missing would be telling somebody to do something the app
  // refuses.
  const carried: CrossCheckCarriedQuote[] = [];
  for (const bid of bids) {
    for (const quote of bid.quotes) {
      const plan = carriedLinePlan({
        id: quote.id,
        vendorName: quote.vendorName,
        packageLabel: quote.packageLabel,
        amount: quote.amount === null ? null : Number(quote.amount),
        declinedAt: quote.declinedAt,
        carriedAt: quote.carriedAt,
      });
      if (!plan.ok) continue;
      carried.push({
        vendorName: quote.vendorName,
        packageLabel: quote.packageLabel,
        amount: plan.unitCost,
        expectedDescription: plan.description,
      });
    }
  }

  return { measurements, carried };
}
