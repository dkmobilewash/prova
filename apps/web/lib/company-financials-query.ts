import { cache } from "react";
import { prisma } from "@prova/db";
import { calculateJobWip, calculateLineItemWip } from "./wip";
import { loadRetainageHeld } from "./retainage-query";
import { calculateCompanyFinancials, type CompanyFinancials } from "./company-financials";
import { lineItemCostToDate, unassignedLaborCost } from "./labor-job-cost";
import { loadFringeSchedulesByCraft, TIME_ENTRY_COST_SELECT } from "./fringe-schedules-query";
import { groupRowsBy, rowsFor } from "./group-rows";

/**
 * The active jobs with what their WIP needs: lines and their cost entries,
 * hours, and billed amounts.
 *
 * This was one `job.findMany` with the lines, cost entries, hours and
 * invoices nested under it, which Prisma resolves as five queries run one
 * after another -- and this runs in the (app) layout, so on every page and
 * after every Server Action (measured 2026-09-18). It is now the job query
 * and then every relation at once. Each child query is the SQL Prisma was
 * already sending (`WHERE "jobId" IN (...)`, same filters), so the rows,
 * their order and every figure computed from them are unchanged; the shape
 * handed back is the nested read's, so the arithmetic below did not move.
 */
async function readActiveJobCostRows(companyId: string) {
  const jobs = await prisma.job.findMany({
    where: { companyId, status: { in: ["CONTRACTED", "IN_PROGRESS"] } },
    select: { id: true },
  });
  // A nested read with no parents sends no child queries; neither does this.
  if (jobs.length === 0) return [];
  const jobId = { in: jobs.map((job) => job.id) };

  const [lineItems, timeEntries, invoices] = await Promise.all([
    prisma.jobLineItem.findMany({
      where: { jobId, isDeleted: false },
      select: {
        jobId: true,
        id: true,
        quantity: true,
        unitPrice: true,
        budgetedUnitCost: true,
        currentEstimatedUnitCost: true,
        estimatedCostToComplete: true,
        costEntries: { select: { amount: true } },
      },
    }),
    // Hours are job cost (issue #287). Fetched per job rather than per
    // line because TimeEntry.lineItemId is nullable and the log form's
    // default is "No specific line" -- the unattached ones are real
    // spend and a line-scoped fetch would never see them.
    prisma.timeEntry.findMany({
      where: { jobId },
      select: { ...TIME_ENTRY_COST_SELECT, jobId: true },
    }),
    // amount only, for billedToDate. This file no longer names the
    // retainage column at all, and lib/retainage-single-source.test.ts
    // enforces that it stays that way.
    prisma.invoice.findMany({ where: { jobId }, select: { jobId: true, amount: true } }),
  ]);

  const lineItemsByJob = groupRowsBy(lineItems, (row) => row.jobId);
  const timeEntriesByJob = groupRowsBy(timeEntries, (row) => row.jobId);
  const invoicesByJob = groupRowsBy(invoices, (row) => row.jobId);
  return jobs.map((job) => ({
    lineItems: rowsFor(lineItemsByJob, job.id),
    timeEntries: rowsFor(timeEntriesByJob, job.id),
    invoices: rowsFor(invoicesByJob, job.id),
  }));
}

/**
 * Cached per server request, because the Money Rail reads the very same
 * active-job population (lib/moneyRail.ts says so: "the same population
 * lib/company-financials-query.ts calls active") and the (app) layout runs
 * both on every page. Once per render instead of twice. Outside a React
 * server render (tests, scripts) `cache()` calls straight through.
 */
export const loadActiveJobCostRows = cache(readActiveJobCostRows);

/**
 * Loads what the company-wide figures need, and computes them.
 *
 * Kept apart from company-financials.ts so the arithmetic there stays pure
 * and testable without a database — the same split lib/wip.ts uses.
 *
 * "Active" means contracted or in progress. Estimates are not backlog
 * until someone has signed them, and a completed job is not what the
 * business is carrying.
 *
 * That status filter is for BACKLOG AND MARGIN ONLY. Retainage is
 * deliberately not drawn from it and is not computed here at all — see
 * lib/retainage-query.ts, which owns that population. Reusing this job
 * list for retainage is issue #97, and issue #46 before it: retainage
 * comes back at closeout, when a job is COMPLETE and this filter has
 * already dropped it.
 */
export async function loadCompanyFinancials(companyId: string): Promise<CompanyFinancials> {
  const [jobs, paymentTotal, invoiceTotal, retainageHeld, fringeSchedulesByCraft] = await Promise.all([
    loadActiveJobCostRows(companyId),
    prisma.payment.aggregate({
      where: { invoice: { job: { companyId } } },
      _sum: { amount: true },
    }),
    prisma.invoice.aggregate({
      where: { job: { companyId } },
      _sum: { amount: true },
    }),
    loadRetainageHeld(companyId),
    loadFringeSchedulesByCraft(companyId),
  ]);

  const wipByJob = jobs.map((job) => {
    const lineItems = job.lineItems.map((line) =>
      calculateLineItemWip({
        quantity: Number(line.quantity),
        unitPrice: line.unitPrice === null ? null : Number(line.unitPrice),
        budgetedUnitCost: line.budgetedUnitCost === null ? null : Number(line.budgetedUnitCost),
        currentEstimatedUnitCost:
          line.currentEstimatedUnitCost === null ? null : Number(line.currentEstimatedUnitCost),
        estimatedCostToComplete:
          line.estimatedCostToComplete === null ? null : Number(line.estimatedCostToComplete),
        ...lineItemCostToDate(line.id, line.costEntries, job.timeEntries, fringeSchedulesByCraft),
      }),
    );
    const billedToDate = job.invoices.reduce((sum, invoice) => sum + Number(invoice.amount), 0);
    return calculateJobWip(
      lineItems,
      billedToDate,
      unassignedLaborCost(job.timeEntries, fringeSchedulesByCraft),
    );
  });

  return calculateCompanyFinancials({
    jobs: wipByJob,
    cashCollected: Number(paymentTotal._sum.amount ?? 0),
    totalBilled: Number(invoiceTotal._sum.amount ?? 0),
    retainageHeld,
  });
}
