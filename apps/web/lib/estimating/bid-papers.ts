import type { Prisma } from "@prova/db";

/**
 * THE PAPERS ABOUT A BUILDING — supplier quotes (`BidQuote`), addenda
 * (`BidAddendum`) and spec sections (`BidSpecSection`) — belong to the
 * PROJECT (`BidProject`), not to the one GC invitation they were filed under.
 * Four GCs inviting a sub to price the same hospital is four invitations on one
 * project; a quote or an addendum about that hospital is the same paper on all
 * four rows.
 *
 * Every paper still carries `bidInvitationId` — now meaning FILED UNDER: which
 * GC's invitation it came in with. That is provenance (the row says so on
 * screen), the cascade (deleting an invitation can only delete what is filed
 * under it) and, for an addendum, where its original `acknowledgedOn` lives.
 * What is genuinely per-GC stays per-GC; the list, and why, is in
 * changelog.d/feat-project-level-bid-papers.md.
 *
 * THIS FILE IS THE ONE PLACE that decides which papers an invitation sees, so
 * a reader cannot half-adopt the rule. Read through `paperWhere` /
 * `paperWhereMany` / `papersFor`; write through `paperFiling`; never write
 * `where: { bidInvitationId }` for a paper again — that is the question "which
 * papers were filed under this GC", which is not the question any screen asks.
 *
 * THE INVARIANT every write path keeps: when a paper's `bidProjectId` is set,
 * it equals its filing invitation's own `bidProjectId`. Merge, split and delete
 * are the three places an invitation's project changes or an invitation goes
 * away, and each calls into this file to keep it true.
 *
 * A paper whose `bidProjectId` is NULL (written by a build that predates the
 * column, in the minutes a deploy is in flight) is read through its filing
 * invitation only — it is never lost, and the next merge/split heals it.
 */

type Tx = Prisma.TransactionClient;

export type PaperAnchor = { id: string; bidProjectId: string | null };

/**
 * What every paper row carries for this purpose. `bidInvitationId` is null only
 * for a spec section filed under a JOB that never had a bid (#886); such a row
 * has no project either, so `papersFor` never shows it on a bid.
 */
export type FiledPaper = { bidInvitationId: string | null; bidProjectId: string | null };

/** The `where` for the papers ONE invitation shows. Spread into any of the three models' queries. */
export function paperWhere(anchor: PaperAnchor) {
  return paperWhereMany([anchor]);
}

/**
 * The `where` for the papers ANY of these invitations shows — one query for a
 * whole page of bids rather than one per bid. Group the rows back with
 * `papersFor`.
 */
export function paperWhereMany(anchors: readonly PaperAnchor[]) {
  const projectIds = [...new Set(anchors.flatMap((a) => (a.bidProjectId ? [a.bidProjectId] : [])))];
  const branches: ({ bidProjectId: { in: string[] } } | { bidProjectId: null; bidInvitationId: { in: string[] } })[] = [];
  if (projectIds.length > 0) branches.push({ bidProjectId: { in: projectIds } });
  branches.push({ bidProjectId: null, bidInvitationId: { in: anchors.map((a) => a.id) } });
  return { OR: branches };
}

/** The rows from a `paperWhereMany` query that one invitation shows. */
export function papersFor<T extends FiledPaper>(anchor: PaperAnchor, rows: readonly T[]): T[] {
  return rows.filter((row) => (row.bidProjectId !== null ? row.bidProjectId === anchor.bidProjectId : row.bidInvitationId === anchor.id));
}

/** What to write on a NEW paper: filed under this invitation, owned by its project. */
export function paperFiling(anchor: PaperAnchor): { bidInvitationId: string; bidProjectId: string | null } {
  return { bidInvitationId: anchor.id, bidProjectId: anchor.bidProjectId };
}

/**
 * The `where` for the papers of the project a JOB is the estimate of, plus any
 * filed under an invitation linked to the job directly (`wonJobId`) — the two
 * ways a job finds its bid. The job-side readers (proposal facts, takeoff
 * currency, estimate cross-checks) used to ask only the second, so a quote
 * filed under GC B's invitation was invisible to a job linked through GC A's.
 * Company-scoped through the filing invitation, which has the column all three
 * models can reach.
 */
