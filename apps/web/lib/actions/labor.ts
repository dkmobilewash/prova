"use server";

import { revalidatePath } from "next/cache";
import { putDocument } from "@/lib/blob";
import { requireCompanyContext } from "@/lib/auth";
import { prisma } from "@prova/db";
import {
  actionFail,
  actionOk,
  assertJobInCompany,
  assertLineItemOnJob,
  craftClassificationIdFromForm,
  joinWithConjunction,
  type ActionResult,
} from "./shared";
import {
  parseTimeEntryFigures,
  submittedLockedFieldChanges,
  timeEntryCorrectionUpdateData,
} from "@/lib/time-entry-correction";

/**
 * Every page that reads a job's hours.
 *
 * Three routes render TimeEntry rows — the job page, the certified payroll
 * report and the WH-347 — and until #63 all three write paths revalidated
 * only the first. A corrected hour that still reads 10 on the payroll report
 * is the same defect as one that still reads 10 on the job page, and it is
 * the report somebody sends to a GC.
 */
function revalidateJobLabor(jobId: string) {
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/certified-payroll`);
  revalidatePath(`/jobs/${jobId}/certified-payroll/wh-347`);
}

/** Logs a day's hours for one employee against a job — optionally tied to
 * a specific line item (cost code/SOV line) and craft classification. See
 * TimeEntry in schema.prisma for why pay types are separate rows rather
 * than one row with a rate multiplier.
 *
 * Returns an ActionResult only for the duplicate guard below — everything
 * else here still throws, matching this function's existing style; those
 * are malformed-input cases a working form never sends, not refusals a
 * normal user needs explained to them. */
export async function logTimeEntry(jobId: string, formData: FormData): Promise<ActionResult> {
  const { company } = await requireCompanyContext();
  await assertJobInCompany(jobId, company.id);

  const employeeUserId = String(formData.get("employeeUserId") ?? "");
  const employee = await prisma.user.findUnique({ where: { id: employeeUserId } });
  if (!employee || employee.companyId !== company.id) {
    throw new Error("Employee not found");
  }

  const lineItemIdRaw = String(formData.get("lineItemId") ?? "").trim();
  const lineItemId = lineItemIdRaw ? (await assertLineItemOnJob(lineItemIdRaw, jobId)).id : null;

  const craftClassificationId = await craftClassificationIdFromForm(formData, company.id);

  const dateRaw = String(formData.get("date") ?? "").trim();
  if (!dateRaw) {
    throw new Error("Date is required");
  }
  const date = new Date(dateRaw);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid date");
  }

  // Hours, pay type, note and the two allowances are parsed by the same
  // function the CORRECTION path uses (lib/time-entry-correction.ts), so the
  // create form and the edit form — which share one <TimeEntryFields> — cannot
  // validate the same field names differently.
  //
  // It returns its refusals rather than throwing them, and that is a fix
  // riding along rather than a side effect: "Hours must be a positive number"
  // used to be thrown, and production REDACTS a thrown Server Action message
  // to a digest, so a typo'd figure got an opaque failure instead of the
  // sentence written for it.
  const figures = parseTimeEntryFigures(formData);
  if (!figures.ok) {
    return actionFail(figures.error);
  }
  const { hours: hoursRaw, payType, note, perDiemAmount, travelPayAmount } = figures.value;

  // A double-click or a retried submit resubmits the exact same entry, and
  // #102's example is exactly this: 16 hours logged on a day someone
  // worked 8, which doubles the WH-347 hour, doubles that day in the
  // apprentice ratio (can flip a compliance verdict or hide a violation)
  // and doubles burdened cost. Multiple real entries for one employee on
  // one day are ordinary here (different craft codes, different cost
  // codes). #63 gave TimeEntry its first update path, and this guard is
  // unaffected by it: a correction cannot change the job, the person or the
  // day (see updateTimeEntry), and this window is 10 seconds from CREATION —
  // so it still only has to catch a create repeating an identical row, and only
  // blocks one landing in the last 10 seconds, not a second, different
  // entry made later that happens to share every field. NOT ATOMIC —
  // read-then-write, no lock — so this closes the sequential double-click
  // this issue describes, not two requests landing at the exact same
  // instant. See the longer version of this caveat on logPayment's guard
  // in lib/actions/billing.ts.
  const recentDuplicate = await prisma.timeEntry.findFirst({
    where: {
      jobId,
      employeeUserId,
      lineItemId,
      craftClassificationId,
      date,
      hours: hoursRaw,
      payType,
      createdAt: { gte: new Date(Date.now() - 10_000) },
    },
  });
  if (recentDuplicate) {
    return actionFail(
      "That looks like the same time entry submitted moments ago — check the list below before logging it again.",
    );
  }

  await prisma.timeEntry.create({
    data: {
      jobId,
      lineItemId,
      employeeUserId,
      craftClassificationId,
      date,
      hours: hoursRaw,
      payType,
      perDiemAmount,
      travelPayAmount,
      note,
    },
  });

  revalidateJobLabor(jobId);
  return actionOk;
}

/**
 * Corrects a logged hour — issue #63.
 *
 * WHY THIS IS AN UPDATE AND NOT A DELETE-AND-RECREATE. Until this function
 * there was no update path to TimeEntry at all, and the only way to fix "10
 * hours" that should have been "8" was to destroy the row. On a
 * prevailing-wage job that row is the record of what a person was paid and
 * for what, so the correction path destroyed the evidence it was correcting
 * — and it took one unguarded click to do it.
 *
 * WHAT IT MAY CHANGE, and where that decision lives: the figures only.
 * `lib/time-entry-correction.ts` holds the list and the argument for it; the
 * short version is that the job, the person, the day worked and the crew
 * member are what a WH-347 line IS, so changing one of those makes a
 * different record rather than a corrected one. Three things stop it, and
 * only the last of them is enforcement:
 *
 *   1. the form does not render those fields at all;
 *   2. this function refuses a request that sends a different value for one,
 *      with a sentence rather than a redacted throw — see below;
 *   3. `prova_time_entry_identity_lock`, a BEFORE UPDATE trigger installed by
 *      20260913120000_add_time_entry_correction, RAISES on one. That is the
 *      rule; 1 and 2 are the manners.
 *
 * It records who corrected it and when. It does not record what the figure
 * used to be — see the columns' own comment in labor.prisma for why the
 * amendment row the issue suggests is a follow-up and not something smuggled
 * in here.
 */
export async function updateTimeEntry(timeEntryId: string, formData: FormData): Promise<ActionResult> {
  const { company, ...user } = await requireCompanyContext();

  const timeEntry = await prisma.timeEntry.findUnique({ where: { id: timeEntryId } });
  if (!timeEntry) {
    // Returned rather than thrown: the ordinary way to reach this is two
    // tabs, or somebody deleting the entry while you had the form open.
    return actionFail("That time entry is gone — somebody removed it. Reload the page before entering it again.");
  }
  // Throws, and should: a request naming another company's entry is not a
  // user with a question, and every other action in this file guards
  // tenancy the same way.
  await assertJobInCompany(timeEntry.jobId, company.id);

  const lockedChanges = submittedLockedFieldChanges(formData, timeEntry);
  if (lockedChanges.length > 0) {
    return actionFail(
      `A correction can't change ${joinWithConjunction(lockedChanges)} on a logged hour — that would make it a ` +
        "different record. Remove this entry and log the right one instead.",
    );
  }

  const figures = parseTimeEntryFigures(formData);
  if (!figures.ok) {
    return actionFail(figures.error);
  }

  // Both re-checked against this job and this company on every save. A form
  // value is not a permission, and an edit can retarget either of them.
  const lineItemId = figures.value.lineItemId
    ? (await assertLineItemOnJob(figures.value.lineItemId, timeEntry.jobId)).id
    : null;
  const craftClassificationId = await craftClassificationIdFromForm(formData, company.id);

  await prisma.timeEntry.update({
    where: { id: timeEntry.id },
    data: timeEntryCorrectionUpdateData(
      { ...figures.value, lineItemId, craftClassificationId },
      user.id,
      new Date(),
    ),
  });

  revalidateJobLabor(timeEntry.jobId);
  return actionOk;
}

