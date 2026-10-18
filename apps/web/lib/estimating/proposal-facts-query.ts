import { prisma } from "@prova/db";
import { findingsFromJson } from "@/lib/specs/spec-findings";
import { missingIndirects, type IndirectCatalogEntry } from "@/lib/estimating/indirect-costs";
import { carriedQuotesMissing, type CrossCheckLine } from "@/lib/estimating/estimate-crosschecks";
import { carriedLinePlan } from "@/lib/estimating/carried-quote";
import { uncoveredFacts, type ProposalFact } from "./proposal-facts";

/**
 * Everything the app knows about this bid that the scope letter might be silent
 * about, as facts, with the answered ones already removed.
 *
 * `proposal-facts.ts` owns the DECIDING — what counts as a fact, what `priced`
 * may claim, when coverage applies. This owns the gathering, and it is
 * deliberately thin: every source is an existing module called with rows, so a
 * fact can never mean something different here than it does on the screen that
 * already shows it.
 *
 * ── THE ONE JOIN WORTH READING TWICE ──
 *
 * A spec section belongs to a `BidInvitation`, not to a job. It reaches a job
 * only through `BidInvitation.wonJobId`, which is person-set — the same reach
 * `estimate-crosschecks-query.ts` uses for carried quotes, and the same reason
 * it is the one every assertion about it is a wrong join away from being false.
 * `wonJobId` is UNIQUE, so a job has at most one bid and therefore at most one
 * set of spec readings.
 */
export async function loadProposalFacts(jobId: string, companyId: string): Promise<ProposalFact[]> {
  const [job, bid, catalogEntries, drafts] = await Promise.all([
    prisma.job.findFirst({
      where: { id: jobId, companyId },
      select: {
        lineItems: {
          select: { description: true, costCategory: true, budgetedUnitCost: true, indirectKind: true },
        },
      },
    }),
    // Through `wonJobId`, scoped by company — see the header.
    prisma.bidInvitation.findFirst({
      where: { companyId, wonJobId: jobId },
      select: {
        specSections: {
          select: {
            sectionNumber: true,
            readings: {
              // NEWEST READING ONLY. A section re-read is a new row, and the
              // older answer is history; proposing clauses from both would ask
              // the estimator the same question twice with different wording.
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { id: true, findings: true },
            },
          },
        },
        quotes: {
          where: { carriedAt: { not: null } },
          // `carriedLinePlan` takes the WHOLE quote, declines and carry stamp
          // included, because it is the thing that decides whether a quote may
          // become a line at all. Handing it a narrowed object would mean
          // re-deciding that here, as a second authority.
          select: {
            id: true,
            vendorName: true,
            packageLabel: true,
            amount: true,
            declinedAt: true,
            carriedAt: true,
          },
        },
        addenda: { orderBy: { createdAt: "asc" }, select: { reference: true } },
      },
    }),
    prisma.lineItemCatalogEntry.findMany({
      where: { companyId, indirectKind: { not: null } },
      select: { id: true, description: true, unit: true, indirectKind: true, defaultBudgetedUnitCost: true },
    }),
    // EVERY status. A dismissed fact stays dismissed.
    prisma.proposalClauseDraft.findMany({ where: { jobId }, select: { factRef: true } }),
  ]);

  if (!job) return [];

  const lines: CrossCheckLine[] = job.lineItems.map((line) => ({
    description: line.description,
    costCategory: line.costCategory,
    budgetedUnitCost: line.budgetedUnitCost === null ? null : line.budgetedUnitCost.toNumber(),
  }));

  // THE SAME MATCHER THE ESTIMATE SCREEN USES, rather than a second opinion
  // about whether a package is on the bid. `carriedQuotesMissing` accepts an
  // exact description OR a subcontractor cost to the cent, which is what stops
  // a renamed line being reported as missing.
  const carried = (bid?.quotes ?? [])
    .map((quote) => {
      if (quote.amount === null) return null;
      const amount = quote.amount.toNumber();
      const plan = carriedLinePlan({
        id: quote.id,
        vendorName: quote.vendorName,
        packageLabel: quote.packageLabel,
        amount,
        declinedAt: quote.declinedAt,
        carriedAt: quote.carriedAt,
      });
      if (!plan.ok) return null;
      return {
        id: quote.id,
        vendorName: quote.vendorName,
        packageLabel: quote.packageLabel,
        amount,
        expectedDescription: plan.description,
      };
    })
    .filter((quote): quote is NonNullable<typeof quote> => quote !== null);

  const missingCarried = carriedQuotesMissing(carried, lines);
  // Only the packages the estimate does NOT carry become facts here — a package
  // already priced needs no clause defending it, and `carriedQuotesMissing`
  // returning null means every carried quote is on the bid.
  const carriedFacts =
    missingCarried === null
      ? []
      : carried
          .filter((quote) => missingCarried.sentence.includes(quote.vendorName))
          .map((quote) => ({ id: quote.id, vendorName: quote.vendorName, packageLabel: quote.packageLabel }));

  const entries: IndirectCatalogEntry[] = catalogEntries.map((entry) => ({
    id: entry.id,
    description: entry.description,
    unit: entry.unit,
    indirectKind: entry.indirectKind,
    defaultBudgetedUnitCost: entry.defaultBudgetedUnitCost === null ? null : entry.defaultBudgetedUnitCost.toNumber(),
  }));

  return uncoveredFacts({
    specReadings: (bid?.specSections ?? []).flatMap((section) => {
      const reading = section.readings[0];
      if (reading === undefined) return [];
      return [
        {
          id: reading.id,
          sectionNumber: section.sectionNumber,
          // Validated on the way out of the `Json` column, not trusted — a
          // finding written by an older build is not evidence of anything.
          findings: findingsFromJson(reading.findings).map((finding) => ({
            ordinal: finding.ordinal,
            label: finding.label,
            requirement: finding.requirement,
            quote: finding.quote,
            sourcePageLabel: finding.sourcePageLabel,
          })),
        },
      ];
    }),
    missingIndirects: missingIndirects(job.lineItems, entries).map((indirect) => ({
      kind: indirect.kind,
      label: indirect.label,
      covers: indirect.covers,
    })),
    carriedPackages: carriedFacts,
    addenda:
      bid === null || bid.addenda.length === 0
        ? null
        : { references: bid.addenda.map((addendum) => addendum.reference) },
    // DELIBERATELY NOT WIRED YET. `takeoff-currency.ts` can say which drawing
    // revision the quantities were measured from, and that belongs on the
    // letter — but it answers in terms of plans and revisions rather than one
    // label and date, and mapping it needs a decision about what to say when a
    // job has three plans at different revisions. A fact nobody can state
    // precisely is worse than one the letter does not carry yet.
    drawingBasis: null,
    drafts,
  });
}
