import { prisma } from "@prova/db";
import { bidTotalOf, recapStateFor } from "@/lib/estimating/recap-state";

/**
 * THE FACTS A JOB GUIDE IS BUILT FROM — one plain, serialisable snapshot per
 * estimate-stage job. `buildJobGuide` (`./buildJobGuide.ts`) is a pure function
 * of this and nothing else, so every sentence the guide says can be traced to a
 * field here, and a test can state a stage of a bid as an object literal.
 *
 * Plain on purpose: strings, numbers, booleans, arrays and nulls. No `Date`, no
 * `Decimal`, no Prisma row — it crosses a server/client boundary and sits in
 * test fixtures. A calendar day is a `YYYY-MM-DD` string (the app stores days at
 * UTC midnight and renders them in UTC), a time of day is minutes after
 * midnight, exactly as `BidInvitation.dueMinute` is stored.
 *
 * ── WHERE EACH FACT COMES FROM, because the schema has no "guide" table ──
 *
 *   drawings       `TakeoffPlan` rows of the job. A plan is one uploaded PDF.
 *   sheets read    distinct `PlanSheetText` pages (the PAGE_INVENTORY stage).
 *   sheet count    the most of: sheets read, the ingest run's `pageCount`, and
 *                  the pages a person has worked on (`TakeoffPlanPage`).
 *   needs a scale  a sheet that is a floor PLAN (the newest `PlanSheetProposal`
 *                  says `proposedPageType = "PLAN"`) or that a person has opened
 *                  as a `TakeoffPlanPage`, and that has NO `TakeoffScaleCalibration`.
 *                  A scale the app only PRE-FILLED (`PlanSheetScaleReading`)
 *                  does not count: nothing on the sheet confirms it until a
 *                  person accepts it, and accepting it is what writes the
 *                  calibration. Cover sheets and details are not in the set,
 *                  so a finished bid is not nagged about them.
 *   measured walls `WallRun` rows (the wall schedule), by wall type.
 *   in the estimate  live `JobLineItem`s (`isDeleted = false`); the wall ones
 *                  carry a `wallTypeComponentId` and no `takeoffItemId`.
 *   priced         a wall type is unpriced when it has no components at all, or
 *                  a live line made from one of its components has no unit
 *                  price. That is the PRICE BOOK's answer in effect: a new wall
 *                  line takes its price from the component's catalog entry
 *                  (`syncWallScheduleLines`), so a catalog entry with no price
 *                  makes a priceless line. A price typed over the catalog's
 *                  counts — it is the estimator's.
 *   recap          `JobBidRecap`: exists, and `appliedAt` is when it was put on
 *                  the prices. `addedTotal` is recomputed by the same
 *                  `recapStateFor` the proposal page uses.
 *   sent           ONLY `BidInvitation.status`. THE SCHEMA DOES NOT RECORD THAT
 *                  A PROPOSAL WAS GENERATED OR OPENED: the proposal is a
 *                  print-styled page, and the bid package is merged in the
 *                  browser and stores nothing (`bid-package.ts`). Sending the
 *                  package marks the invitation SUBMITTED, so that is the only
 *                  "sent" there is, and "proposal generated" is not a fact the
 *                  guide can know. WON and LOST are past SUBMITTED, so they
 *                  count as sent; DECLINED does not (nothing went out).
 *
 * DERIVED, NEVER STORED: nothing here is written anywhere.
 */

export type GuideInvitationStatus = "INVITED" | "SUBMITTED" | "WON" | "LOST" | "DECLINED";

export type GuideInvitationFact = {
  id: string;
  projectName: string;
  status: GuideInvitationStatus;
  /** `YYYY-MM-DD`, or null. */
  dueDate: string | null;
  /** Minutes after midnight on the GC's wall clock, or null (the day alone is the deadline). */
  dueMinute: number | null;
};

export type GuideWallTypeFact = {
  wallTypeId: string;
  code: string;
  name: string;
  /** Total measured length of this type's runs, in feet. */
  lengthFt: number;
  runCount: number;
  openingsCount: number;
  /** How many components the type has. Zero means it can never produce a priced line. */
  componentCount: number;
  /** Live estimate lines made from this type's components. */
  lineCount: number;
  /** Of those, how many have no unit price. */
  unpricedLineCount: number;
};