export function paperWhereForJob(jobId: string, companyId: string) {
  return {
    bidInvitation: { companyId },
    OR: [{ bidProject: { estimateJobId: jobId } }, { bidInvitation: { wonJobId: jobId } }],
  };
}

// ── acknowledgements: per GC, on a per-project document ──────────────────

type AckRow = { bidInvitationId: string; acknowledgedOn: Date };

/**
 * The day an addendum was acknowledged on ONE invitation's bid form, or null.
 *
 * The addendum DOCUMENT is the project's; each GC's form demands its own
 * acknowledgement, and "acknowledged on GC A's form" says nothing about GC B's
 * (the most common reason a complying bid is thrown out is a missed one). The
 * filing invitation's acknowledgement is the addendum's own `acknowledgedOn`
 * column, exactly as it always was; every other invitation's is a
 * `BidAddendumAcknowledgement` row. No row IS "not acknowledged here".
 */
export function acknowledgedOnFor(
  addendum: { bidInvitationId: string; acknowledgedOn: Date | null; acknowledgements: readonly AckRow[] },
  invitationId: string,
): Date | null {
  if (addendum.bidInvitationId === invitationId) return addendum.acknowledgedOn;
  return addendum.acknowledgements.find((row) => row.bidInvitationId === invitationId)?.acknowledgedOn ?? null;
}

/**
 * Sets (a date) or clears (null) an addendum's acknowledgement on ONE
 * invitation's form. The filing invitation's lives in the column; any other
 * invitation's lives in its own row. Caller has proved the addendum and the
 * invitation are on the same project.
 */
export async function setAddendumAcknowledgement(
  tx: Tx,
  addendum: { id: string; bidInvitationId: string },
  invitationId: string,
  acknowledgedOn: Date | null,
): Promise<void> {
  if (addendum.bidInvitationId === invitationId) {
    await tx.bidAddendum.update({ where: { id: addendum.id }, data: { acknowledgedOn } });
    return;
  }
  if (acknowledgedOn === null) {
    await tx.bidAddendumAcknowledgement.deleteMany({ where: { bidAddendumId: addendum.id, bidInvitationId: invitationId } });
    return;
  }
  await tx.bidAddendumAcknowledgement.upsert({
    where: { bidAddendumId_bidInvitationId: { bidAddendumId: addendum.id, bidInvitationId: invitationId } },
    create: { bidAddendumId: addendum.id, bidInvitationId: invitationId, acknowledgedOn },
    update: { acknowledgedOn },
  });
}

// ── keeping the invariant when invitations move or go ────────────────────

/**
 * Re-files every paper that is filed under `invitationId` AND belongs to its
 * project onto the project's OLDEST OTHER invitation. Returns how many papers
 * moved (0 when the invitation is the project's only one — then nothing has
 * anywhere to go and, on a delete, they cascade away exactly as they always did).
 *
 * Called from the two places a paper would otherwise be stranded on an
 * invitation that is no longer on its project:
 *
 *   - DELETING an invitation. Its papers are the project's, so GC B must not
 *     lose a supplier quote because GC A's invitation was removed. (A paper's
 *     `bidInvitation` relation CASCADEs; without this, deleting one invitation
 *     would delete papers still showing on its siblings.)
 *   - SPLITTING an invitation out of a project. The papers STAY WITH THE
 *     PROJECT; what the split-off GC keeps is only what is its own. So what was
 *     filed under it moves to a sibling, and "filed under" reads as that
 *     sibling's GC from then on.
 *
 * The addendum's original `acknowledgedOn` is the acknowledgement on the
 * filing invitation, so it has to follow the filing invitation:
 *   - the heir's own acknowledgement (a row) is promoted into the column and
 *     its row removed, so the heir keeps what it had acknowledged;
 *   - the leaving invitation's acknowledgement is KEPT as a row when
 *     `keepLeaverAcknowledgements` (a split — it lives on, and returns if the
 *     two are merged again) and dropped otherwise (a delete — the invitation
 *     and its row cascade away together).
 *
 * The readings' denormalised `bidInvitationId` follows its parent, so the
 * overlap and spec-cost reads that group by invitation stay right.
 */
