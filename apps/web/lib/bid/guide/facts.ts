import { prisma } from "@prova/db";
import { bidTotalOf, recapStateFor } from "@/lib/estimating/recap-state";
import { acknowledgedOnFor, paperWhereMany, papersFor } from "@/lib/estimating/bid-papers";
import { wallHeightQuestions } from "./wallHeight";
import { reachedProvider } from "@/components/messageLabels";
import { BID_INVITATION_RELATED_TYPE } from "@/lib/estimating/proposal-send";
import { boardLayerQuestions } from "./boardLayers";

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
 *   wall height    a wall type used on the job's runs with no `defaultHeightFt`,
 *                  whose runs have no `heightFt` of their own: those runs add
 *                  NOTHING to the estimate (`runGeometry` returns null). Worked
 *                  out by `wallHeightQuestions` (`./wallHeight.ts`), the same
 *                  function the answer's action re-derives with.
 *   board layers   a wall type used on the job's runs with no `boardLayers`
 *                  answer and at least one `perLayer` component, so the answer
 *                  would multiply its board. Worked out by
 *                  `boardLayerQuestions` (`./boardLayers.ts`), the same function
 *                  the answer's action re-derives with.
 *   walk / RFIs    `BidInvitation.walkDate`/`walkMinute`/`rfiCutoffDate` of each
 *                  linked invitation, as entered. The walk's minute is the GC's
 *                  wall clock, exactly like `dueMinute`.
 *   addenda        `BidAddendum` rows the PROJECT shows (read through
 *                  `bid-papers.ts`, never by filing invitation alone), and for
 *                  each still-INVITED invitation whether it is acknowledged on
 *                  THAT GC's form (`acknowledgedOnFor`: the filing GC's is the
 *                  addendum's own column, every other GC's is a
 *                  `BidAddendumAcknowledgement` row). Only the missing pairs are
 *                  kept. A SENT or DECLINED invitation is not asked about: what
 *                  went out went out.
 *   sent           `BidInvitation.status`, OR an email the app sent for the
 *                  invitation. THE SCHEMA DOES NOT RECORD THAT A PROPOSAL WAS
 *                  GENERATED OR OPENED: the proposal is a print-styled page,
 *                  and the bid package is merged in the browser and stores
 *                  nothing (`bid-package.ts`). What it DOES record is a send:
 *                  an `OutboundMessage` with `relatedType = "BID_INVITATION"`
 *                  and `relatedId` = the invitation, written by
 *                  `sendBidProposal` and `submitBidPackage`, that reached the
 *                  provider (`reachedProvider` — any event but FAILED, or a
 *                  provider id). The first such message's day is
 *                  `proposalSentOn`, which is the only submitted DATE there
 *                  is: `BidInvitation` has no column for it, and the message
 *                  is the evidence. Both sends also mark the invitation
 *                  SUBMITTED, so either answer alone would do; reading the
 *                  record too means a status somebody set back by hand cannot
 *                  un-send an email a GC received. WON and LOST are past
 *                  SUBMITTED, so they count as sent; DECLINED does not
 *                  (nothing went out) unless a send record says otherwise.
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
  /** The GC on this invitation (its contact), when known. Absent in older fixtures = null. */
  gcName?: string | null;
  /** The job walk / pre-bid meeting day, `YYYY-MM-DD`, and its wall-clock minute. Absent = none. */
  walkDate?: string | null;
  walkMinute?: number | null;
  /** The last day questions (RFIs) are accepted, `YYYY-MM-DD`. Absent = none. */
  rfiCutoffDate?: string | null;
  /** The day the app first emailed this GC the bid (a proposal or a package)
   *  and the provider took it, `YYYY-MM-DD`. Absent or null = never sent from
   *  the app. Derived from `OutboundMessage` on every read; see the header. */
  proposalSentOn?: string | null;
};

/**
 * One addendum not yet acknowledged on one still-open GC's bid form. The same
 * addendum missing on two GCs' forms is two of these: each form is its own.
 */