/**
 * OPTIONAL INPUT, NOT LOADED HERE. Built by `lib/bid/guide/pastPrice.ts`
 * (another agent's) and set on the facts before `buildJobGuide` runs.
 *
 * `buildJobGuide` reads ONE entry: the one whose `wallTypeCode` equals the
 * code of the FIRST unpriced wall type (the first by code order, as listed in
 * `wallTypes`). It then puts "You priced {label} on {fromJobName} {whenLabel}.
 * Use that?" in the ask's body and adds the primary action
 * `{ actionId: "usePastPrice", actionArg: <wallTypeCode> }`.
 *
 * `actionArg` IS THE WALL TYPE CODE (e.g. "W2"), unique per company
 * (`WallType @@unique([companyId, code])`). The job is the screen's own, so the
 * action needs only the pair (jobId from the page, wallTypeCode from here).
 */
export type PastPriceSuggestion = {
  wallTypeCode: string;
  /** What the past price was for: `6" 1-HR wall`. */
  label: string;
  /** The job it came from: `Civic Center`. */
  fromJobName: string;
  /** When, as a phrase that reads after "on {job}": `in September`. */
  whenLabel: string;
};

export type JobGuideFacts = {
  jobId: string;
  name: string;
  gcName: string | null;

  /** The estimate's own bid date (`Job.bidDueDate`), `YYYY-MM-DD`, or null. */
  jobBidDueDate: string | null;
  /** The bid project this estimate belongs to, when one is linked. */
  project: { id: string; name: string; bidDueDate: string | null } | null;
  /** Invitations that are the same work as this estimate: the one linked by
   *  `wonJobId` plus every invitation under the linked project. */
  invitations: GuideInvitationFact[];

  hasTakeoffPlan: boolean;
  planCount: number;
  sheetCount: number;
  sheetsRead: number;
  /** Floor-plan sheets with no calibration yet — see the header. */
  sheetsMissingScale: number;

  wallTypes: GuideWallTypeFact[];
  wallRunCount: number;
  /** Total measured wall length across all runs, feet. */
  measuredFootageFt: number;
  openingsCount: number;
  /** Live estimate lines that came from the wall schedule. */
  wallLineCount: number;

  lineCount: number;
  /** Live lines with no unit price that are not cost-only indirects. */
  linesWithoutPrice: number;
  /** Live lines with no budgeted unit cost. */
  linesWithoutCost: number;
  /** The bid as it stands: `bidTotalOf` over the live lines. */
  bidTotal: number;

  /** The job's own recap row, or null when it has none. */
  recap: { appliedAt: string | null; addedTotal: number } | null;

  /** Optional — see `PastPriceSuggestion`. */
  pastPriceSuggestions?: PastPriceSuggestion[];
};

// ── the pure half ────────────────────────────────────────────────────────────

/** A bid that went out: submitted, or past submitted. DECLINED sent nothing. */
export function invitationWasSent(status: GuideInvitationStatus): boolean {
  return status === "SUBMITTED" || status === "WON" || status === "LOST";
}

/**
 * Is this estimate still being worked, for the home list? An estimate whose
 * every linked invitation has closed one way or another (declined, won, lost)
 * is finished business; one with no invitation at all is open, and so is one
 * with any invitation still INVITED or SUBMITTED (a sent bid is waiting on a
 * decision, which the guide shows as "working").
 */
export function isOpenForGuide(facts: Pick<JobGuideFacts, "invitations">): boolean {
  if (facts.invitations.length === 0) return true;
  return facts.invitations.some((invitation) => invitation.status === "INVITED" || invitation.status === "SUBMITTED");
}

// ── the loading half ─────────────────────────────────────────────────────────

const day = (value: Date | null | undefined): string | null => (value ? value.toISOString().slice(0, 10) : null);
const num = (value: { toString(): string } | number | null | undefined): number => (value == null ? 0 : Number(value));

/** The most open estimate jobs one home list will load; far past any real desk. */
const OPEN_JOB_LIMIT = 200;

type LoadedJob = Awaited<ReturnType<typeof loadJobRows>>[number];

function loadJobRows(companyId: string, where: { id?: string; status?: "ESTIMATE" }, take?: number) {
  return prisma.job.findMany({
    where: { companyId, ...where },
    orderBy: [{ createdAt: "desc" }],
    take,
    select: {
      id: true,
      name: true,
      status: true,
      bidDueDate: true,
      contact: { select: { name: true } },
      wonFromBid: { select: { id: true, projectName: true, status: true, dueDate: true, dueMinute: true } },
      bidProject: {
        select: {
          id: true,
          name: true,
          bidDueDate: true,
          invitations: { select: { id: true, projectName: true, status: true, dueDate: true, dueMinute: true } },
        },
      },
      bidRecap: true,
    },
  });
}

