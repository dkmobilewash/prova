import { prisma } from "@prova/db";
import { viewerTimeZone } from "@/lib/viewerToday";
import {
  calculateLineItemWip,
  calculateJobWip,
} from "@/lib/wip";
import { jobEarnedRevenue, jobOverUnderBilling } from "@/lib/company-financials";
import { lineItemCostToDate, unassignedLaborCost } from "@/lib/labor-job-cost";
import { fringeScheduleInput } from "@/lib/labor-cost";
import { laborCostApplyDecision } from "@/lib/estimating/labor-cost-apply";
import { missingIndirects } from "@/lib/estimating/indirect-costs";
import { estimateCrossChecks } from "@/lib/estimating/estimate-crosschecks";
import { loadCrossCheckInputs } from "@/lib/estimating/estimate-crosschecks-query";
import { loadPriceAnomalies } from "@/lib/estimating/price-anomalies-query";
import { loadEmployerBurdenRates } from "@/lib/employer-burden-query";
import { employerBurdenPercentOn, employerBurdenPercentOnDay } from "@/lib/employer-burden";
import { serverToday } from "@/lib/serverToday";
import { burdenedHourlyRate, estimateBurdenedLaborCost, laborRateDateFor } from "@/lib/estimate-labor-cost";
import { estimatedHours, productionBackCheck } from "@/lib/labor-productivity";
import { openingsFromJson, scheduleLines, wallTypeInputFromRow, type WallTypeInput } from "@/lib/wall-assemblies";
import type { RecapLineView } from "@/components/BidRecapPanel";
import { RECAP_RATE_KEYS, type CostCategoryValue, type RecapRates } from "@/lib/bid-recap";

/**
 * EVERYTHING THE ESTIMATE SCREEN READS, loaded and derived once.
 *
 * This is the top of `app/(app)/jobs/[id]/(tabs)/estimate/page.tsx`, moved here
 * unchanged so the CRM's Estimate tab and C Stream Bid's estimate screens
 * render from ONE implementation of the lines, the wall schedule, the recap's
 * inputs and the cross-checks — two copies of a money derivation disagree the
 * day either is edited (`recap-state.ts`, bug C). The comments below are the
 * page's own and were not rewritten.
 *
 * It loads a little more than C Stream Bid draws (cost entries, time entries,
 * invoices, change orders): those are the post-award half of the same query,
 * and an ESTIMATE-stage job has next to none of them. Splitting the query
 * would mean two selects of the same job to keep in step.
 *
 * Returns null when the job is not this company's (or does not exist).
 */