export type GuideAddendumFact = {
  addendumId: string;
  /** The GC's own words: "Addendum 2", "ASI 3", or just "2". */
  reference: string;
  /** The day the GC issued it, `YYYY-MM-DD`, or null when nobody entered one. */
  issuedOn: string | null;
  /** The invitation (GC) whose form is missing it. */
  invitationId: string;
  gcName: string | null;
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
  /**
   * Set when the type has no default height AND some of its runs here have no
   * height of their own, so those runs add nothing to the estimate. Absent or
   * null = nothing to ask. See `./wallHeight.ts`.
   */
  heightless?: { runCount: number; lengthFt: number; token: string } | null;
  /**
   * Set when the type has no board-layer answer AND has a part whose factor is
   * per layer, so the answer would change its board. `runCount`/`lengthFt` are
   * every run of the type on this job. Absent or null = nothing to ask. See
   * `./boardLayers.ts`.
   */
  layersUnanswered?: { runCount: number; lengthFt: number; sides: number; token: string } | null;
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
  /**
   * The action's own argument, when the suggestion came from
   * `loadPastPriceSuggestions` (`lib/bid/guide/pastPrice.ts`): `wt:<id>:<token>`,
   * whose token lets the action refuse a price that changed since the screen
   * was drawn. Preferred over the bare code whenever present.
   */
  actionArg?: string;
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

  /** Addenda not acknowledged on a still-open GC's form, in issued order. Absent = none. */
  unacknowledgedAddenda?: GuideAddendumFact[];
};

// ── the pure half ────────────────────────────────────────────────────────────

/** A bid that went out: submitted, or past submitted. DECLINED sent nothing. */
export function invitationWasSent(status: GuideInvitationStatus): boolean {
  return status === "SUBMITTED" || status === "WON" || status === "LOST";
}

/** One invitation went out: by its status, or because the app's own record of
 *  the email says it did (`proposalSentOn`). */
export function invitationFactWasSent(invitation: Pick<GuideInvitationFact, "status" | "proposalSentOn">): boolean {
  return invitationWasSent(invitation.status) || !!invitation.proposalSentOn;
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

const INVITATION_SELECT = {
  id: true,
  projectName: true,
  status: true,
  dueDate: true,
  dueMinute: true,
  walkDate: true,
  walkMinute: true,
  rfiCutoffDate: true,
  bidProjectId: true,
  contact: { select: { name: true } },
} as const;

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
      wonFromBid: { select: INVITATION_SELECT },
      bidProject: {
        select: {
          id: true,
          name: true,
          bidDueDate: true,
          invitations: { select: INVITATION_SELECT },
        },
      },
      bidRecap: true,
    },
  });
}

function heightlessOf(questions: ReturnType<typeof wallHeightQuestions>, wallTypeId: string): GuideWallTypeFact["heightless"] {
  const question = questions.find((q) => q.wallTypeId === wallTypeId);
  return question ? { runCount: question.runCount, lengthFt: question.lengthFt, token: question.token } : null;
}

