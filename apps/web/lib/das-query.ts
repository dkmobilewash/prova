/**
 * Fetching for the DAS 140 / DAS 142 screens.
 *
 * Fetches here, decides in lib/das-forms.ts and lib/das-print.ts — the same
 * split as `union-compliance-query.ts` / `apprentice-ratio.ts`, and for the
 * same reason its header gives: the deciding half is where the bugs live and
 * has to be testable without a database.
 *
 * Every date leaves here as a `YYYY-MM-DD` string rather than a `Date`, which
 * is what lib/das-forms.ts takes. Not a style choice: a `Date` handed to a
 * client component invites `getDate()` and reads the previous day for every
 * reader west of UTC (#101, and lib/render-date.ts's header).
 */

import { prisma } from "@prova/db";
import type { CraftTier } from "@/lib/apprentice-ratio";
import { dayOf, type IsoDay } from "@/lib/das-forms";

const iso = (date: Date | null): IsoDay | null => (date ? dayOf(date) : null);
const num = (value: unknown) => (value == null ? null : Number(value));

export type CommitteeRow = {
  id: string;
  name: string;
  craftName: string;
  craftClassificationId: string | null;
  craftClassificationLabel: string | null;
  geographicArea: string;
  programSponsorNumber: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  email: string | null;
  fax: string | null;
  phone: string | null;
  approvedToTrainUs: boolean | null;
  sourceUrl: string | null;
  note: string | null;
  /** So the directory can say why a committee cannot be removed before
   * somebody clicks the button and finds out. */
  noticeCount: number;
  requestCount: number;
};

