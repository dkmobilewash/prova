import { prisma, Prisma } from "@prova/db";
import type { ActionResultWith } from "@/lib/actions/shared";
import { money } from "@/lib/money";
import { calculateRetainageSummary, type RetainageSummary } from "@/lib/retainage";

/**
 * The body of "log a retainage release", lifted out of the Server Action
 * so two callers can share it: `createRetainageRelease` (the job page's
 * form, which keeps its throw) and the Ask command `release_retainage`,
 * which needs the id and the balance back and its refusals as sentences
 * — production redacts a thrown Server Action message, and a card cannot
 * show a sentence that never arrives.
 *
 * Same arrangement as create-invoice.ts beside it and the two cores in
 * lib/estimating: a plain object in, a plain result out. No FormData, no
 * `requireCompanyContext`, no `revalidatePath`. The caller supplies the
 * company it already verified and does its own revalidation, so this can
 * also run from a database test. The job is asserted in-company HERE, in
 * the write itself, because this is the boundary a card's server-held
 * payload crosses.
 *
 * WHAT A RELEASE IS, read off the schema rather than the name: a lump sum
 * the GC paid back against the job's WHOLE withheld balance — never
 * against one invoice (that is a Payment). The balance is the job page's
 * own arithmetic, `calculateRetainageSummary` over the snapshots on every
 * invoice and the amount on every release, and `loadJobRetainage` below
 * feeds it exactly what app/(app)/jobs/[id]/page.tsx feeds it, so a card
 * made from this read cannot disagree with the panel beneath it.
 *
 * TWO GUARDS THE FORM DOES NOT HAVE, both options, both off unless asked:
 *
 *   `expectedBalance` — the balance the caller last showed. A card was
 *   made from the balance at that moment; another release or another
 *   invoice may have landed in the half hour before the tap. The write is
 *   an INSERT, so there is no row to compare-and-set the way
 *   job-schedule.ts does; instead the balance is re-read and compared
 *   INSIDE the transaction, and the transaction runs SERIALIZABLE so two
 *   releases against the same job cannot both read the same balance and
 *   both insert — Postgres aborts one with a serialization failure, which
 *   comes back here as a sentence rather than a second release.
 *
 *   `refuseOverRelease` — an amount above the balance held. The form
 *   deliberately does NOT set it, and this is a decision rather than an
 *   omission: the per-job balance is signed on purpose (lib/retainage.ts
 *   pins a negative one), and a sub whose invoices predate this app has
 *   no snapshots to release against but still has to log the cheque the
 *   GC actually sent. The card sets it, because a card offers a button
 *   whose only outcome would be that negative balance, and the box's rule
 *   is that a figure it cannot stand behind is refused before the card
 *   exists — and checked again on the tap regardless.
 */
export const JOB_NOT_FOUND = "Job not found";

/** The sentence a tap gets when Postgres refused to serialize two releases
 * against one job at the same instant. Nothing was written. */
export const RELEASE_COLLIDED =
  "Another change to this job's retainage landed at the same moment, so nothing was released. Ask again to see the balance now.";

/** `Math.round(Number(x) * 100)`: the one conversion every comparison in
 * this file and in the command runs through. Decimal columns arrive as
 * strings or Prisma Decimals; float sums arrive from the summary. */
export const cents = (value: number | string): number => Math.round(Number(value) * 100);

/**
 * One job's retainage, read the way the job page reads it and summed the
 * way the job page sums it, with the cents the comparisons run in.
 *
 * `summary` is the page's own object, kept so a card can print
 * `money(summary.totalWithheld)` — the same call, on the same float — and
 * match the panel to the character.
 */
export type JobRetainage = {
  summary: RetainageSummary;
  withheldCents: number;
  releasedCents: number;
  balanceCents: number;
  /** Invoices on the job carrying a snapshot, for the card's caption. */
  invoicesWithRetainage: number;
  releases: number;
};

/** What the read needs: the two delegates, from `prisma` or from a
 * transaction client. */
export type RetainageReader = Pick<Prisma.TransactionClient, "invoice" | "retainageRelease">;

