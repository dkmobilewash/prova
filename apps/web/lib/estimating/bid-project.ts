import { prisma, type Prisma, type TradeScope } from "@prova/db";
import type { ActionResultWith } from "@/lib/actions/shared";
import { mayChangeClient } from "@/lib/job-details";
import { planMerge, provisionalGc } from "@/lib/bid-projects";
import { gcPrice, type ParsedAdjustment } from "@/lib/estimating/gc-price";
import { bidTotalOf } from "@/lib/estimating/recap-state";
import { carryPapersToProject, refilePapers } from "@/lib/estimating/bid-papers";

/**
 * The writes behind "one project, many GC invitations, one estimate".
 *
 * Same arrangement as bid-invitation.ts and create-job.ts beside it: plain
 * objects in, a plain result out, the caller supplies the company it already
 * verified and does its own revalidation. No FormData, no auth, no redirect
 * — so the Server Actions (lib/actions/bidProjects.ts) stay a thin parse /
 * permission / revalidate layer, and a database test can drive the real
 * thing.
 *
 * Every refusal is a RETURNED sentence. Production redacts a thrown Server
 * Action message to a digest, and "both have an estimate" is something a
 * person has to be able to read.
 *
 * NOTHING HERE GUESSES. Which invitations are the same job is always a
 * person's call; the migration that introduced projects made one per
 * invitation for exactly that reason.
 */

type Tx = Prisma.TransactionClient;

const PROJECT_GONE = "That project is no longer on this company. Reload the page.";
const INVITATION_GONE = "That bid is no longer on this company. Reload the page.";

// ── creating an invitation ────────────────────────────────────────────────

/**
 * Creates an invitation ON a project, in one transaction: the project the
 * caller named (asserted to be this company's), otherwise a fresh one made
 * from the invitation's own name, date and trade — so a new row never exists
 * without a project. Returns a sentence when the named project isn't theirs.
 *
 * (A nested `bidProject: { create }` cannot be used instead: the invitation
 * is written with scalar foreign keys, and Prisma does not allow a nested
 * relation write in that form.)
 */
export async function createInvitationOnProject(
  companyId: string,
  data: Omit<Prisma.BidInvitationUncheckedCreateInput, "companyId" | "bidProjectId">,
  options: { bidProjectId?: string | null } = {},
): Promise<ActionResultWith<{ id: string; bidProjectId: string }>> {
  return prisma.$transaction(async (tx) => {
    let projectId: string;
    if (options.bidProjectId) {
      const project = await tx.bidProject.findFirst({
        where: { id: options.bidProjectId, companyId },
        select: { id: true },
      });
      if (!project) return { ok: false as const, error: PROJECT_GONE };
      projectId = project.id;
    } else {
      const created = await tx.bidProject.create({
        data: {
          companyId,
          name: data.projectName,
          bidDueDate: (data.dueDate as Date | null | undefined) ?? null,
          tradeScope: (data.tradeScope as TradeScope | null | undefined) ?? null,
        },
        select: { id: true },
      });
      projectId = created.id;
    }
    const invitation = await tx.bidInvitation.create({
      data: { ...data, companyId, bidProjectId: projectId },
      select: { id: true },
    });
    return { ok: true as const, value: { id: invitation.id, bidProjectId: projectId } };
  });
}

// ── project details ───────────────────────────────────────────────────────

export type BidProjectDetails = {
  name: string;
  siteAddress?: string | null;
  siteCity?: string | null;
  owner?: string | null;
  architect?: string | null;
  bidDueDate?: Date | null;
};

const blankToNull = (value: string | null | undefined) => value?.trim() || null;

/** Edits what WE call the job and where it is. Never touches the estimate or
 * the award, and never an invitation's own `projectName` (identity). */
