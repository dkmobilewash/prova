import { prisma } from "@prova/db";

import { loadScheduleProposals, scheduleSheetCountFor } from "./plan-ingest/scheduleProposalsQuery";
import { sheetIndexFor } from "./plan-ingest/sheetIndexQuery";
import type { DeliveredRead } from "./takeoff-delivery";

/**
 * THE READS WE CAN SEND A PROSPECT, AND THE ONE WE ARE SENDING.
 *
 * `lib/takeoff-delivery.ts` renders the email a contractor gets back after a
 * free drawing-set read. It is pure: every fact in the mail arrives as an
 * argument. This file is the only thing that assembles those arguments out of
 * the database, so it is the seam between the pipeline's rows and the text.
 *
 * It had 44 passing tests and nothing in the app called it. CLAUDE.md records
 * three live instances of "written, documented, and never called" found in one
 * day, every one of them green, because nothing referenced the dead code — so
 * this module and `/sales/[id]/drawing-read` exist to close that shape rather
 * than to add a capability the delivery module did not already have.
 *
 * ── WHY THERE ARE TWO FUNCTIONS AND NOT ONE ──
 *
 * The operator needs the CANDIDATES before they have chosen one, and the read
 * only after. Folding them together would make the picker depend on a query
 * that cannot answer until the picking is done — the same reason
 * `scheduleProposalsQuery.ts` keeps its count and its rows apart, in its own
 * words.
 *
 * ── SCOPED BY COMPANY ON BOTH, FROM THE SESSION AND NEVER FROM THE URL ──
 *
 * `readCandidates` takes a `companyId` into its `where`; `deliveredReadFor`
 * takes BOTH ids off the URL and must therefore prove each one. It follows
 * `findLead` in `lib/actions/sales.ts` exactly — read the row by its id, then
 * refuse it unless its `companyId` matches — and it returns null rather than
 * naming which half failed. A caller that could tell "that lead is ours but
 * that plan is not" apart from "neither is" has a membership oracle over
 * another tenant's files, and an id in a URL is a claim, not a fact.
 *
 * Nothing here decides anything about the mail. Every sentence belongs to
 * `takeoff-delivery.ts` and every count to `plan-ingest/`.
 */

/**
 * How many sets the picker offers, newest first.
 *
 * A CEILING RATHER THAN A PAGE SIZE, and it is here because of what the loop
 * below costs: `scheduleSheetCountFor` is per-plan by construction (it takes
 * one `planId`), so a candidate list is one query per row. Twenty-five is far
 * above the number of prospect sets in flight at once on a company that
 * ingests them by hand, and far below the point where that loop is the reason
 * a page is slow. The screen says the list is the newest rather than all of
 * them, so a truncated list is never read as "that set is gone".
 */
export const MAX_READ_CANDIDATES = 25;

/**
 * One drawing set the operator could send a read of.
 *
 * `sheetCount` and `scheduleCount` are both there so the operator can tell two
 * uploads of the same job apart on screen — a set that has not been ingested
 * yet reads as 0 sheets, which is the honest answer and the one that stops
 * somebody emailing an empty read.
 */
export type ReadCandidate = {
  planId: string;
  fileName: string | null;
  jobName: string;
  uploadedAt: Date;
  sheetCount: number;
  scheduleCount: number;
};

export async function readCandidates(companyId: string): Promise<ReadCandidate[]> {
  const plans = await prisma.takeoffPlan.findMany({
    where: { companyId },
    // Newest first: the set somebody just ingested for the prospect they are
    // looking at is the one they want, and it is the last one uploaded.
    orderBy: { createdAt: "desc" },
    take: MAX_READ_CANDIDATES,
    select: {
      id: true,
      fileName: true,
      createdAt: true,
      job: { select: { name: true } },
      // The pages the inventory stage actually recorded, counted by the
      // database rather than by loading the rows. `sheetIndexFor` builds its
      // index off this same table, so this number is the length of the index
      // the email would carry.
      _count: { select: { sheetTexts: true } },
    },
  });

  return Promise.all(
    plans.map(async (plan) => ({
      planId: plan.id,
      fileName: plan.fileName,
      jobName: plan.job.name,
      // `createdAt` is when the file was uploaded — `TakeoffPlan.sheetIssuedOn`
      // is the date printed on the paper and says nothing about this.
      uploadedAt: plan.createdAt,
      sheetCount: plan._count.sheetTexts,
      // NOT `count` OVER THE PROPOSAL ROWS. A set ingested twice has a
      // proposal per page per run, so counting rows would tell somebody a
      // four-sheet set carries twelve schedules. `scheduleSheetCountFor`
      // counts the NEWEST proposal per page and its own comment says why; a
      // second copy of that rule here is the drift CLAUDE.md records shipping
      // a bid $1,732.50 under the screen that shared its source.
      scheduleCount: await scheduleSheetCountFor(plan.id),
    })),
  );
}

/**
 * Everything the email needs about one lead and one set, or null.
 *
 * NULL COVERS FOUR DIFFERENT THINGS ON PURPOSE: no such lead, no such plan,
 * a lead belonging to another company, a plan belonging to another company.
 * See the header — the caller gets one sentence because the difference between
 * them is information about another tenant.
 *
 * ── WHERE `projectName` COMES FROM, AND WHERE IT DELIBERATELY DOES NOT ──
 *
 * `ReadSubject.projectName` is what puts a name a contractor recognises in the
 * subject line, which matters because `deliverySubjectLine` falls back to the
 * file name and the file is called `Bid Set.pdf` on four different jobs.
 *
 * It is the JOB the plan hangs off — the job we created on our own company to
 * ingest their set — and NOT the "Project:" line inside the lead's intake
 * note. The note is assembled by `requestNote` in `lib/takeoff-offer.ts`, so
 * reading a value back out of it means a second place in this repo that knows
 * that note's layout, and the first reformat of that function would silently
 * drop the project out of every subject line with nothing to say so. The job
 * name is a column, it is always present, and it is the string the operator
 * already picks the set by on screen.
 */
export async function deliveredReadFor(
  leadId: string,
  planId: string,
  companyId: string,
): Promise<DeliveredRead | null> {
  const [lead, plan] = await Promise.all([
    prisma.salesLead.findUnique({
      where: { id: leadId },
      select: { companyId: true, companyName: true, contactName: true },
    }),
    prisma.takeoffPlan.findUnique({
      where: { id: planId },
      select: { companyId: true, fileName: true, job: { select: { name: true } } },
    }),
  ]);

  if (!lead || lead.companyId !== companyId) return null;
  if (!plan || plan.companyId !== companyId) return null;

  // Only now, with both ids proved ours. `sheetIndexFor` carries the company
  // on both of its own queries as well, which is belt and braces rather than
  // redundancy: it is reached from the plan review screen too, and a query
  // that scopes itself cannot be mis-called.
  const [sheets, schedules] = await Promise.all([
    sheetIndexFor(planId, companyId),
    loadScheduleProposals(planId),
  ]);

  return {
    subject: {
      companyName: lead.companyName,
      // `SalesLead.contactName` is nullable — a lead typed in by hand on
      // /sales need not have one. `openingLine` takes the first word of it,
      // so an empty string is the case it already handles (it drops the
      // greeting rather than addressing nobody).
      contactName: lead.contactName ?? "",
      projectName: plan.job.name,
      fileName: plan.fileName,
    },
    sheets,
    schedules,
  };
}
