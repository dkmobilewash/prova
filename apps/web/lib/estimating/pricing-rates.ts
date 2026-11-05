import { prisma } from "@prova/db";
import { ownMarkupSet, RECAP_RATE_KEYS, type RecapRates } from "@/lib/bid-recap";

/**
 * The rates a job's lines are priced from when a cost is entered: the job's
 * own recap if it has one, else the company's defaults — the same source the
 * estimate page's Bid recap shows (`bidRecapRow ?? bidDefaults`). Null until
 * all four of the company's own rates are set (`ownMarkupSet`), which is what
 * switches the review queue from asking for a price to asking for a cost.
 */
export async function pricingRatesFor(companyId: string, jobId: string): Promise<RecapRates | null> {
  const [recap, defaults] = await Promise.all([
    prisma.jobBidRecap.findFirst({ where: { jobId, companyId } }),
    prisma.companyBidDefaults.findUnique({ where: { companyId } }),
  ]);
  const source = recap ?? defaults;
  if (source === null) return null;
  const rates: RecapRates = Object.fromEntries(RECAP_RATE_KEYS.map((key) => [key, source[key] != null ? Number(source[key]) : null]));
  return ownMarkupSet(rates) ? rates : null;
}