export async function loadJobRetainage(db: RetainageReader, jobId: string): Promise<JobRetainage> {
  // Sequential rather than Promise.all: this also runs inside an
  // interactive transaction, which is one connection.
  const invoices = await db.invoice.findMany({ where: { jobId }, select: { retainageWithheld: true } });
  const releases = await db.retainageRelease.findMany({ where: { jobId }, select: { amount: true } });
  const summary = calculateRetainageSummary({
    invoiceRetainageWithheld: invoices.map((invoice) =>
      invoice.retainageWithheld != null ? Number(invoice.retainageWithheld) : null,
    ),
    releaseAmounts: releases.map((release) => Number(release.amount)),
    // The page passes the job's forecast date through for its "expected
    // release" line; a card has no such line, and the date is not part
    // of the arithmetic.
    substantialCompletionDate: null,
  });
  return {
    summary,
    withheldCents: cents(summary.totalWithheld),
    releasedCents: cents(summary.totalReleased),
    balanceCents: cents(summary.balance),
    invoicesWithRetainage: invoices.filter((invoice) => invoice.retainageWithheld != null).length,
    releases: releases.length,
  };
}

/** The ceiling, in the shape logPayment's own guard uses for an
 * overpayment: what the total would become, what it may not exceed, and
 * what is actually left. */
export function overReleaseSentence(jobName: string, amountCents: number, held: JobRetainage): string {
  const left = held.balanceCents > 0 ? `Only ${money(held.balanceCents / 100)} is still held.` : "Nothing is still held.";
  return `That would bring total released to ${money((held.releasedCents + amountCents) / 100)}, more than the ${money(
    held.withheldCents / 100,
  )} withheld on ${jobName}. ${left}`;
}

/** The sentence a stale card gets, naming what the job holds NOW so the
 * next card is made from the truth. */
export function balanceChangedSentence(jobName: string, held: JobRetainage): string {
  return `${jobName}'s retainage has changed since you last saw it — ${money(held.withheldCents / 100)} withheld, ${money(
    held.releasedCents / 100,
  )} released, ${money(held.balanceCents / 100)} still held. Ask again to see the balance before releasing against it.`;
}

export type CreateRetainageReleaseInput = {
  /** Already validated as a decimal string ("12500.00"). */
  amount: string;
  /** A calendar day at UTC midnight from the form's date field or the
   * card, or the moment of the form's submit when its field was blank —
   * the action's own default, kept. */
  releasedAt: Date;
  note?: string | null;
  createdByUserId: string | null;
};

export type CreateRetainageReleaseOptions = {
  /** The balance the caller last showed, as a decimal string. The write
   * applies only while the job still holds exactly this. */
  expectedBalance?: string;
  /** Refuse an amount above the balance held. See the file comment for
   * why the form leaves this off. */
  refuseOverRelease?: boolean;
};

export type CreateRetainageReleaseResult = {
  releaseId: string;
  jobName: string;
  /** The balance the job holds after this release, in cents. Signed, like
   * the summary it comes from. */
  balanceAfterCents: number;
};

/** Prisma's P2034: the transaction could not be serialized. Checked by
 * `code`, not `instanceof`, for the reason `isUniqueConstraintError` in
 * lib/actions/shared.ts gives — the instanceof is false at runtime here. */
function isWriteConflict(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2034";
}

export async function createRetainageReleaseRecord(
  companyId: string,
  jobId: string,
  input: CreateRetainageReleaseInput,
  options: CreateRetainageReleaseOptions = {},
): Promise<ActionResultWith<CreateRetainageReleaseResult>> {
  const amountCents = cents(input.amount);
  try {
    return await prisma.$transaction(
      async (tx): Promise<ActionResultWith<CreateRetainageReleaseResult>> => {
        const job = await tx.job.findFirst({ where: { id: jobId, companyId }, select: { id: true, name: true } });
        if (!job) return { ok: false, error: JOB_NOT_FOUND };

        const held = await loadJobRetainage(tx, jobId);
        if (options.expectedBalance != null && cents(options.expectedBalance) !== held.balanceCents) {
          return { ok: false, error: balanceChangedSentence(job.name, held) };
        }
        if (options.refuseOverRelease && amountCents > held.balanceCents) {
          return { ok: false, error: overReleaseSentence(job.name, amountCents, held) };
        }

        const release = await tx.retainageRelease.create({
          data: {
            jobId,
            amount: input.amount,
            releasedAt: input.releasedAt,
            note: input.note?.trim() || null,
            createdByUserId: input.createdByUserId,
          },
          select: { id: true },
        });
        return { ok: true, value: { releaseId: release.id, jobName: job.name, balanceAfterCents: held.balanceCents - amountCents } };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (err) {
    if (isWriteConflict(err)) return { ok: false, error: RELEASE_COLLIDED };
    throw err;
  }
}