export async function saveBidProjectDetails(
  companyId: string,
  bidProjectId: string,
  details: BidProjectDetails,
): Promise<ActionResultWith<{ bidProjectId: string }>> {
  const name = details.name.trim();
  if (!name) return { ok: false, error: "Give the project a name." };
  const updated = await prisma.bidProject.updateMany({
    where: { id: bidProjectId, companyId },
    data: {
      name,
      siteAddress: blankToNull(details.siteAddress),
      siteCity: blankToNull(details.siteCity),
      owner: blankToNull(details.owner),
      architect: blankToNull(details.architect),
      bidDueDate: details.bidDueDate ?? null,
    },
  });
  if (updated.count === 0) return { ok: false, error: PROJECT_GONE };
  return { ok: true, value: { bidProjectId } };
}

// ── merge / split ─────────────────────────────────────────────────────────

/**
 * "These are the same job": folds `sourceId` into `intoId`. Every invitation
 * on the source moves to the target; the source row is deleted once empty.
 * Blank facts on the target (address, owner…) are filled from the source —
 * never overwritten. The decision about estimates and awards is
 * `planMerge`'s, and it refuses in words.
 */
export async function mergeBidProjects(
  companyId: string,
  sourceId: string,
  intoId: string,
): Promise<ActionResultWith<{ bidProjectId: string; moved: number }>> {
  return prisma.$transaction(async (tx) => {
    const [source, target] = await Promise.all([
      tx.bidProject.findFirst({ where: { id: sourceId, companyId } }),
      tx.bidProject.findFirst({ where: { id: intoId, companyId } }),
    ]);
    if (!source || !target) return { ok: false as const, error: PROJECT_GONE };

    const plan = planMerge(source, target);
    if (!plan.ok) return { ok: false as const, error: plan.error };

    // Free the unique estimate link on the source BEFORE the target takes it.
    if (plan.adoptEstimateJobId !== null) {
      await tx.bidProject.update({ where: { id: source.id }, data: { estimateJobId: null } });
    }
    await tx.bidProject.update({
      where: { id: target.id },
      data: {
        ...(plan.adoptEstimateJobId !== null ? { estimateJobId: plan.adoptEstimateJobId } : {}),
        ...(plan.adoptPrimeAward
          ? {
              primeAwardedContactId: source.primeAwardedContactId,
              primeAwardedName: source.primeAwardedName,
              primeAwardedOn: source.primeAwardedOn,
            }
          : {}),
        siteAddress: target.siteAddress ?? source.siteAddress,
        siteCity: target.siteCity ?? source.siteCity,
        owner: target.owner ?? source.owner,
        architect: target.architect ?? source.architect,
        estimatedValue: target.estimatedValue ?? source.estimatedValue,
        tradeScope: target.tradeScope ?? source.tradeScope,
        bidDueDate: target.bidDueDate ?? source.bidDueDate,
      },
    });
    const movedIds = (
      await tx.bidInvitation.findMany({ where: { bidProjectId: source.id }, select: { id: true } })
    ).map((row) => row.id);
    const moved = await tx.bidInvitation.updateMany({
      where: { bidProjectId: source.id },
      data: { bidProjectId: target.id },
    });
    // THE PAPERS FOLLOW INTO THE SURVIVING PROJECT — quotes, addenda and spec
    // sections are about the building, and now the building is one project.
    // Done BEFORE the source is deleted (its FK is SET NULL, so a paper missed
    // here would fall back to being read through its filing invitation rather
    // than vanish, but none should be missed). Each addendum keeps the
    // acknowledgement of the GC it was filed under and reads "not acknowledged"
    // on the other GCs' forms until somebody does — see bid-papers.ts
    // `acknowledgedOnFor`.
    await carryPapersToProject(tx, source.id, target.id, movedIds);
    await tx.bidProject.delete({ where: { id: source.id } });
    return { ok: true as const, value: { bidProjectId: target.id, moved: moved.count } };
  });
}

/**
 * "Not the same job": gives one invitation a project of its own again.
 * The new project carries only what THAT GC said (its name, date, trade) —
 * the address and owner belong to the job it just left.
 *
 * Refused while that would orphan something true: a GC recorded as winning
 * the prime, or a bid that is WON and linked to the estimate, belongs with
 * the estimate it won.
 */
