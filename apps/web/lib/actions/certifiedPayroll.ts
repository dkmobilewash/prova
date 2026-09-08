"use server";

// Recording a signed WH-347 Statement of Compliance — page 2 of the
// federal form — and issuing the sequential payroll number page 1's
// header needs.
//
// These are the two blockers `lib/wh347.ts` reports that no amount of work
// on that module can close, because neither is derivable from hours. The
// schema landed in the previous commit; this is the only write path to it.
//
// EVERYTHING HERE IS SHAPED BY ONE FACT: the document this records is
// signed under penalty of perjury. That is not a flourish. It decides that
// the signature date is entered rather than stamped, that the payroll
// number comes from a counter rather than from surviving rows, that
// identity is fixed at creation, and that there is no update path at all.
// Each of those is argued where it is implemented rather than here, so the
// reason is next to the code that would otherwise look over-careful.

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { Prisma, prisma } from "@prova/db";
import { certifiedPayrollWeekWindow } from "@/lib/certified-payroll-week";
import {
  CERTIFIED_PAYROLL_FRINGE_METHODS,
  actionFail as fail,
  actionOk as ok,
  isUniqueConstraintError,
  type ActionResult,
} from "./shared";

/** The one entry point to this action is `/jobs/[id]/certified-payroll/wh-347`,
 * a page guarded by MANAGE_COMPLIANCE, so the write behind it answers to
 * the same capability. A guarded page in front of an open action is not a
 * guard: a Server Action is its own endpoint with a stable id and it
 * answers whoever posts to it.
 *
 * NOT `assertOwner`, and that is a decision rather than an omission.
 * Every owner gate in `lib/actions/*` sits on a DELETE — the irreversible
 * removal of a record somebody else may be relying on. Signing is the
 * opposite: it CREATES evidence, and it is the defining task of the
 * PAYROLL_COMPLIANCE job function, which exists precisely so the person
 * who files certified payroll every Monday is not the owner. Gating this
 * on OWNER would mean the only person hired to do it cannot, on a weekly
 * deadline, which is how a compliance feature stops being used. The
 * accountability that an owner check would supply comes from the record
 * itself instead: every filing carries `signedByUserId`, so who asserted
 * what is answerable from the row rather than from a role.
 *
 * Returned rather than thrown — production redacts a thrown Server Action
 * message to an opaque digest (verified 2026-08-27 on a real production
 * build), so this sentence would never reach the person it is written for.
 * `lib/actions/submittals.ts` is the reference for the shape. */
const COMPLIANCE_ONLY =
  "Certified payroll isn't part of your job function. The account owner sets who sees what, on the Team page.";

/** Expected, user-readable input failures. Thrown internally and turned
 * into `{ ok: false, error }` by `runAction`, so the guards read top-down
 * instead of as a chain of early returns. Same shape as closeout.ts. */
class InputError extends Error {}

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function required(formData: FormData, key: string, label: string) {
  const value = text(formData, key);
  if (!value) throw new InputError(`${label} is required`);
  return value;
}

/** A date the USER typed, parsed to UTC midnight.
 *
 * `new Date("2026-03-09")` is already UTC midnight, but
 * `new Date("2026-03-09T00:00:00")` is local — the difference is one
 * missing suffix and a whole day on either side of the Atlantic. Spelled
 * out so nobody has to remember which of the two this is. */
function requiredEnteredDate(formData: FormData, key: string, label: string): Date {
  const raw = required(formData, key, label);
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new InputError(`${label} is not a valid date`);
  return date;
}

function fringeMethodFrom(formData: FormData) {
  const raw = text(formData, "fringeMethod");
  const allowed = CERTIFIED_PAYROLL_FRINGE_METHODS;
  if (!allowed.includes(raw as (typeof allowed)[number])) {
    // Deliberately not defaulted. 4(a)/4(b) is the substantive claim on
    // page 2; a default would pick, on the signer's behalf, which of two
    // statements about their own trust-fund arrangements they swore to.
    throw new InputError(
      "Say how fringe benefits were paid — into approved plans, in cash, or both. Page 2 says so under penalty of perjury, so it cannot be left blank.",
    );
  }
  return raw as (typeof allowed)[number];
}

