"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { viewerToday } from "@/lib/viewerToday";
import {
  LIEN_DEADLINE_KINDS,
  LienDeadlineInputError,
  daysFromToday,
  lienDateFromString,
  type LienDeadlineKind,
} from "@/lib/lien-deadlines";
import { actionFail as fail, actionOk as ok, ownerRefusal, type ActionResult } from "./shared";

/**
 * Lien-rights deadlines: recording them, correcting them, and recording
 * that the notice or claim was actually served.
 *
 * THE APP NEVER COMPUTES A LEGAL DEADLINE, and nothing in this module does.
 * `dueOn` and `servedOn` are both ENTERED — the first from counsel or the
 * person's own reading of the statute, the second from the proof of
 * service or the recorder's stamp. There is no default for either and no
 * arithmetic that produces one. See packages/db/prisma/schema/liens.prisma.
 *
 * MANAGE_BILLING, matching `/lien-deadlines`: a lien is about getting paid,
 * and the people who chase money are the people who hold this. Asserted
 * here as well as on the page, because a Server Action is its own endpoint
 * and answers whoever posts to it (lib/action-capability-guards.test.ts).
 *
 * Every action RETURNS its failure. Production redacts a thrown Server
 * Action message, and "that date is not valid" is the sentence a person
 * needs most on a form whose whole value is a date.
 *
 * NO UNIQUE KEY, so no `isUniqueConstraintError` branch: one job can carry
 * several preliminary notices due on the same day — owner, GC and lender
 * are each served — and a key that refused the second would be wrong. The
 * double-submit is stopped by the disabled button, as on every create form.
 */

const NO_PERMISSION =
  "Lien deadlines are part of billing, which isn't part of your job function. The account owner sets who sees what, on the Team page.";

const NOT_FOUND = "That lien deadline is no longer on your account.";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function kindFromForm(formData: FormData): LienDeadlineKind | null {
  const raw = text(formData, "kind");
  return (LIEN_DEADLINE_KINDS as readonly string[]).includes(raw) ? (raw as LienDeadlineKind) : null;
}

/** Parses an entered date, turning the input error into a sentence. */
function enteredDate(formData: FormData, key: string, what: string): Date | string {
  try {
    return lienDateFromString(formData.get(key), what);
  } catch (err) {
    if (err instanceof LienDeadlineInputError) return err.message;
    throw err;
  }
}

function revalidate() {
  revalidatePath("/lien-deadlines");
}

export async function createLienDeadline(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_BILLING")) return fail(NO_PERMISSION);
  const companyId = context.company.id;

  const jobId = text(formData, "jobId");
  if (!jobId) return fail("Pick a job.");
  const kind = kindFromForm(formData);
  if (!kind) return fail("Pick which notice or claim this is.");
  const otherLabel = kind === "OTHER" ? text(formData, "otherLabel") : "";
  if (kind === "OTHER" && !otherLabel) return fail("Say what this deadline is for.");

  // ENTERED, with no fallback. An empty date is refused rather than
  // defaulted, because a deadline the app chose is the one thing it must
  // never hold.
  const dueOn = enteredDate(formData, "dueOn", "The deadline");
  if (typeof dueOn === "string") return fail(dueOn);

  // Re-read through THIS company: a forged id finds no row and is refused
  // in the same words as a typo, with no "belongs to someone else" branch.
  const job = await prisma.job.findFirst({ where: { id: jobId, companyId }, select: { id: true } });
  if (!job) return fail("That job is not on your account.");

  await prisma.lienDeadline.create({
    data: {
      companyId,
      jobId: job.id,
      kind,
      otherLabel: otherLabel || null,
      dueOn,
      recipient: text(formData, "recipient") || null,
      note: text(formData, "note") || null,
      createdByUserId: context.id,
    },
  });

  revalidate();
  return ok;
}

/**
 * Corrects a deadline that has not been served yet — counsel revised the
 * date, the recipient was wrong.
 *
 * Job and kind are NOT editable: they are what the row IS, the way an
 * RFI's job and number are. And a SERVED row is not editable at all, for
 * the evidence-record rule: once a notice has gone out, the date it was
 * due and who it went to are what somebody will be asked to prove.
 */