export async function loadJobEstimateData(jobId: string, companyId: string) {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      // `startDate`, not selected: `include` with nested selects still
      // returns every scalar column on Job, unlike a top-level `select`.
      contact: { select: { name: true, email: true } },
      signatureRequests: { select: { status: true, signerName: true, signedAt: true } },
      contractDocuments: {
        orderBy: { versionNumber: "desc" },
        select: {
          versionNumber: true,
          fileName: true,
          fileUrl: true,
          executedSignedDate: true,
          createdAt: true,
          uploadedByUser: { select: { name: true, email: true } },
        },
      },
      lineItems: {
        where: { isDeleted: false },
        orderBy: { createdAt: "asc" },
        include: {
          originChangeOrder: true,
          costEntries: { orderBy: { incurredAt: "desc" } },
          craftClassification: { include: { unionLocal: true } },
        },
      },
      estimateVersions: { orderBy: { versionNumber: "desc" }, include: { createdByUser: true } },
      changeOrders: {
        orderBy: { number: "asc" },
        include: {
          edits: true,
          proposals: { orderBy: { createdAt: "asc" } },
          supersedes: { select: { number: true } },
          revisions: { select: { number: true }, orderBy: { number: "asc" } },
        },
      },
      // Every hour on the job, not just hours tied to a line item — the
      // WIP total below includes labor logged with no line item, same as
      // the monolith's `unassignedLaborCost(job.timeEntries, …)`. Per diem
      // and travel pay are part of that cost too (CLAUDE.md, #375/#369) —
      // dropping them here would silently under-cost every WIP figure on
      // this route, the exact shape of bug those PRs exist to prevent.
      timeEntries: {
        select: {
          hours: true,
          payType: true,
          date: true,
          craftClassificationId: true,
          lineItemId: true,
          perDiemAmount: true,
          travelPayAmount: true,
        },
      },
      invoices: { select: { amount: true } },
      // The bid project's trade, so a new line starts tagged with it
      // (EstimateStage's add form) rather than "No trade tag".
      bidProject: { select: { tradeScope: true, invitations: { select: { tradeScope: true } } } },
    },
  });
  // `requireJob` / `requireJobGivenContext` has already proved the job is this
  // company's; this is the same check again so the loader is safe to call on
  // its own (C Stream Bid does) and returns null rather than another tenant's rows.
  if (!job || job.companyId !== companyId) return null;

  const isEstimateStage = job.status === "ESTIMATE";

  const [catalogEntries, craftClassifications, phaseCodes, employerBurdenRates, wallTypes, wallRuns, bidRecapRow, bidDefaults, estimateTemplates] =
    await Promise.all([
    prisma.lineItemCatalogEntry.findMany({ where: { companyId: companyId }, orderBy: { description: "asc" } }),
    prisma.craftClassification.findMany({
      where: { companyId: companyId },
      include: {
        unionLocal: true,
        fringeRateSchedules: { orderBy: { effectiveFrom: "desc" } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.phaseCode.findMany({
      where: { companyId: companyId },
      select: { id: true, code: true, name: true, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    }),
    // The employer's share on top of wage and fringes -- FICA, FUTA/SUTA,
    // workers' comp -- as the owner recorded it on /settings. Empty for a
    // company that has recorded none, which adds nothing and leaves every
    // figure below exactly as it was.
    loadEmployerBurdenRates(companyId),
    // The wall schedule: the company's wall types and this job's runs. Read
    // only while the job is an estimate — after award the runs are the
    // record the contract was priced from and change only by change order.
    isEstimateStage
      ? prisma.wallType.findMany({
          where: { companyId: companyId },
          orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
          include: { components: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
        })
      : Promise.resolve([]),
    isEstimateStage
      ? prisma.wallRun.findMany({
          where: { jobId: job.id, companyId: companyId },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        })
      : Promise.resolve([]),
    // The bid recap, and the company's defaults which pre-fill a job that has
    // no recap of its own yet — the Contact.defaultRetainagePercent pattern:
    // a starting point, never a value enforced from elsewhere afterwards.
    isEstimateStage ? prisma.jobBidRecap.findFirst({ where: { jobId: job.id, companyId: companyId } }) : Promise.resolve(null),
    isEstimateStage ? prisma.companyBidDefaults.findUnique({ where: { companyId: companyId } }) : Promise.resolve(null),
    // Only at estimate stage: applying a template writes JobLineItem rows,
    // and `applyEstimateTemplate` refuses anything past ESTIMATE anyway.
    // Not fetching them at all is what keeps the control off the page
    // rather than showing one that would be refused.
    isEstimateStage
      ? prisma.estimateTemplate.findMany({
          where: { companyId: companyId },
          orderBy: { name: "asc" },
          include: { items: { orderBy: { sortOrder: "asc" } } },
        })
      : Promise.resolve([]),
  ]);

  const wallTypeInputs: WallTypeInput[] = wallTypes.map(wallTypeInputFromRow);
  const wallRunViews = wallRuns.map((run) => ({
    id: run.id,
    label: run.label,
    wallTypeId: run.wallTypeId,
    lengthFt: run.lengthFt.toString(),
    heightFt: run.heightFt?.toString() ?? null,
    openings: openingsFromJson(run.openings),
  }));
  const unpricedWallRuns = scheduleLines(
    wallRunViews.map((run) => ({ ...run, lengthFt: Number(run.lengthFt), heightFt: run.heightFt != null ? Number(run.heightFt) : null })),
    wallTypeInputs,
  ).unpricedRuns.map((run) => run.label);

  // The rate list is SHARED (`RECAP_RATE_KEYS`), not declared here. It was a
  // local ten-name array, so when the recap grew an equipment rate this page
  // kept handing the panel ten of eleven — the rate saved, and then rendered
  // back blank, which reads as a save that failed rather than a list that is
  // short.
  const recapSource = bidRecapRow ?? bidDefaults;
  const bidRecapRates: RecapRates = Object.fromEntries(
    RECAP_RATE_KEYS.map((key) => [key, recapSource?.[key] != null ? Number(recapSource[key]) : null]),
  );
  const bidRecapLines: RecapLineView[] = job.lineItems.map((item) => ({
    id: item.id,
    description: item.description,
    quantity: Number(item.quantity),
    // #512: the recap marks up COST. `budgetedUnitCost`, not
    // `currentEstimatedUnitCost` — the latter is the PM's live re-forecast and
    // would make a recap re-opened later show a cost it was not built from.
    unitCost: item.budgetedUnitCost != null ? Number(item.budgetedUnitCost) : null,
    unitPrice: item.unitPrice != null ? Number(item.unitPrice) : null,
    costCategory: (item.costCategory as CostCategoryValue | null) ?? null,
  }));

  const laborRateDate = laborRateDateFor(job, new Date());
  // THE BURDEN IS RESOLVED AT THE LABOR RATE DATE, NOT TODAY, and the
  // distinction is the same one `laborRateDateFor` exists for: this job's labor
  // will be worked and paid around its start date, the fringes are already
  // priced at that day, and a figure whose two halves answered as of different
  // days would be a number nobody can reconcile. `burdenPercentToday` below is a
  // different question — what LOGGED hours cost — and keeps its own date.
  const burdenPercentForBid = employerBurdenPercentOn(employerBurdenRates, laborRateDate);

  // WHICH GENERAL CONDITIONS THIS BID CARRIES NOTHING FOR. No new query: the
  // lines and the catalog are both already in hand. Derived on every read and
  // never stored — a stored "this bid has its indirects" is wrong the moment a
  // line is deleted.
  const missingIndirectLines = missingIndirects(
    job.lineItems.map((item) => ({ indirectKind: item.indirectKind })),
    catalogEntries.map((entry) => ({
      id: entry.id,
      description: entry.description,
      indirectKind: entry.indirectKind,
      defaultBudgetedUnitCost:
        entry.defaultBudgetedUnitCost != null ? Number(entry.defaultBudgetedUnitCost) : null,
    })),
  );
  // A QUANTITY SOMEWHERE ELSE THAT IMPLIES A LINE HERE. Two queries, because
  // both implying quantities live outside the job's own row — which is exactly
  // why no check on this page could previously see them. Only fetched while
  // the estimate is still being built: after award a missing line is a change
  // order, and the page is read-only anyway.
  const crossCheckInputs = isEstimateStage
    ? await loadCrossCheckInputs(job.id, companyId)
    : { measurements: [], carried: [] };
  const crossChecks = estimateCrossChecks({
    measurements: crossCheckInputs.measurements,
    carried: crossCheckInputs.carried,
    // Already in hand, and the live set: `lineItems` is loaded with
    // `isDeleted: false`, so a deleted line cannot satisfy a cross-check.
    lines: job.lineItems.map((item) => ({
      description: item.description,
      costCategory: item.costCategory,
      budgetedUnitCost: item.budgetedUnitCost != null ? Number(item.budgetedUnitCost) : null,
    })),
  });

  // GATED ON THE ESTIMATE STAGE, like the cross-checks above and for the same
  // reason: after award a mis-priced line is a change order rather than
  // something to fix before sending, and the page is read-only anyway. It also
  // costs three queries and a fringe-schedule load, which is not worth paying
  // on a page nobody can act on.
  const priceAnomalyReport = isEstimateStage
    ? await loadPriceAnomalies(job.id, companyId)
    : { anomalies: [], checked: 0, unchecked: 0 };

  const schedulesByCraft = new Map(
    craftClassifications.map((craft) => [
      craft.id,
      craft.fringeRateSchedules.map(fringeScheduleInput),
    ]),
  );
  const craftOptions = craftClassifications.map((craft) => ({
    id: craft.id,
    label: `${craft.unionLocal.parentInternational} ${craft.unionLocal.localNumber} — ${craft.name}`,
    hourlyRate: burdenedHourlyRate(schedulesByCraft.get(craft.id) ?? [], laborRateDate, burdenPercentForBid),
  }));

  const estimatedHoursByLineItem = new Map(
    job.lineItems.map((item) => [
      item.id,
      estimatedHours({
        quantity: Number(item.quantity),
        laborHours: item.laborHours != null ? Number(item.laborHours) : null,
        productionRate: item.productionRate != null ? Number(item.productionRate) : null,
      }),
    ]),
  );

  const estimatedLaborCostByLineItem = new Map(
    job.lineItems.map((item) => [
      item.id,
      estimateBurdenedLaborCost(
        estimatedHoursByLineItem.get(item.id) ?? null,
        item.craftClassificationId ? (schedulesByCraft.get(item.craftClassificationId) ?? []) : [],
        laborRateDate,
        burdenPercentForBid,
      ),
    ]),
  );

  // WHAT "USE THIS AS THE COST" WOULD DO TO EACH LINE, decided here with the
  // same function the action re-runs before it writes. Rendering a button from
  // one implementation and writing from another is how the two come to
  // disagree — `catalog-quote-price.ts` states the rule and `QuoteLine` is the
  // pattern.
  const laborCostApplyByLineItem = new Map(
    job.lineItems.map((item) => [
      item.id,
      laborCostApplyDecision(
        {
          quantity: Number(item.quantity),
          laborHours: item.laborHours != null ? Number(item.laborHours) : null,
          productionRate: item.productionRate != null ? Number(item.productionRate) : null,
          budgetedUnitCost: item.budgetedUnitCost != null ? Number(item.budgetedUnitCost) : null,
          costCategory: item.costCategory,
        },
        item.craftClassificationId ? (schedulesByCraft.get(item.craftClassificationId) ?? []) : [],
        laborRateDate,
        burdenPercentForBid,
      ),
    ]),
  );

  const lineItemWip = job.lineItems.map((item) => ({
    item,
    wip: calculateLineItemWip({
      quantity: Number(item.quantity),
      unitPrice: item.unitPrice != null ? Number(item.unitPrice) : null,
      budgetedUnitCost: item.budgetedUnitCost != null ? Number(item.budgetedUnitCost) : null,
      currentEstimatedUnitCost: item.currentEstimatedUnitCost != null ? Number(item.currentEstimatedUnitCost) : null,
      estimatedCostToComplete: item.estimatedCostToComplete != null ? Number(item.estimatedCostToComplete) : null,
      ...lineItemCostToDate(
        item.id,
        item.costEntries,
        job.timeEntries,
        schedulesByCraft,
        employerBurdenRates,
      ),
    }),
  }));

  const productivityByLineItem = new Map(
    lineItemWip.map(({ item, wip }) => [
      item.id,
      productionBackCheck({
        quantity: Number(item.quantity),
        estimatedHours: estimatedHoursByLineItem.get(item.id) ?? null,
        actualHours: wip.labor.pricedHours + wip.labor.unpricedHours,
      }),
    ]),
  );

  const billedToDate = job.invoices.reduce((sum, invoice) => sum + Number(invoice.amount), 0);
  const jobWip = calculateJobWip(
    lineItemWip.map((l) => l.wip),
    billedToDate,
    unassignedLaborCost(job.timeEntries, schedulesByCraft, employerBurdenRates),
  );
  const billingPosition = jobOverUnderBilling(jobWip);
  const earnedRevenue = jobEarnedRevenue(jobWip);
  // Only for the sentence under the heading. Nothing computed above reads it
  // -- the dollars use each TIME ENTRY's own day, not today's.
  const burdenPercentToday = employerBurdenPercentOnDay(employerBurdenRates, serverToday());

  const timeZone = await viewerTimeZone();

  return {
    job,
    isEstimateStage,
    catalogEntries,
    craftClassifications,
    phaseCodes,
    employerBurdenRates,
    estimateTemplates,
    wallTypeInputs,
    wallRunViews,
    unpricedWallRuns,
    bidRecapRow,
    bidDefaults,
    bidRecapRates,
    bidRecapLines,
    burdenPercentForBid,
    missingIndirectLines,
    crossChecks,
    priceAnomalyReport,
    craftOptions,
    estimatedLaborCostByLineItem,
    laborCostApplyByLineItem,
    lineItemWip,
    productivityByLineItem,
    jobWip,
    billingPosition,
    earnedRevenue,
    burdenPercentToday,
    timeZone,
  };
}

export type JobEstimateData = NonNullable<Awaited<ReturnType<typeof loadJobEstimateData>>>;
