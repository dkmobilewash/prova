import { prisma } from "@prova/db";
import { estimateStage } from "@/lib/estimate-stage";
import { proposalPriceState } from "@/lib/estimating/proposal-recap-currency";
import { bidTotalOf, recapStateFor, type RecapLine } from "@/lib/estimating/recap-state";
import { loadTakeoffCurrency } from "@/lib/takeoff-currency-query";
import { jobNeeds } from "@/lib/estimating/job-needs";
import type { NeedItem } from "@/components/home/HomeParts";

/**
 * EVERYTHING THE "NEEDS YOU" LIST ASKS, IN ONE PLACE.
 *
 * ── A LOADER RATHER THAN A BLOCK ON THE PAGE, FOR A TEST-SHAPED REASON ──
 *
 * It was inline on `jobs/[id]/(tabs)/page.tsx` and it broke
 * `schedule-visibility.test.ts`, which renders that page against a hand-built
 * Prisma mock: three new models to stub in a file that is about who can see the
 * schedule box. Every future test that renders this page would have paid the
 * same tax, and the fix each time is to stub something the test does not care
 * about — which is how a mock stops resembling the database.
 *
 * The page already has two neighbours doing it the right way: `loadJobDocuSign`
 * and `loadJobPaperworkCounts` are each one line to mock. This is the third.
 *
 * The JUDGEMENT is not here — `jobNeeds` orders and writes the rows, and each
 * input is decided by the function that owns that question. This only asks.
 */

export type JobNeedsJob = {
  id: string;
  status: string;
  bidDueDate: Date | null;
  lineItems: readonly RecapLine[];
  signatureRequests: readonly { status: string }[];
};

export async function loadJobNeeds(companyId: string, job: JobNeedsJob): Promise<NeedItem[]> {
  const [recapRow, takeoff, pages] = await Promise.all([
    prisma.jobBidRecap.findFirst({ where: { jobId: job.id, companyId } }),
    loadTakeoffCurrency(companyId, job.id),
    prisma.takeoffPlanPage.findMany({
      where: { plan: { jobId: job.id, companyId } },
      select: {
        id: true,
        _count: { select: { measurements: true } },
        calibrations: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true } },
        wallProposals: { select: { calibrationId: true } },
      },
    }),
  ]);

  return jobNeeds(
    {
      stage: estimateStage(
        job.lineItems.length,
        job.signatureRequests.map((request) => request.status),
      ),
      wallsWaiting: pages.length === 0 ? null : wallsWaiting(pages),
      takeoff: pages.length === 0 ? null : takeoff,
      price: proposalPriceState(recapStateFor(recapRow, job.lineItems), bidTotalOf(job.lineItems)),
      bidDueDate: job.bidDueDate,
      // ESTIMATE is the first value of `JobStatus` — every job starts as one —
      // so a bid deadline matters exactly while the job is still that.
      isBidding: job.status === "ESTIMATE",
      today: new Date(),
    },
    job.id,
  );
}

type PageRow = {
  _count: { measurements: number };
  calibrations: { id: string }[];
  wallProposals: { calibrationId: string }[];
};

/**
 * Walls found that nobody has looked at — counted CONSERVATIVELY, and the bound
 * is the point rather than a caveat.
 *
 * Accepting a found group writes a `TakeoffMeasurement`, and nothing links that
 * measurement back to the proposal it came from, so an accepted group and an
 * un-accepted one are indistinguishable. This counts a sheet only when it has
 * proposals AND NO MEASUREMENTS AT ALL — the one case where "nobody has accepted
 * anything here" is certain.
 *
 * It therefore goes quiet after the FIRST acceptance on a sheet, even with five
 * groups left. That is the right direction to be wrong in: this list is
 * worthless the moment it nags, and the signal worth having is "C Stream found
 * walls and you have not looked at them yet". Making it exact needs a link from
 * measurement to proposal, which is its own change and is not pretended away.
 *
 * Only under the sheet's CURRENT calibration, so a recalibration's dead
 * proposals cannot ask to be reviewed.
 */
export function wallsWaiting(pages: readonly PageRow[]): { groups: number; sheets: number } {
  let groups = 0;
  let sheets = 0;
  for (const page of pages) {
    const current = page.calibrations[0];
    if (!current || page._count.measurements > 0) continue;
    const mine = page.wallProposals.filter((row) => row.calibrationId === current.id).length;
    if (mine > 0) {
      groups += mine;
      sheets += 1;
    }
  }
  return { groups, sheets };
}