export async function refilePapers(
  tx: Tx,
  invitationId: string,
  options: { keepLeaverAcknowledgements: boolean },
): Promise<number> {
  const invitation = await tx.bidInvitation.findUnique({
    where: { id: invitationId },
    select: { id: true, bidProjectId: true },
  });
  if (!invitation?.bidProjectId) return 0;
  const projectId = invitation.bidProjectId;

  const heir = await tx.bidInvitation.findFirst({
    where: { bidProjectId: projectId, id: { not: invitationId } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  if (!heir) return 0;

  const filedHere = { bidInvitationId: invitationId, bidProjectId: projectId };

  // Addenda first: their acknowledgements have to be rewritten as they move.
  const addenda = await tx.bidAddendum.findMany({
    where: filedHere,
    select: {
      id: true,
      acknowledgedOn: true,
      acknowledgements: { where: { bidInvitationId: heir.id }, select: { id: true, acknowledgedOn: true } },
    },
  });
  for (const addendum of addenda) {
    const heirsAck = addendum.acknowledgements[0] ?? null;
    if (options.keepLeaverAcknowledgements && addendum.acknowledgedOn !== null) {
      await tx.bidAddendumAcknowledgement.upsert({
        where: { bidAddendumId_bidInvitationId: { bidAddendumId: addendum.id, bidInvitationId: invitationId } },
        create: { bidAddendumId: addendum.id, bidInvitationId: invitationId, acknowledgedOn: addendum.acknowledgedOn },
        update: { acknowledgedOn: addendum.acknowledgedOn },
      });
    }
    if (heirsAck) await tx.bidAddendumAcknowledgement.delete({ where: { id: heirsAck.id } });
    await tx.bidAddendum.update({
      where: { id: addendum.id },
      data: { bidInvitationId: heir.id, acknowledgedOn: heirsAck?.acknowledgedOn ?? null },
    });
  }
  const movedAddenda = addenda.length;
  if (movedAddenda > 0) {
    await tx.bidAddendumReading.updateMany({
      where: { bidInvitationId: invitationId, bidAddendum: { bidInvitationId: heir.id, bidProjectId: projectId } },
      data: { bidInvitationId: heir.id },
    });
  }

  const quotes = await tx.bidQuote.updateMany({ where: filedHere, data: { bidInvitationId: heir.id } });
  const sections = await tx.bidSpecSection.updateMany({ where: filedHere, data: { bidInvitationId: heir.id } });
  if (sections.count > 0) {
    await tx.bidSpecReading.updateMany({
      where: { bidInvitationId: invitationId, bidSpecSection: { bidInvitationId: heir.id, bidProjectId: projectId } },
      data: { bidInvitationId: heir.id },
    });
  }
  return movedAddenda + quotes.count + sections.count;
}

/**
 * A MERGE: the source project's invitations have moved to the target, so its
 * papers follow into the surviving project. Also heals any paper that was
 * written without a project (see the header) under a moved invitation. Run
 * AFTER the invitations moved and BEFORE the source project is deleted.
 */
export async function carryPapersToProject(
  tx: Tx,
  sourceProjectId: string,
  targetProjectId: string,
  movedInvitationIds: readonly string[],
): Promise<number> {
  const where = {
    OR: [{ bidProjectId: sourceProjectId }, { bidProjectId: null, bidInvitationId: { in: [...movedInvitationIds] } }],
  };
  const data = { bidProjectId: targetProjectId };
  const [quotes, addenda, sections] = await Promise.all([
    tx.bidQuote.updateMany({ where, data }),
    tx.bidAddendum.updateMany({ where, data }),
    tx.bidSpecSection.updateMany({ where, data }),
  ]);
  return quotes.count + addenda.count + sections.count;
}

/** What `/bids` says a paper "came in under", or null when it is this GC's own. */
export function filedUnderLabel(
  paper: { bidInvitationId: string | null },
  thisInvitationId: string,
  gcNameByInvitation: ReadonlyMap<string, string>,
): string | null {
  if (paper.bidInvitationId === null || paper.bidInvitationId === thisInvitationId) return null;
  return gcNameByInvitation.get(paper.bidInvitationId) ?? null;
}