/**
 * Facts for a set of jobs the caller has ALREADY scoped to one company. Every
 * query below is one round trip for the whole set (`jobId in (…)`), never one
 * per job, and each also carries `companyId` where the table has it.
 */
async function factsForJobs(companyId: string, jobs: LoadedJob[]): Promise<JobGuideFacts[]> {
  if (jobs.length === 0) return [];
  const jobIds = jobs.map((job) => job.id);

  const [lines, runs, plans] = await Promise.all([
    prisma.jobLineItem.findMany({
      where: { jobId: { in: jobIds }, isDeleted: false, job: { companyId } },
      select: {
        jobId: true,
        quantity: true,
        unitPrice: true,
        budgetedUnitCost: true,
        costCategory: true,
        indirectKind: true,
        wallTypeComponentId: true,
        takeoffItemId: true,
        id: true,
      },
    }),
    prisma.wallRun.findMany({
      where: { jobId: { in: jobIds }, companyId },
      select: { jobId: true, wallTypeId: true, lengthFt: true, openings: true },
    }),
    prisma.takeoffPlan.findMany({
      where: { jobId: { in: jobIds }, companyId },
      select: { id: true, jobId: true },
    }),
  ]);

  const planIds = plans.map((plan) => plan.id);
  const typeIds = [...new Set(runs.map((run) => run.wallTypeId))];

  const [sheetTexts, proposals, pages, ingests, wallTypes] = await Promise.all([
    planIds.length
      ? prisma.planSheetText.findMany({ where: { planId: { in: planIds } }, select: { planId: true, pageNumber: true } })
      : [],
    planIds.length
      ? prisma.planSheetProposal.findMany({
          where: { planId: { in: planIds } },
          orderBy: { createdAt: "asc" },
          select: { planId: true, pageNumber: true, proposedPageType: true },
        })
      : [],
    planIds.length
      ? prisma.takeoffPlanPage.findMany({
          where: { planId: { in: planIds } },
          select: { planId: true, pageNumber: true, _count: { select: { calibrations: true } } },
        })
      : [],
    planIds.length
      ? prisma.planIngestJob.findMany({ where: { planId: { in: planIds }, companyId }, select: { planId: true, pageCount: true } })
      : [],
    typeIds.length
      ? prisma.wallType.findMany({
          where: { id: { in: typeIds }, companyId },
          select: { id: true, code: true, name: true, components: { select: { id: true } } },
        })
      : [],
  ]);

  const typeById = new Map(wallTypes.map((type) => [type.id, type]));
  const typeOfComponent = new Map<string, string>();
  for (const type of wallTypes) for (const component of type.components) typeOfComponent.set(component.id, type.id);

  return jobs.map((job): JobGuideFacts => {
    // ── estimate lines ──
    const jobLines = lines.filter((line) => line.jobId === job.id);
    const wallLines = jobLines.filter((line) => line.wallTypeComponentId !== null && line.takeoffItemId === null);
    const priceless = (line: (typeof jobLines)[number]) => line.unitPrice === null;

    // ── measured walls, by type ──
    const jobRuns = runs.filter((run) => run.jobId === job.id);
    const wallTypeFacts: GuideWallTypeFact[] = [];
    for (const typeId of [...new Set(jobRuns.map((run) => run.wallTypeId))]) {
      const type = typeById.get(typeId);
      if (!type) continue; // a run whose type is gone or another company's: the schedule calls it an orphan
      const typeRuns = jobRuns.filter((run) => run.wallTypeId === typeId);
      const typeLines = wallLines.filter((line) => typeOfComponent.get(line.wallTypeComponentId as string) === typeId);
      wallTypeFacts.push({
        wallTypeId: typeId,
        code: type.code,
        name: type.name,
        lengthFt: typeRuns.reduce((sum, run) => sum + num(run.lengthFt), 0),
        runCount: typeRuns.length,
        openingsCount: typeRuns.reduce((sum, run) => sum + (Array.isArray(run.openings) ? run.openings.length : 0), 0),
        componentCount: type.components.length,
        lineCount: typeLines.length,
        unpricedLineCount: typeLines.filter(priceless).length,
      });
    }
    wallTypeFacts.sort((a, b) => a.code.localeCompare(b.code));

    // ── drawings and sheets ──
    const jobPlanIds = new Set(plans.filter((plan) => plan.jobId === job.id).map((plan) => plan.id));
    let sheetCount = 0;
    let sheetsRead = 0;
    let sheetsMissingScale = 0;
    for (const planId of jobPlanIds) {
      const read = new Set(sheetTexts.filter((row) => row.planId === planId).map((row) => row.pageNumber));
      const worked = new Map(pages.filter((row) => row.planId === planId).map((row) => [row.pageNumber, row._count.calibrations]));
      const ingestPages = Math.max(0, ...ingests.filter((row) => row.planId === planId).map((row) => row.pageCount));
      const pageType = new Map<number, string | null>(); // asc by createdAt, so the last write is the newest
      for (const row of proposals) if (row.planId === planId) pageType.set(row.pageNumber, row.proposedPageType);

      const known = new Set([...read, ...worked.keys()]);
      sheetCount += Math.max(known.size, ingestPages);
      sheetsRead += read.size;
      for (const pageNumber of known) {
        const isFloorPlan = pageType.get(pageNumber) === "PLAN" || worked.has(pageNumber);
        if (isFloorPlan && (worked.get(pageNumber) ?? 0) === 0) sheetsMissingScale += 1;
      }
    }

    // ── invitations: the one linked by wonJobId plus the project's ──
    const byId = new Map<string, GuideInvitationFact>();
    for (const invitation of [job.wonFromBid, ...(job.bidProject?.invitations ?? [])]) {
      if (!invitation) continue;
      byId.set(invitation.id, {
        id: invitation.id,
        projectName: invitation.projectName,
        status: invitation.status as GuideInvitationStatus,
        dueDate: day(invitation.dueDate),
        dueMinute: invitation.dueMinute,
      });
    }

    const recapLines = jobLines;
    const recapState = recapStateFor(job.bidRecap, recapLines);

    return {
      jobId: job.id,
      name: job.name,
      gcName: job.contact?.name ?? null,
      jobBidDueDate: day(job.bidDueDate),
      project: job.bidProject
        ? { id: job.bidProject.id, name: job.bidProject.name, bidDueDate: day(job.bidProject.bidDueDate) }
        : null,
      invitations: [...byId.values()],
      hasTakeoffPlan: jobPlanIds.size > 0,
      planCount: jobPlanIds.size,
      sheetCount,
      sheetsRead,
      sheetsMissingScale,
      wallTypes: wallTypeFacts,
      wallRunCount: jobRuns.length,
      measuredFootageFt: wallTypeFacts.reduce((sum, type) => sum + type.lengthFt, 0),
      openingsCount: wallTypeFacts.reduce((sum, type) => sum + type.openingsCount, 0),
      wallLineCount: wallLines.length,
      lineCount: jobLines.length,
      linesWithoutPrice: jobLines.filter((line) => priceless(line) && line.indirectKind === null).length,
      linesWithoutCost: jobLines.filter((line) => line.budgetedUnitCost === null).length,
      bidTotal: bidTotalOf(jobLines),
      recap: recapState ? { appliedAt: day(recapState.appliedAt), addedTotal: recapState.addedTotal } : null,
    };
  });
}

/**
 * One estimate-stage job's facts, or null when the job is not this company's
 * (or does not exist, or has left the estimate stage) — the caller 404s.
 */
export async function loadJobGuideFacts(companyId: string, jobId: string): Promise<JobGuideFacts | null> {
  const jobs = await loadJobRows(companyId, { id: jobId });
  const job = jobs[0];
  if (!job || job.status !== "ESTIMATE") return null;
  return (await factsForJobs(companyId, [job]))[0] ?? null;
}

/**
 * Every open estimate-stage job of the company, for the home list — a fixed
 * number of queries however many jobs there are (see `factsForJobs`).
 */
export async function loadOpenJobGuideFacts(companyId: string): Promise<JobGuideFacts[]> {
  const jobs = await loadJobRows(companyId, { status: "ESTIMATE" }, OPEN_JOB_LIMIT);
  const facts = await factsForJobs(companyId, jobs);
  return facts.filter(isOpenForGuide);
}
