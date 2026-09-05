"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { type MergeChoices, planContactMerge } from "@/lib/contact-merge";
import { type ActionResultWith, assertOwner } from "./shared";

/** What the merge actually did — returned so the screen can state the result
 * instead of implying it. A count read back from the page after a refresh is
 * not evidence that THIS merge moved anything. */
type MergeSummary = {
  jobs: number;
  bidInvitations: number;
  interactions: number;
  people: number;
  quickBooksLinks: number;
  quickBooksSyncAttempts: number;
  /** Labels of the winner's blank fields the duplicate filled in. */
  fieldsFilled: string[];
  /** Labels where the caller chose the duplicate's value over the winner's. */
  fieldsOverwritten: string[];
  portalLinkRevoked: boolean;
};

/** The failure half of this action's result. Identical to `actionFail` in
 * shared.ts — named here only so it carries the payload-bearing result type,
 * the same way billing.ts returns its `{ ok: false }` inline. */
function fail(error: string): ActionResultWith<MergeSummary> {
  return { ok: false, error };
}

/**
 * Folds a duplicate contact into the one you are keeping, then deletes it.
 *
 * WHY THIS EXISTS. `createJob` calls `prisma.contact.create` unconditionally
 * and the new-job form is free text, so three jobs for the same GC produce
 * three Contact rows. That splits payment reliability, project history, the
 * bid pipeline and the interaction log four ways, and it makes per-GC
 * contract terms unreachable: the retainage prefill reads
 * `job.contact.defaultRetainagePercent` off a contact that was minted with
 * nulls. A picker stops NEW duplicates. This repairs the existing ones.
 *
 * WHAT MOVES, AND HOW THAT LIST WAS DERIVED. Not by grepping for "contact" —
 * by taking every foreign key the migrations actually created against
 * `"Contact"`, and then, separately, every id-shaped column in the schema
 * that has NO relation behind it, because those are invisible to a schema
 * walk and nothing in the database will catch a miss.
 *
 *   Foreign keys (all four ON DELETE RESTRICT, so a miss would at least
 *   fail loudly):
 *     Job.contactId, BidInvitation.contactId,
 *     ContactInteraction.contactId, ContactPerson.contactId
 *
 *   Untyped references (no FK, no cascade, nothing enforces them):
 *     QuickBooksEntityLink  where entityType = 'Contact'
 *     QuickBooksSyncAttempt where entityType = 'Contact'
 *
 * The QuickBooks link is the dangerous one. `pushInvoiceToQuickBooks` reads
 * it to fill `customerQboId`, so a link left pointing at a deleted contact
 * means an invoice pushed against no customer at all — and a second link
 * claiming the same QuickBooks customer is the double-posting bug that whole
 * table exists to make impossible.
 *
 * Deliberately NOT moved, each checked rather than assumed:
 *   - `OutboundMessage.relatedType/relatedId`: free text on the composer,
 *     and no code path anywhere writes a Contact id into it.
 *   - `QuickBooksSyncAttempt.idempotencyKey` (`contact:<id>`): a historical
 *     log key. It is never used to find a contact — only invoice and payment
 *     keys are looked up — and rewriting it would falsify what was sent.
 *   - `AlertAcknowledgement.alertKey` / `NotificationDispatch.alertKey`:
 *     every `alertKey()` call site was read; the subject is a renewal,
 *     backcharge, job, week or INTERACTION id, never a contact id. The
 *     contact follow-up alert keys off the interaction, whose id does not
 *     change here.
 */