export async function splitBidInvitation(
  companyId: string,
  bidInvitationId: string,
): Promise<ActionResultWith<{ bidProjectId: string }>> {
  return prisma.$transaction(async (tx) => {
    const invitation = await tx.bidInvitation.findFirst({
      where: { id: bidInvitationId, companyId },
      include: { bidProject: true },
    });
    if (!invitation) return { ok: false as const, error: INVITATION_GONE };
    const project = invitation.bidProject;
    if (!project) return { ok: false as const, error: "This bid has no project to split from." };

    const siblings = await tx.bidInvitation.count({ where: { bidProjectId: project.id } });
    if (siblings < 2) {
      return { ok: false as const, error: "This bid is already on a project of its own." };
    }
    if (project.primeAwardedContactId !== null && project.primeAwardedContactId === invitation.contactId) {
      return {
        ok: false as const,
        error: "This GC is recorded as winning the prime contract on this project. Clear the award first, then split it out.",
      };
    }
    const linkedToEstimate = invitation.wonJobId !== null && invitation.wonJobId === project.estimateJobId;
    if (linkedToEstimate && invitation.status === "WON") {
      return {
        ok: false as const,
        error: "This bid is won and linked to the project's estimate, so it belongs with it. Unlink the estimate first, then split it out.",
      };
    }

    // THE PAPERS STAY WITH THE PROJECT. What the split-off GC keeps is only what
    // is genuinely its own: its row (name, date, status, price, send record), its
    // price adjustment, its bid lines and requirements, its decline and outcome,
    // and its acknowledgement of each addendum (kept as a row, so merging it back
    // restores it). A supplier quote, addendum or spec section that was FILED
    // under it is the building's, so it is re-filed onto a sibling that is
    // staying; it does not leave with the GC. Run BEFORE the invitation changes
    // project, because the heir is "another invitation of THIS project".
    await refilePapers(tx, invitation.id, { keepLeaverAcknowledgements: true });

    const created = await tx.bidProject.create({
      data: {
        companyId,
        name: invitation.projectName,
        bidDueDate: invitation.dueDate,
        tradeScope: invitation.tradeScope,
      },
      select: { id: true },
    });
    await tx.bidInvitation.update({
      where: { id: invitation.id },
      data: {
        bidProjectId: created.id,
        // The "same work as the estimate" link no longer holds once it leaves.
        ...(linkedToEstimate ? { wonJobId: null } : {}),
      },
    });
    return { ok: true as const, value: { bidProjectId: created.id } };
  });
}

// ── the estimate ──────────────────────────────────────────────────────────

/**
 * Starts the ONE estimate for a project, pre-filled: the job's name is the
 * project's, its location and bid date are the project's (or the earliest of
 * its invitations' dates), and its GC is provisional — the first GC to invite
 * us, or the awarded GC if the prime is already known. `Job.contactId` is
 * required and everything downstream reads it, so the estimate needs
 * somebody; it is switched to the winner at award while still an ESTIMATE.
 *
 * The GC's invitation is linked to the new job (`wonJobId`), which keeps every
 * job-side reader (the proposal, the bid-versus-actual comparison) working.
 *
 * Race: two people pressing the button at once must leave ONE job. The job
 * and the project link are written in one transaction, and the link is a
 * conditional update on `estimateJobId IS NULL` — the second writer waits on
 * the row, re-checks, matches nothing and rolls its job back.
 */