async function runAction(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof InputError) return fail(err.message);
    throw err;
  }
}

/** Issues the next payroll number for a job.
 *
 * READS NOTHING FROM `CertifiedPayrollFiling` ON PURPOSE — copied from
 * `issueRfiNumber` in rfis.ts, and the same rule as the other six counters
 * in this schema. A number taken from `max(payrollNumber) + 1` or
 * `count() + 1` is freed again the moment a filing is deleted, and the
 * next filing reissues it.
 *
 * The stakes here are higher than on an RFI, which is why this comment is
 * longer than the function. An awarding body reads the payroll sequence
 * looking for GAPS: that is how they check a contractor filed every week
 * of a contract. Two different weeks submitted under number 7, or a 7
 * arriving after an 8, does not read to them as an application bug — it
 * reads as a missing or falsified payroll, on a document already in their
 * file. `Invoice.number` in this repo is the counter-example: it is
 * `max(n) + 1`, read outside any transaction, and it reissues.
 *
 * Takes the TRANSACTION CLIENT, never `prisma`. Two things follow, and
 * both matter:
 *   - two people filing different weeks of the same job at the same moment
 *     would otherwise read the same `lastNumber` and both be issued it;
 *   - a filing whose insert FAILS — a duplicate week, most likely — must
 *     not consume a number on its way out. Bumping the counter outside the
 *     transaction leaves a permanent hole in the sequence for every
 *     rejected attempt, which is the exact shape an agency reads as a
 *     missing week.
 */