function layersOf(questions: ReturnType<typeof boardLayerQuestions>, wallTypeId: string): GuideWallTypeFact["layersUnanswered"] {
  const question = questions.find((q) => q.wallTypeId === wallTypeId);
  return question ? { runCount: question.runCount, lengthFt: question.lengthFt, sides: question.sides, token: question.token } : null;
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
      select: { id: true, jobId: true, wallTypeId: true, lengthFt: true, heightFt: true, openings: true },
    }),
    prisma.takeoffPlan.findMany({
      where: { jobId: { in: jobIds }, companyId },
      select: { id: true, jobId: true },
    }),
  ]);

  const planIds = plans.map((plan) => plan.id);
  const typeIds = [...new Set(runs.map((run) => run.wallTypeId))];

  // Every invitation any of these jobs is the same work as, for the addenda.
  const anchors = new Map<string, { id: string; bidProjectId: string | null }>();
  for (const job of jobs) {
    for (const invitation of [job.wonFromBid, ...(job.bidProject?.invitations ?? [])]) {
      if (invitation) anchors.set(invitation.id, { id: invitation.id, bidProjectId: invitation.bidProjectId });
    }
  }

  const [sheetTexts, proposals, pages, ingests, wallTypes, addenda, sends] = await Promise.all([
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
          select: {
            id: true,
            code: true,
            name: true,
            sides: true,
            defaultHeightFt: true,
            boardLayers: true,
            components: { select: { id: true, perLayer: true } },
          },
        })
      : [],
    // One query for the whole set: the papers every anchor shows (bid-papers.ts),
    // with each OTHER GC's acknowledgement row beside the filing GC's column.
    anchors.size
      ? prisma.bidAddendum.findMany({
          where: { companyId, ...paperWhereMany([...anchors.values()]) },
          orderBy: [{ issuedOn: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            reference: true,
            issuedOn: true,
            acknowledgedOn: true,
            bidInvitationId: true,
            bidProjectId: true,
            acknowledgements: { select: { bidInvitationId: true, acknowledgedOn: true } },
          },
        })
      : [],
    // The bid emails the app sent for these invitations, oldest first. One
    // query for the whole set; only the first that reached the provider counts.
    anchors.size
      ? prisma.outboundMessage.findMany({
          where: { companyId, relatedType: BID_INVITATION_RELATED_TYPE, relatedId: { in: [...anchors.keys()] } },
          orderBy: { createdAt: "asc" },
          select: { relatedId: true, createdAt: true, providerMessageId: true, events: { select: { type: true } } },
        })
      : [],
  ]);

  const sentOnByInvitation = new Map<string, string>();
  for (const send of sends) {
    if (!send.relatedId || sentOnByInvitation.has(send.relatedId)) continue;
    if (!reachedProvider(send.providerMessageId, send.events)) continue;
    sentOnByInvitation.set(send.relatedId, day(send.createdAt) as string);
  }

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
    const heightQuestions = wallHeightQuestions(
      jobRuns.map((run) => ({
        id: run.id,
        wallTypeId: run.wallTypeId,
        lengthFt: num(run.lengthFt),
        heightFt: run.heightFt == null ? null : Number(run.heightFt),
      })),
      wallTypes.map((type) => ({
        id: type.id,
        code: type.code,
        defaultHeightFt: type.defaultHeightFt == null ? null : Number(type.defaultHeightFt),
        componentCount: type.components.length,
      })),
    );
    const layerQuestions = boardLayerQuestions(
      jobRuns.map((run) => ({ id: run.id, wallTypeId: run.wallTypeId, lengthFt: num(run.lengthFt) })),
      wallTypes.map((type) => ({
        id: type.id,
        code: type.code,
        sides: type.sides,
        boardLayers: type.boardLayers,
        perLayerCount: type.components.filter((component) => component.perLayer).length,
      })),
    );
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
        heightless: heightlessOf(heightQuestions, typeId),
        layersUnanswered: layersOf(layerQuestions, typeId),
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
    const openAnchors: { id: string; bidProjectId: string | null; gcName: string | null }[] = [];
    for (const invitation of [job.wonFromBid, ...(job.bidProject?.invitations ?? [])]) {
      if (!invitation || byId.has(invitation.id)) continue;
      const gcName = invitation.contact?.name ?? null;
      byId.set(invitation.id, {
        id: invitation.id,
        projectName: invitation.projectName,
        status: invitation.status as GuideInvitationStatus,
        dueDate: day(invitation.dueDate),
        dueMinute: invitation.dueMinute,
        gcName,
        walkDate: day(invitation.walkDate),
        walkMinute: invitation.walkMinute,
        rfiCutoffDate: day(invitation.rfiCutoffDate),
        proposalSentOn: sentOnByInvitation.get(invitation.id) ?? null,
      });
      if (invitation.status === "INVITED") openAnchors.push({ id: invitation.id, bidProjectId: invitation.bidProjectId, gcName });
    }

    // ── addenda not acknowledged on a still-open GC's form ──
    const unacknowledgedAddenda: GuideAddendumFact[] = [];
    for (const anchor of openAnchors) {
      for (const addendum of papersFor(anchor, addenda)) {
        if (acknowledgedOnFor(addendum, anchor.id) !== null) continue;
        unacknowledgedAddenda.push({
          addendumId: addendum.id,
          reference: addendum.reference,
          issuedOn: day(addendum.issuedOn),
          invitationId: anchor.id,
          gcName: anchor.gcName,
        });
      }
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
      unacknowledgedAddenda,
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