export async function startEstimateFromProject(
  companyId: string,
  bidProjectId: string,
): Promise<ActionResultWith<{ jobId: string; contactId: string }>> {
  const ALREADY = "This project already has an estimate. Open it from the project.";
  try {
    return await prisma.$transaction(async (tx) => {
      const project = await tx.bidProject.findFirst({
        where: { id: bidProjectId, companyId },
        include: {
          invitations: {
            select: { id: true, contactId: true, createdAt: true, dueDate: true, wonJobId: true },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          },
        },
      });
      if (!project) return { ok: false as const, error: PROJECT_GONE };
      if (project.estimateJobId) return { ok: false as const, error: ALREADY };

      const gc = provisionalGc(project.invitations, project);
      if (!gc) {
        return { ok: false as const, error: "Add a GC's invitation to this project before starting its estimate." };
      }
      const dates = project.invitations.flatMap((i) => (i.dueDate ? [i.dueDate.getTime()] : []));
      const dueDate = project.bidDueDate ?? (dates.length > 0 ? new Date(Math.min(...dates)) : null);
      const location = [project.siteAddress, project.siteCity].filter((part): part is string => !!part?.trim()).join(", ");

      const job = await tx.job.create({
        data: {
          companyId,
          contactId: gc.contactId,
          name: project.name,
          ...(location ? { projectLocation: location } : {}),
          ...(dueDate ? { bidDueDate: dueDate } : {}),
        },
        select: { id: true },
      });
      const claimed = await tx.bidProject.updateMany({
        where: { id: project.id, estimateJobId: null },
        data: { estimateJobId: job.id },
      });
      if (claimed.count === 0) {
        // Lost the race: someone else's estimate is the project's. Throwing
        // rolls this job back; it is caught below and returned as a sentence.
        throw new EstimateRaceLost();
      }
      // Job-side readers find the bid through the one invitation linked to
      // the job. Only if that invitation has no link of its own already.
      if (gc.wonJobId === null) {
        await tx.bidInvitation.update({ where: { id: gc.id }, data: { wonJobId: job.id } });
      }
      return { ok: true as const, value: { jobId: job.id, contactId: gc.contactId } };
    });
  } catch (err) {
    if (err instanceof EstimateRaceLost) return { ok: false, error: ALREADY };
    throw err;
  }
}

class EstimateRaceLost extends Error {}

/**
 * `linkBidToJob` (an invitation says "this job is my work") also tells the
 * project, when the project has no estimate yet, so the project's other GCs
 * see the same estimate. Best effort and silent by design: an estimate
 * already on the project wins, and a job that is another project's estimate
 * hits the unique index and is left alone — the invitation's own link, which
 * the caller has already written, is unaffected either way.
 */
export async function claimProjectEstimate(bidInvitationId: string, jobId: string): Promise<void> {
  const invitation = await prisma.bidInvitation.findUnique({
    where: { id: bidInvitationId },
    select: { bidProjectId: true },
  });
  if (!invitation?.bidProjectId) return;
  try {
    await prisma.bidProject.updateMany({
      where: { id: invitation.bidProjectId, estimateJobId: null },
      data: { estimateJobId: jobId },
    });
  } catch (err) {
    if ((err as { code?: unknown }).code !== "P2002") throw err;
  }
}

// ── the award ─────────────────────────────────────────────────────────────

export type PrimeAwardInput = {
  /** A GC we have on file. */
  contactId?: string | null;
  /** Otherwise the winner's name as typed. Both blank clears the award. */
  name?: string | null;
  /** ENTERED, never stamped. */
  awardedOn?: Date | null;
};

/**
 * Records who won the PRIME contract on a project — an entered fact — and, if
 * that GC is one that invited us, hands the estimate to them: the job's GC
 * switches to the winner (allowed only while it is still an ESTIMATE, see
 * `mayChangeClient`) and the job-side link moves to the winner's invitation.
 */
export async function recordPrimeAward(
  companyId: string,
  bidProjectId: string,
  input: PrimeAwardInput,
): Promise<ActionResultWith<{ estimateGcSwitched: boolean }>> {
  return prisma.$transaction(async (tx) => {
    const project = await tx.bidProject.findFirst({ where: { id: bidProjectId, companyId } });
    if (!project) return { ok: false as const, error: PROJECT_GONE };

    let contactId: string | null = null;
    let name: string | null = null;
    if (input.contactId) {
      const contact = await tx.contact.findFirst({ where: { id: input.contactId, companyId }, select: { id: true } });
      if (!contact) return { ok: false as const, error: "That GC isn't on your account. Pick one from the list." };
      contactId = contact.id;
    } else {
      name = blankToNull(input.name);
    }
    const cleared = contactId === null && name === null;

    await tx.bidProject.update({
      where: { id: project.id },
      data: {
        primeAwardedContactId: contactId,
        primeAwardedName: name,
        primeAwardedOn: cleared ? null : (input.awardedOn ?? null),
      },
    });
    const switched = contactId ? await handEstimateTo(tx, project.id, contactId) : false;
    return { ok: true as const, value: { estimateGcSwitched: switched } };
  });
}