export async function loadApprenticeshipCommittees(companyId: string): Promise<CommitteeRow[]> {
  const rows = await prisma.apprenticeshipCommittee.findMany({
    where: { companyId },
    orderBy: [{ craftName: "asc" }, { name: "asc" }],
    include: {
      craftClassification: { select: { name: true } },
      _count: { select: { das140Notices: true, das142Requests: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    craftName: row.craftName,
    craftClassificationId: row.craftClassificationId,
    craftClassificationLabel: row.craftClassification?.name ?? null,
    geographicArea: row.geographicArea,
    programSponsorNumber: row.programSponsorNumber,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    city: row.city,
    state: row.state,
    postalCode: row.postalCode,
    email: row.email,
    fax: row.fax,
    phone: row.phone,
    approvedToTrainUs: row.approvedToTrainUs,
    sourceUrl: row.sourceUrl,
    note: row.note,
    noticeCount: row._count.das140Notices,
    requestCount: row._count.das142Requests,
  }));
}

export type Das140Row = {
  id: string;
  committeeId: string;
  committeeName: string;
  craftName: string;
  election: "APPROVED_TO_TRAIN" | "WILL_COMPLY_WITH_STANDARDS" | "CAC_REGULATIONS";
  contractExecutedOn: IsoDay;
  estimatedJourneymanHours: number | null;
  estimatedApprenticeHours: number | null;
  estimatedStartOn: IsoDay | null;
  estimatedCompletionOn: IsoDay | null;
  contractAmount: number | null;
  projectIdentifier: string | null;
  sentOn: IsoDay | null;
  sentMethod: string | null;
  proofNote: string | null;
  note: string | null;
};

export type Das142Row = {
  id: string;
  committeeId: string;
  committeeName: string;
  craftName: string;
  apprenticesRequested: number;
  neededFrom: IsoDay;
  neededTo: IsoDay | null;
  requestedOn: IsoDay | null;
  projectIdentifier: string | null;
  sentMethod: string | null;
  proofNote: string | null;
  respondedOn: IsoDay | null;
  outcome: "DISPATCHED" | "UNABLE_TO_DISPATCH" | "NO_RESPONSE" | null;
  outcomeNote: string | null;
  note: string | null;
};

export async function loadDas140Notices(jobId: string): Promise<Das140Row[]> {
  const rows = await prisma.das140Notice.findMany({
    where: { jobId },
    orderBy: [{ craftName: "asc" }, { createdAt: "asc" }],
    include: { committee: { select: { name: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    committeeId: row.committeeId,
    committeeName: row.committee.name,
    craftName: row.craftName,
    election: row.election,
    contractExecutedOn: dayOf(row.contractExecutedOn),
    estimatedJourneymanHours: num(row.estimatedJourneymanHours),
    estimatedApprenticeHours: num(row.estimatedApprenticeHours),
    estimatedStartOn: iso(row.estimatedStartOn),
    estimatedCompletionOn: iso(row.estimatedCompletionOn),
    contractAmount: num(row.contractAmount),
    projectIdentifier: row.projectIdentifier,
    sentOn: iso(row.sentOn),
    sentMethod: row.sentMethod,
    proofNote: row.proofNote,
    note: row.note,
  }));
}

export async function loadDas142Requests(jobId: string): Promise<Das142Row[]> {
  const rows = await prisma.das142Request.findMany({
    where: { jobId },
    orderBy: [{ neededFrom: "asc" }, { createdAt: "asc" }],
    include: { committee: { select: { name: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    committeeId: row.committeeId,
    committeeName: row.committee.name,
    craftName: row.craftName,
    apprenticesRequested: row.apprenticesRequested,
    neededFrom: dayOf(row.neededFrom),
    neededTo: iso(row.neededTo),
    requestedOn: iso(row.requestedOn),
    projectIdentifier: row.projectIdentifier,
    sentMethod: row.sentMethod,
    proofNote: row.proofNote,
    respondedOn: iso(row.respondedOn),
    outcome: row.outcome,
    outcomeNote: row.outcomeNote,
    note: row.note,
  }));
}

/**
 * The first day anybody logged an hour on this job — the second bound on the
 * DAS 140 deadline.
 *
 * DERIVED, never entered. The app already knows it, and a typed copy would be
 * free to disagree with the payroll the same deadline would then be defended
 * with. Null means no hours are logged yet, which is not the same as unknown:
 * only the ten-day bound applies. See `das140DueOn`.
 */
export async function loadFirstWorkerDay(jobId: string): Promise<IsoDay | null> {
  const first = await prisma.timeEntry.findFirst({
    where: { jobId },
    orderBy: { date: "asc" },
    select: { date: true },
  });
  return first ? dayOf(first.date) : null;
}

export type JobCraftHours = {
  craftName: string;
  journeymanHours: number;
  apprenticeHours: number;
  unclassifiedHours: number;
};

/**
 * Hours on this job, split by craft and by tier.
 *
 * Hours on a classification with NO TIER recorded, and hours with no craft tag
 * at all, are counted as `unclassifiedHours` and never as journeyman hours —
 * the same rule `lib/apprentice-ratio.ts` enforces, for the same reason its
 * header gives: counting unknown hours as journeyman hours makes a job look
 * fine because nobody finished tagging its crafts.
 *
 * Untagged hours are grouped under one label rather than dropped, so a
 * proposal can say they exist instead of reasoning as though they do not.
 */
export const UNTAGGED_CRAFT_LABEL = "Hours with no craft tag";

export async function loadJobCraftHours(jobId: string): Promise<JobCraftHours[]> {
  const entries = await prisma.timeEntry.findMany({
    where: { jobId },
    select: {
      hours: true,
      craftClassification: { select: { name: true, tier: true } },
    },
  });

  const byCraft = new Map<string, JobCraftHours>();
  for (const entry of entries) {
    const craftName = entry.craftClassification?.name ?? UNTAGGED_CRAFT_LABEL;
    const tier = (entry.craftClassification?.tier ?? null) as CraftTier | null;
    const hours = Number(entry.hours);
    const row =
      byCraft.get(craftName) ??
      { craftName, journeymanHours: 0, apprenticeHours: 0, unclassifiedHours: 0 };
    if (tier === "JOURNEYMAN" || tier === "FOREMAN") row.journeymanHours += hours;
    else if (tier === "APPRENTICE") row.apprenticeHours += hours;
    else row.unclassifiedHours += hours;
    byCraft.set(craftName, row);
  }

  // Rounded at the boundary so a proposal never reads "183.99999999 journeyman
  // hours" — the same hundredths rounding apprentice-ratio.ts uses.
  return [...byCraft.values()]
    .map((row) => ({
      craftName: row.craftName,
      journeymanHours: Math.round(row.journeymanHours * 100) / 100,
      apprenticeHours: Math.round(row.apprenticeHours * 100) / 100,
      unclassifiedHours: Math.round(row.unclassifiedHours * 100) / 100,
    }))
    .sort((a, b) => a.craftName.localeCompare(b.craftName));
}