const DISPATCH_SLIP_MEDIA_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"] as const;

const DISPATCH_SLIP_MAX_BYTES = 15 * 1024 * 1024;

/** Records a union hiring hall's dispatch of one worker to this job. The
 * scanned slip is optional — some halls dispatch by phone with just a
 * referral number, no document to attach. */
export async function uploadDispatchSlip(jobId: string, formData: FormData) {
  const { company } = await requireCompanyContext();
  await assertJobInCompany(jobId, company.id);

  const employeeUserId = String(formData.get("employeeUserId") ?? "");
  const employee = await prisma.user.findUnique({ where: { id: employeeUserId } });
  if (!employee || employee.companyId !== company.id) {
    throw new Error("Employee not found");
  }

  const craftClassificationId = await craftClassificationIdFromForm(formData, company.id);

  const dispatchDateRaw = String(formData.get("dispatchDate") ?? "").trim();
  if (!dispatchDateRaw) {
    throw new Error("Dispatch date is required");
  }
  const dispatchDate = new Date(dispatchDateRaw);
  if (Number.isNaN(dispatchDate.getTime())) {
    throw new Error("Invalid dispatch date");
  }

  const dispatchNumber = String(formData.get("dispatchNumber") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();

  const file = formData.get("file");
  let fileUrl: string | null = null;
  let fileName: string | null = null;
  if (file instanceof File && file.size > 0) {
    if (!(DISPATCH_SLIP_MEDIA_TYPES as readonly string[]).includes(file.type)) {
      throw new Error("Upload a PDF, PNG, JPEG, or WEBP file");
    }
    if (file.size > DISPATCH_SLIP_MAX_BYTES) {
      throw new Error("File is too large (max 15MB)");
    }
    const buffer = await file.arrayBuffer().then(Buffer.from);
    const blob = await putDocument(`dispatch-slips/${jobId}/${file.name}`, buffer, file.type);
    fileUrl = blob.url;
    fileName = file.name;
  }

  await prisma.dispatchSlip.create({
    data: {
      jobId,
      employeeUserId,
      craftClassificationId,
      dispatchDate,
      dispatchNumber: dispatchNumber || null,
      fileUrl,
      fileName,
      note: note || null,
    },
  });

  revalidatePath(`/jobs/${jobId}`);
}

export async function deleteDispatchSlip(jobId: string, dispatchSlipId: string) {
  const { company } = await requireCompanyContext();
  await assertJobInCompany(jobId, company.id);

  const slip = await prisma.dispatchSlip.findUnique({ where: { id: dispatchSlipId } });
  if (!slip || slip.jobId !== jobId) {
    throw new Error("Dispatch slip not found on this job");
  }

  await prisma.dispatchSlip.delete({ where: { id: dispatchSlipId } });

  revalidatePath(`/jobs/${jobId}`);
}

export async function deleteTimeEntry(jobId: string, timeEntryId: string) {
  const { company } = await requireCompanyContext();
  await assertJobInCompany(jobId, company.id);

  const timeEntry = await prisma.timeEntry.findUnique({ where: { id: timeEntryId } });
  if (!timeEntry || timeEntry.jobId !== jobId) {
    throw new Error("Time entry not found on this job");
  }

  await prisma.timeEntry.delete({ where: { id: timeEntryId } });

  revalidateJobLabor(jobId);
}

const PREVAILING_WAGE_DETERMINATION_MEDIA_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"] as const;

const PREVAILING_WAGE_DETERMINATION_MAX_BYTES = 15 * 1024 * 1024;

/** Attaches a government wage-determination document (or a link to one)
 * for a job's jurisdiction. This is attached storage, not a lookup --
 * there's no licensed prevailing-wage dataset in this app to query. */
export async function uploadPrevailingWageDetermination(
  jobId: string,
  formData: FormData,
): Promise<ActionResult> {
  const { company, ...user } = await requireCompanyContext();
  await assertJobInCompany(jobId, company.id);

  const jurisdiction = String(formData.get("jurisdiction") ?? "").trim();
  if (!jurisdiction) {
    return actionFail("Name the jurisdiction this determination came from.");
  }

  const sourceUrl = String(formData.get("sourceUrl") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();

  const file = formData.get("file");
  let fileUrl: string | null = null;
  let fileName: string | null = null;
  if (file instanceof File && file.size > 0) {
    if (!(PREVAILING_WAGE_DETERMINATION_MEDIA_TYPES as readonly string[]).includes(file.type)) {
      return actionFail("That file type isn't supported — upload a PDF, PNG, JPEG, or WEBP.");
    }
    if (file.size > PREVAILING_WAGE_DETERMINATION_MAX_BYTES) {
      return actionFail("That file is over the 15MB limit. Link to it instead, or upload a smaller scan.");
    }
    const buffer = await file.arrayBuffer().then(Buffer.from);
    const blob = await putDocument(`prevailing-wage/${jobId}/${file.name}`, buffer, file.type);
    fileUrl = blob.url;
    fileName = file.name;
  }

  // Both inputs are labelled optional because EITHER satisfies this -- but
  // one of them is required, and that rule lives nowhere the browser can
  // enforce. It used to `throw`, which production redacts to a digest, so
  // submitting with both empty took down the whole page through the error
  // boundary instead of saying this one sentence next to the field.
  if (!fileUrl && !sourceUrl) {
    return actionFail("Attach the determination document, or paste a link to it — either one is enough.");
  }

  await prisma.prevailingWageDetermination.create({
    data: {
      jobId,
      jurisdiction,
      fileUrl,
      fileName,
      sourceUrl: sourceUrl || null,
      note: note || null,
      uploadedByUserId: user.id,
    },
  });

  revalidatePath(`/jobs/${jobId}`);
  return actionOk;
}

export async function deletePrevailingWageDetermination(jobId: string, determinationId: string) {
  const { company } = await requireCompanyContext();
  await assertJobInCompany(jobId, company.id);

  const determination = await prisma.prevailingWageDetermination.findUnique({ where: { id: determinationId } });
  if (!determination || determination.jobId !== jobId) {
    throw new Error("Prevailing wage determination not found on this job");
  }

  await prisma.prevailingWageDetermination.delete({ where: { id: determinationId } });

  revalidatePath(`/jobs/${jobId}`);
}

// ---------------------------------------------------------------------------
// Punch lists (Cyrus's lane — WORK-SPLIT.md task 5).
//
// Built as its own page rather than a section on jobs/[id]/page.tsx, which
// WORK-SPLIT assigns to Diego and which he has been editing this week. A
// standalone page also matches how the list is actually used: a super
// walking three jobs wants everything still open, not one job at a time.
// The per-job section can be added later as a thin read of the same model.
// ---------------------------------------------------------------------------