/**
 * Marking an invitation WON is the sub being told it has the job, which makes
 * that invitation's GC the prime. Same effect as `recordPrimeAward` with that
 * GC; the award DATE is left alone (an entered fact, not stamped here).
 * No-op for an invitation with no project.
 */
export async function awardProjectToInvitation(tx: Tx, bidInvitationId: string): Promise<void> {
  const invitation = await tx.bidInvitation.findUnique({
    where: { id: bidInvitationId },
    select: { contactId: true, bidProjectId: true },
  });
  if (!invitation?.bidProjectId) return;
  await tx.bidProject.update({
    where: { id: invitation.bidProjectId },
    data: { primeAwardedContactId: invitation.contactId, primeAwardedName: null },
  });
  await handEstimateTo(tx, invitation.bidProjectId, invitation.contactId);
}

/** Moves the estimate's GC (and the job-side bid link) to `contactId`, when the
 * project has an estimate, that GC has an invitation on it, and the job is
 * still an ESTIMATE. Returns whether the job's GC changed. */
async function handEstimateTo(tx: Tx, bidProjectId: string, contactId: string): Promise<boolean> {
  const project = await tx.bidProject.findUnique({
    where: { id: bidProjectId },
    select: { estimateJobId: true, estimateJob: { select: { status: true, contactId: true } } },
  });
  if (!project?.estimateJobId || !project.estimateJob) return false;
  const winner = await tx.bidInvitation.findFirst({
    where: { bidProjectId, contactId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  if (!winner) return false;

  let switched = false;
  if (project.estimateJob.contactId !== contactId) {
    if (!mayChangeClient(project.estimateJob.status)) return false;
    await tx.job.update({ where: { id: project.estimateJobId }, data: { contactId } });
    switched = true;
  }
  // `wonJobId` is unique: release it from whoever held it, then take it.
  await tx.bidInvitation.updateMany({
    where: { wonJobId: project.estimateJobId, NOT: { id: winner.id } },
    data: { wonJobId: null },
  });
  await tx.bidInvitation.update({ where: { id: winner.id }, data: { wonJobId: project.estimateJobId } });
  return switched;
}

// ── one GC's price ────────────────────────────────────────────────────────

/**
 * Records (or, with both null, clears) what ONE invitation is quoted relative
 * to the project's estimate. The caller has already parsed the form with
 * `parseGcAdjustment`; this refuses anything that would leave the GC a price of
 * nothing, checked against the estimate as it stands NOW. With no estimate yet
 * the adjustment is saved as entered — there is nothing to price against — and
 * `gcPrice` re-checks it every time the price is read.
 *
 * It writes only the three adjustment columns. The price is never stored, and
 * `bidAmount` (what was actually sent) is a person's entry this does not touch.
 */
export async function saveInvitationPriceAdjustment(
  companyId: string,
  bidInvitationId: string,
  adjustment: Extract<ParsedAdjustment, { ok: true }>,
): Promise<ActionResultWith<{ bidInvitationId: string }>> {
  const invitation = await prisma.bidInvitation.findFirst({
    where: { id: bidInvitationId, companyId },
    select: {
      id: true,
      bidProject: {
        select: {
          estimateJob: {
            select: { lineItems: { where: { isDeleted: false }, select: { quantity: true, unitPrice: true } } },
          },
        },
      },
    },
  });
  if (!invitation) return { ok: false, error: INVITATION_GONE };

  const estimate = invitation.bidProject?.estimateJob ?? null;
  if (estimate) {
    const priced = gcPrice(bidTotalOf(estimate.lineItems), adjustment);
    if (!priced.ok) return { ok: false, error: priced.error };
  }

  const updated = await prisma.bidInvitation.updateMany({
    where: { id: bidInvitationId, companyId },
    data: {
      priceAdjustAmount: adjustment.amount,
      priceAdjustPercent: adjustment.percent,
      priceAdjustReason: adjustment.reason,
    },
  });
  if (updated.count === 0) return { ok: false, error: INVITATION_GONE };
  return { ok: true, value: { bidInvitationId } };
}