export async function mergeContacts(
  loserId: string,
  winnerId: string,
  options: {
    /** Which side wins each field that is set differently on both. Absent =
     * unanswered, and an unanswered conflict refuses the merge. */
    choices?: MergeChoices;
    /** What the screen showed the person before they armed this. If the
     * duplicate has gained history since, the merge refuses rather than
     * moving rows nobody was shown. Irreversible operations do not get to
     * be approximately right. */
    expected?: {
      jobs: number;
      bidInvitations: number;
      interactions: number;
      people: number;
    };
  } = {},
): Promise<ActionResultWith<MergeSummary>> {
  const context = await requireCompanyContext();
  try {
    assertOwner(context, "Only the account owner can merge contacts");
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Only the account owner can do that");
  }
  const companyId = context.company.id;

  if (!loserId || !winnerId) return fail("Pick a duplicate and a contact to keep.");
  if (loserId === winnerId) return fail("A contact cannot be merged into itself.");

  // Both sides scoped to the caller's company, and both READ before anything
  // is written. #168 was a cleanup that could reach another tenant's job.
  const [loser, winner] = await Promise.all([
    prisma.contact.findUnique({ where: { id: loserId } }),
    prisma.contact.findUnique({ where: { id: winnerId } }),
  ]);
  if (!loser || loser.companyId !== companyId) return fail("That duplicate no longer exists.");
  if (!winner || winner.companyId !== companyId) return fail("That contact no longer exists.");

  const [jobs, bidInvitations, interactions, people] = await Promise.all([
    prisma.job.count({ where: { contactId: loserId, companyId } }),
    prisma.bidInvitation.count({ where: { contactId: loserId, companyId } }),
    prisma.contactInteraction.count({ where: { contactId: loserId, companyId } }),
    prisma.contactPerson.count({ where: { contactId: loserId, companyId } }),
  ]);

  const expected = options.expected;
  if (
    expected &&
    (expected.jobs !== jobs ||
      expected.bidInvitations !== bidInvitations ||
      expected.interactions !== interactions ||
      expected.people !== people)
  ) {
    return fail(
      `${loser.name} has changed since this page loaded — it now has ${jobs} job(s), ` +
        `${bidInvitations} bid invitation(s), ${interactions} interaction(s) and ${people} ` +
        `person/people. Reload and check the numbers before merging.`,
    );
  }

  // Two QuickBooks customers cannot be merged from here, and picking one
  // would silently orphan the other's invoice history inside QuickBooks.
  // (Both linking to the SAME customer is impossible: the table is unique on
  // (companyId, entityType, qboId) as well.)
  const [loserLink, winnerLink] = await Promise.all([
    prisma.quickBooksEntityLink.findUnique({
      where: {
        companyId_entityType_entityId: { companyId, entityType: "Contact", entityId: loserId },
      },
    }),
    prisma.quickBooksEntityLink.findUnique({
      where: {
        companyId_entityType_entityId: { companyId, entityType: "Contact", entityId: winnerId },
      },
    }),
  ]);
  if (loserLink && winnerLink) {
    return fail(
      `Both contacts are linked to different QuickBooks customers (${winnerLink.qboId} and ` +
        `${loserLink.qboId}). Merge those two customers inside QuickBooks first, or unlink one ` +
        `here — otherwise this merge would strand one of them.`,
    );
  }

  const plan = planContactMerge(winner, loser, options.choices ?? {});
  if (plan.unresolved.length > 0) {
    const labels = plan.unresolved.map((c) => `${c.label} ("${c.keep}" vs "${c.duplicate}")`);
    return fail(
      `${labels.join("; ")} — these are filled in differently on the two records. Say which ` +
        `value the merged contact should keep; this action will not choose for you.`,
    );
  }

  const fieldsFilled = plan.fills.map((f) => f.label);
  const fieldsOverwritten = plan.conflicts
    .filter((c) => c.choice === "duplicate")
    .map((c) => c.label);
  const portalLinkRevoked = loser.portalToken !== null;

  const moved = await prisma.$transaction(
    async (tx) => {
      if (Object.keys(plan.updates).length > 0) {
        await tx.contact.update({ where: { id: winnerId }, data: plan.updates });
      }

      const scope = { contactId: loserId, companyId };
      const repoint = { contactId: winnerId };
      const movedJobs = await tx.job.updateMany({ where: scope, data: repoint });
      const movedBids = await tx.bidInvitation.updateMany({ where: scope, data: repoint });
      const movedInteractions = await tx.contactInteraction.updateMany({
        where: scope,
        data: repoint,
      });
      const movedPeople = await tx.contactPerson.updateMany({ where: scope, data: repoint });

      // No foreign key here, so nothing but this line connects the merged
      // contact to its QuickBooks customer.
      const movedLinks = await tx.quickBooksEntityLink.updateMany({
        where: { companyId, entityType: "Contact", entityId: loserId },
        data: { entityId: winnerId },
      });
      const movedAttempts = await tx.quickBooksSyncAttempt.updateMany({
        where: { companyId, entityType: "Contact", entityId: loserId },
        data: { entityId: winnerId },
      });

      // The duplicate's portal link is a live bearer credential: whoever
      // holds that URL opens `/portal/<token>`, with no login, and sees that
      // contact's jobs. The rule that matters is the NEGATIVE one — it is
      // never carried onto the survivor, which would hand the old
      // link-holder everything the survivor can see. That part is pinned by
      // a test.
      //
      // This statement itself is belt-and-braces and says so honestly:
      // deleting the row below kills the token anyway, and removing this
      // line leaves every test green (checked, not assumed). It is here so
      // the credential dies in a statement of its own if this ever becomes
      // an archive instead of a delete.
      await tx.contact.update({ where: { id: loserId }, data: { portalToken: null } });

      // Verified INSIDE the transaction, so anything still pointing at the
      // duplicate rolls the whole merge back instead of reporting success.
      // "The action returned ok" is not a result this repo accepts.
      const stranded = {
        jobs: await tx.job.count({ where: { contactId: loserId } }),
        bidInvitations: await tx.bidInvitation.count({ where: { contactId: loserId } }),
        interactions: await tx.contactInteraction.count({ where: { contactId: loserId } }),
        people: await tx.contactPerson.count({ where: { contactId: loserId } }),
        quickBooksLinks: await tx.quickBooksEntityLink.count({
          where: { entityType: "Contact", entityId: loserId },
        }),
        quickBooksSyncAttempts: await tx.quickBooksSyncAttempt.count({
          where: { entityType: "Contact", entityId: loserId },
        }),
      };
      const left = Object.entries(stranded).filter(([, n]) => n > 0);
      if (left.length > 0) {
        throw new Error(
          `Merge rolled back — still pointing at the duplicate: ${left
            .map(([what, n]) => `${n} ${what}`)
            .join(", ")}.`,
        );
      }

      await tx.contact.delete({ where: { id: loserId } });

      return {
        jobs: movedJobs.count,
        bidInvitations: movedBids.count,
        interactions: movedInteractions.count,
        people: movedPeople.count,
        quickBooksLinks: movedLinks.count,
        quickBooksSyncAttempts: movedAttempts.count,
      };
    },
    // Prisma defaults an interactive transaction to timeout 5000ms and
    // maxWait 2000ms. This body is ~14 sequential round trips, which is
    // nothing against a local socket and not nothing against Neon: a pooled
    // connection, internet latency, and a compute that suspends when idle.
    // Blowing the default is safe — it rolls back — but it would end an
    // irreversible-looking operation in a P2028 that reads like a bug.
    { maxWait: 15_000, timeout: 60_000 },
  );

  revalidatePath("/contacts");
  revalidatePath(`/contacts/${winnerId}`);
  revalidatePath("/jobs");
  revalidatePath("/bids");

  return {
    ok: true,
    value: { ...moved, fieldsFilled, fieldsOverwritten, portalLinkRevoked },
  };
}