export async function updateLienDeadline(id: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_BILLING")) return fail(NO_PERMISSION);
  const companyId = context.company.id;

  const dueOn = enteredDate(formData, "dueOn", "The deadline");
  if (typeof dueOn === "string") return fail(dueOn);

  const existing = await prisma.lienDeadline.findFirst({
    where: { id, companyId },
    select: { id: true, kind: true, servedOn: true },
  });
  if (!existing) return fail(NOT_FOUND);
  if (existing.servedOn) {
    return fail("This one has been served, so its details are the record of what went out and are not edited.");
  }

  const otherLabel = existing.kind === "OTHER" ? text(formData, "otherLabel") : "";
  if (existing.kind === "OTHER" && !otherLabel) return fail("Say what this deadline is for.");

  // The unserved check is REPEATED in the write's own WHERE. The read above
  // is only for the kind and a friendly refusal; a mark-served landing
  // between it and this line would otherwise be edited over — rewriting the
  // deadline and recipient of a notice that has already gone out. Same
  // shape as mark-served and delete.
  const updated = await prisma.lienDeadline.updateMany({
    where: { id: existing.id, companyId, servedOn: null },
    data: {
      otherLabel: otherLabel || null,
      dueOn,
      recipient: text(formData, "recipient") || null,
      note: text(formData, "note") || null,
    },
  });
  if (updated.count === 0) {
    return fail("This one was just marked served, so its details are the record of what went out and are not edited. Reload to see it.");
  }

  revalidate();
  return ok;
}

/**
 * Records that the notice or claim was served or recorded, on the date the
 * person ENTERS — the date on the proof of service, not the day somebody
 * clicked. A served date after the deadline is accepted and kept: it is a
 * fact, and whether late service still preserves the right is for counsel.
 *
 * A date after the VIEWER's today is refused, with no slack. A typo here
 * would show an unserved notice as served and take it off the due list —
 * the most expensive wrong answer this screen could give.
 *
 * It used to compare against serverToday (UTC) with a day of slack "for a
 * person west of UTC". That was backwards: a US user's own date is the same
 * as UTC's or BEHIND it, never ahead, so the slack never helped anyone
 * here — it only let a notice be marked served a day before it went out
 * (two, on a Pacific evening, when UTC is already on tomorrow). viewerToday
 * reads the person's own calendar from the timezone cookie, so a user ahead
 * of UTC is not refused their own today either.
 */
export async function markLienDeadlineServed(id: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_BILLING")) return fail(NO_PERMISSION);
  const companyId = context.company.id;

  const servedOn = enteredDate(formData, "servedOn", "The date it was served");
  if (typeof servedOn === "string") return fail(servedOn);
  if (daysFromToday(servedOn.toISOString().slice(0, 10), await viewerToday()) > 0) {
    return fail("That date is in the future. Enter the date on the proof of service.");
  }

  // Scoped in the WHERE, and only an UNSERVED row matches: marking a served
  // row again would silently overwrite the date that proves it.
  const updated = await prisma.lienDeadline.updateMany({
    where: { id, companyId, servedOn: null },
    data: { servedOn },
  });
  if (updated.count === 0) return fail("That deadline is already marked served, or is no longer on your account.");

  revalidate();
  return ok;
}

/**
 * Takes a served date back off — for a date entered against the wrong row.
 *
 * Owner-only, because it removes the one fact that says a right was
 * preserved, and doing it by accident turns a served notice back into an
 * overdue one (or, worse, the reverse on the next mis-click).
 */
export async function clearLienDeadlineServed(id: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_BILLING")) return fail(NO_PERMISSION);
  const refusal = ownerRefusal(context, "Only the account owner can take a served date back off.");
  if (refusal) return refusal;

  const updated = await prisma.lienDeadline.updateMany({
    where: { id, companyId: context.company.id, servedOn: { not: null } },
    data: { servedOn: null },
  });
  if (updated.count === 0) return fail("That deadline is not marked served, or is no longer on your account.");

  revalidate();
  return ok;
}

/**
 * Removes a deadline that was entered by mistake. Owner-only, and never a
 * SERVED one: a served notice is sent correspondence, which closes but is
 * never deleted.
 */
export async function deleteLienDeadline(id: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_BILLING")) return fail(NO_PERMISSION);
  const refusal = ownerRefusal(context, "Only the account owner can remove a lien deadline.");
  if (refusal) return refusal;

  const removed = await prisma.lienDeadline.deleteMany({
    where: { id, companyId: context.company.id, servedOn: null },
  });
  if (removed.count === 0) {
    return fail("A served notice is the record that it went out, so it is not removed. If it was never on your account, reload the page.");
  }

  revalidate();
  return ok;
}