async function issueCertifiedPayrollNumber(tx: Prisma.TransactionClient, jobId: string) {
  const counter = await tx.certifiedPayrollFilingCounter.upsert({
    where: { jobId },
    create: { jobId, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
    select: { lastNumber: true },
  });
  return counter.lastNumber;
}

/**
 * Records one signed Statement of Compliance for one job-week, and issues
 * that week its payroll number.
 *
 * THERE IS NO UPDATE ACTION IN THIS MODULE, AND THERE IS NO DELETE, and
 * the absence is the design rather than unfinished work.
 *
 * `jobId`, `weekEnding` and `payrollNumber` are the identity of a filing —
 * they are what an agency holds a copy of. Editing any of them turns this
 * into a different filing while keeping its signature, which is the one
 * thing the record exists to make impossible. The schema deliberately
 * carries no trigger enforcing that (#194 removed one from `TimeEntry`: a
 * trigger is invisible from the code, fires on migrations and backfills,
 * and cannot return the `{ ok: false, error }` a form renders), so THE
 * LOCK IS THE ABSENCE OF A WRITE PATH. `certifiedPayroll.test.ts` scans
 * this file for any `update`/`upsert`/`delete` against the filing table
 * and fails if one appears.
 *
 * The obvious softening — "allow editing just `exceptions` and `isFinal`,
 * they are only details" — was considered and rejected. There is no
 * detail on a statement of compliance. 4(c) exceptions name the workers
 * the 4(a)/4(b) answer does not cover; `isFinal` asserts to the agency
 * that no further payroll is coming on this contract. Both are substantive
 * claims made under penalty of perjury, and an app that lets one be
 * quietly rewritten afterwards is asserting that the new text is what was
 * sworn to. That is precisely the overwrite `@@unique([jobId, weekEnding])`
 * exists to prevent, arriving through a side door.
 *
 * THE COST OF THAT, STATED PLAINLY: a filing signed with the wrong fringe
 * method or a mistyped exception list is permanent, and the unique
 * constraint means the week cannot be filed again to correct it. That is a
 * real hole and it is not acceptable forever — the fix is the AMENDMENT
 * flow the schema comment describes (a supersedes pointer, a revision
 * number, both filings preserved), which is additive to this shape rather
 * than a correction of it. Until it exists, the form warns before
 * submitting rather than the action forgiving afterwards.
 */
export async function recordStatementOfCompliance(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  const { company, ...user } = context;
  return runAction(async () => {
    if (!can(context, "MANAGE_COMPLIANCE")) return fail(COMPLIANCE_ONLY);

    const jobId = required(formData, "jobId", "Job");
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job || job.companyId !== company.id) return fail("Job not found");

    // The form posts the week's SUNDAY — the same `?weekStart=` value the
    // WH-347 page is already keyed by — and the Saturday is DERIVED here
    // from the same pure function that lays out the grid's seven columns.
    //
    // Not taken from the form. `weekEnding` is half the identity of a
    // filing and the join key the page reads back by; a client-supplied
    // Saturday that was off by a day would file a week whose grid shows
    // different hours, and nothing downstream could notice. Deriving it
    // means the stored week and the printed week cannot disagree, because
    // they are the same computation.
    const weekStart = requiredEnteredDate(formData, "weekStart", "Payroll week");
    const weekEnding = certifiedPayrollWeekWindow(weekStart).lte;

    // ENTERED, NOT STAMPED. This is the date the person signed the paper,
    // and it comes off the form.
    //
    // `new Date()` here would assert that cstream watched the signing
    // happen. A statement signed on Friday and entered on Monday would be
    // recorded as signed Monday — a false statement about the date of a
    // sworn document, produced by the app rather than by the signer. The
    // same call `ContractDocument.executedSignedDate` makes, and the same
    // call the RFI and submittal sent-dates make for weaker reasons.
    // `createdAt` is the stamped audit companion, defaulted in the schema;
    // keeping both is what makes a backdated filing visible.
    const signedDate = requiredEnteredDate(formData, "signedDate", "Signature date");

    // A payroll cannot be sworn to before the week it covers has ended:
    // those hours had not been worked yet. Equality is fine — signing on
    // the Saturday itself is ordinary.
    if (signedDate < weekEnding) {
      return fail(
        "The signature date is before the payroll week ended. A statement of compliance covers hours that have already been worked.",
      );
    }
    // Deliberately NO upper bound. "Not in the future" sounds obviously
    // right and is wrong here: the user's calendar date is ahead of the
    // server's UTC date for anyone east of Greenwich, so a signer in
    // Auckland entering today's date would be refused for entering
    // tomorrow. `components/localToday.ts` carries the same reasoning
    // from the other direction.

    const fringeMethod = fringeMethodFrom(formData);

    // Null means the signer claimed NO 4(c) exceptions, which is itself
    // part of what they swore to. It never means "not filled in yet" — a
    // row only exists once somebody signed.
    const exceptions = text(formData, "exceptions") || null;

    // The form's own "final payroll for this contract" box. Not derived
    // from job status: a job can sit at COMPLETE for months with a further
    // payroll still owed, and the agency reads this box as a statement
    // that none is coming.
    const isFinal = text(formData, "isFinal") === "on";

    // The signer is the signed-in user, and cannot be chosen.
    //
    // A clerk entering a form the owner signed would rather attribute it
    // to the owner, and that is exactly what must not be possible: the
    // schema has no `createdByUserId`, so allowing a third-party
    // attribution would put one person's name on another's
    // perjury-bearing statement WITH NO RECORD OF WHO TYPED IT. Between
    // "the person recording it signs in as themselves" and "anyone can
    // sign as anyone, untraceably", the first is the only defensible
    // shape. The form says so above the button.
    const signedByUserId = user.id;

    try {
      await prisma.$transaction(async (tx) => {
        await tx.certifiedPayrollFiling.create({
          data: {
            jobId,
            weekEnding,
            // Inside the transaction, on `tx`, evaluated as part of this
            // insert — see issueCertifiedPayrollNumber. Same construction
            // as `issueRfiNumber` in rfis.ts.
            payrollNumber: await issueCertifiedPayrollNumber(tx, jobId),
            isFinal,
            fringeMethod,
            exceptions,
            signedByUserId,
            signedDate,
          },
        });
      });
    } catch (err) {
      // `@@unique([jobId, weekEnding])`. Today this means the week has
      // already been filed and there is no amendment flow to route the
      // correction through, so the honest answer is to say so rather than
      // to 500 or, far worse, to overwrite what was actually sworn to.
      if (isUniqueConstraintError(err)) {
        return fail(
          "This week has already been filed for this job. A filed payroll is what an agency holds a copy of, so it can't be replaced — correcting one needs an amendment, which isn't built yet.",
        );
      }
      throw err;
    }

    revalidatePath(`/jobs/${jobId}/certified-payroll/wh-347`);
    revalidatePath(`/jobs/${jobId}/certified-payroll`);
    return ok;
  });
}
