"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { documentDisplayFileName, documentUrlProblem } from "@/lib/document-uploads";
import { determinationFactsFromForm } from "@/lib/determination-facts";
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
import { isDayLockError, liveSignoff, lockedDayMessage } from "@/lib/timesheet-signoff";
import { parseWorkerValue } from "@/lib/worker-select";

/**
 * The Crew & time tab's refusal — MANAGE_FIELD, on five of this module's
 * seven actions. Issue #383, second pass.
 *
 * THE PAGE CANNOT SUPPLY THIS ONE EITHER, which is why #392 left the tab
 * alone. `/jobs/[id]/crew` withholds T&M tickets on MANAGE_FIELD and the
 * timesheet APPROVE control on MANAGE_COMPLIANCE — two capabilities,
 * section by section — while the two sections these five live in ("Field
 * time entries" and "Union hiring-hall dispatch") have no wrapper at all.
 * The page's own doc comment says so plainly and has always been honest
 * about it: "Ungated as a route, exactly as it was in the monolith."
 *
 * SO THE CAPABILITY COMES FROM THE ASK SIDE, the second source this
 * feature already uses. `log_time_entry` (lib/ask/commands/labor.ts)
 * declares `capability: "MANAGE_FIELD"` and imports and calls
 * `logTimeEntry` from this file directly — the same action, reached two
 * ways, previously answering to a capability on one of them and to nobody
 * on the other. That is #392's `log_payment` finding in a different
 * module. MANAGE_FIELD's own doc comment in lib/permissions.ts names
 * "time" outright. `updateTimeEntry` and `deleteTimeEntry` correct and
 * remove exactly the rows `logTimeEntry` creates, in the same section, so
 * they take the same capability — a correction is not looser than the
 * write it corrects, and hours are what certified payroll and a delay
 * claim are argued from months later.
 *
 * THE DISPATCH PAIR IS THE ONE ARGUABLE CALL, so here is the argument
 * rather than a silent choice. A hiring-hall dispatch slip is the
 * authorization to work under a local's agreement, and every other union
 * artefact in this app sits behind MANAGE_COMPLIANCE (`/union-compliance`).
 * It is MANAGE_FIELD anyway, on exactly the reasoning ROUTE_CAPABILITY
 * already records for `/certifications`: PAYROLL_COMPLIANCE holds BOTH
 * capabilities, so nobody who would own this under the compliance reading
 * loses it — while FIELD and PROJECT_MANAGER hold only MANAGE_FIELD and
 * would lose a control they use today. Closing a hole must not take
 * something from somebody who already has it. Reading the slip as
 * compliance paperwork would shut out the people who receive it.
 *
 * WHAT IT COSTS: ESTIMATOR and ACCOUNTING are the only functions without
 * MANAGE_FIELD, so they are the only two who lose these five. Neither logs
 * hours nor receives a dispatch.
 *
 * Returned or thrown per action, each matching its own existing contract —
 * the three that already return `ActionResult` return the refusal so the
 * sentence survives production's redaction of thrown Server Action
 * messages; the two whose whole contract is a throw keep throwing.
 */
const FIELD_ONLY =
  "Crew hours and dispatch aren't part of your job function. The account owner sets who sees what, on the Team page.";

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

/** Logs a day's hours for one worker against a job — optionally tied to
 * a specific line item (cost code/SOV line) and craft classification. See
 * TimeEntry in schema.prisma for why pay types are separate rows rather
 * than one row with a rate multiplier.
 *
 * A WORKER IS ONE OF TWO THINGS HERE, AND THIS FUNCTION KNEW ABOUT ONE.
 * `TimeEntry` has named either a `User` or a `CrewMember` since #292 — the
 * XOR check in that migration enforces exactly one — and the phone's API has
 * written both ever since. This did not: it read `employeeUserId` and looked
 * it up in `User`, so the ONE screen where a contractor types hours with a
 * keyboard offered only people who had completed a Clerk sign-up. A crew
 * member could have hours logged for them from a phone on site and not from
 * the office, which is where certified payroll actually gets typed up.
 *
 * `worker` carries `user:<id>` / `crew:<id>` (lib/worker-select.ts).
 * `employeeUserId` is still read when `worker` is absent, because the Ask
 * assistant's direct command posts it (lib/ask/commands/labor.ts) and
 * because a form already open in a tab should not lose an entry.
 *
 * Returns an ActionResult only for the duplicate guard below and the
 * archived-crew case — everything else here still throws, matching this
 * function's existing style; those are malformed-input cases a working form
 * never sends, not refusals a normal user needs explained to them. */
export async function logTimeEntry(jobId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_FIELD")) return actionFail(FIELD_ONLY);
  const { company } = context;
  await assertJobInCompany(jobId, company.id);

  const legacyUserId = String(formData.get("employeeUserId") ?? "").trim();
  const worker =
    parseWorkerValue(formData.get("worker") as string | null) ??
    // The old field name, which always meant a User and still does.
    (legacyUserId ? ({ kind: "user", userId: legacyUserId } as const) : null);

  let employeeUserId: string | null = null;
  let crewMemberId: string | null = null;
  if (worker?.kind === "user") {
    const employee = await prisma.user.findUnique({ where: { id: worker.userId } });
    if (!employee || employee.companyId !== company.id) {
      throw new Error("Employee not found");
    }
    employeeUserId = employee.id;
  } else if (worker?.kind === "crew") {
    const member = await prisma.crewMember.findUnique({ where: { id: worker.crewMemberId } });
    if (!member || member.companyId !== company.id) {
      throw new Error("Employee not found");
    }
    // RETURNED, not thrown: this is a state a person actually reaches — the
    // dropdown was rendered before somebody else archived them — so it needs
    // a sentence rather than production's digest.
    if (member.archivedAt) {
      return actionFail("That crew member has been archived, so hours can't be logged for them.");
    }
    crewMemberId = member.id;
  } else {
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
  //
  // BOTH identity columns are in the where clause, and leaving one out
  // would have been a real defect rather than an untidy query: for a crew
  // entry `employeeUserId` is null, and `{ employeeUserId: null }` matches
  // EVERY crew row on the job. Two different crew members logged for the
  // same 8 hours on the same cost code within ten seconds — which is
  // exactly how a foreman enters a crew sheet — would have had the second
  // one refused as a duplicate of the first.
  const recentDuplicate = await prisma.timeEntry.findFirst({
    where: {
      jobId,
      employeeUserId,
      crewMemberId,
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

  // A signed day is locked until the office reopens it (TimesheetSignoff).
  const live = await liveSignoff(jobId, date);
  if (live) {
    return actionFail(lockedDayMessage(date, live));
  }

  try {
    await prisma.timeEntry.create({
      data: {
        jobId,
        lineItemId,
        // Exactly one of these is set, and the database says so: the XOR
        // CHECK added with crewMemberId refuses a row naming both or
        // neither. The branch above is what guarantees it here.
        employeeUserId,
        crewMemberId,
        craftClassificationId,
        date,
        hours: hoursRaw,
        payType,
        perDiemAmount,
        travelPayAmount,
        note,
      },
    });
  } catch (error) {
    // Signed between the check above and the write; the day-lock trigger
    // refused it.
    if (isDayLockError(error)) return actionFail(`That day was just signed, so its hours are locked.`);
    throw error;
  }

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
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_FIELD")) return actionFail(FIELD_ONLY);
  const { company, ...user } = context;

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

  const live = await liveSignoff(timeEntry.jobId, timeEntry.date);
  if (live) {
    return actionFail(lockedDayMessage(timeEntry.date, live));
  }

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

  try {
    await prisma.timeEntry.update({
      where: { id: timeEntry.id },
      data: timeEntryCorrectionUpdateData(
        { ...figures.value, lineItemId, craftClassificationId },
        user.id,
        new Date(),
      ),
    });
  } catch (error) {
    if (isDayLockError(error)) return actionFail("That day was just signed, so its hours are locked.");
    throw error;
  }

  revalidateJobLabor(timeEntry.jobId);
  return actionOk;
}

/**
 * THE FILE NO LONGER PASSES THROUGH HERE — issue #27.
 *
 * This function used to take the scanned slip as a `File` in the
 * `FormData` and refuse anything over its own `DISPATCH_SLIP_MAX_BYTES`
 * of 15MB. That guard never once fired for the case it describes: Next
 * caps a Server Action body at 1MB, multipart file parts included, so the
 * framework rejected a real scan with an opaque error before this
 * function ran at all. The browser now uploads to the blob store directly
 * under a one-shot token (`app/api/documents/upload/route.ts`) and this
 * action records the URL — which is where the 15MB and the four accepted
 * types are now enforced, on the transfer itself rather than after it.
 *
 * `DISPATCH_SLIP_MEDIA_TYPES` and `DISPATCH_SLIP_MAX_BYTES` are gone
 * rather than kept beside a URL they can no longer be applied to: a
 * constant that nothing enforces is the shape this issue was about. Both
 * live in lib/document-uploads.ts now, once, for all five uploads.
 *
 * IT RETURNS A RESULT NOW rather than throwing, and that is not tidying.
 * Its form was a server-rendered `<form action={…}>`; it has to be a
 * client component to upload a file before submitting, and a client
 * component that renders a thrown Server Action message renders a
 * redacted digest in production. Same change, same reason, as
 * `uploadPrevailingWageDetermination` beneath it — see that function's own
 * note about a refusal the person could not read.
 *
 * Records a union hiring hall's dispatch of one worker to this job. The
 * scanned slip is optional — some halls dispatch by phone with just a
 * referral number, no document to attach.
 */
export async function uploadDispatchSlip(jobId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_FIELD")) return actionFail(FIELD_ONLY);
  const { company } = context;
  await assertJobInCompany(jobId, company.id);

  // WHO THE HALL SENT is a User OR a crew member, the same two-table choice
  // logTimeEntry makes above and for the same reason. This read only
  // `employeeUserId` and looked it up in `User`, so the people a hiring hall
  // actually dispatches — field workers with no login — could not be
  // recorded at all. `worker` carries `user:<id>` / `crew:<id>`
  // (lib/worker-select.ts); `employeeUserId` is still accepted when it is
  // absent, so a form already open in a tab from the old build still files.
  const legacyUserId = String(formData.get("employeeUserId") ?? "").trim();
  const worker =
    parseWorkerValue(formData.get("worker") as string | null) ??
    (legacyUserId ? ({ kind: "user", userId: legacyUserId } as const) : null);

  let employeeUserId: string | null = null;
  let crewMemberId: string | null = null;
  if (worker?.kind === "user") {
    const employee = await prisma.user.findUnique({ where: { id: worker.userId } });
    if (!employee || employee.companyId !== company.id) {
      return actionFail("That person isn't on your team.");
    }
    employeeUserId = employee.id;
  } else if (worker?.kind === "crew") {
    const member = await prisma.crewMember.findUnique({ where: { id: worker.crewMemberId } });
    if (!member || member.companyId !== company.id) {
      return actionFail("That person isn't on your team.");
    }
    // The dropdown was rendered before somebody archived them.
    if (member.archivedAt) {
      return actionFail("That crew member has been archived, so a dispatch can't be logged for them.");
    }
    crewMemberId = member.id;
  } else {
    return actionFail("Choose who the hall dispatched.");
  }

  const craftClassificationId = await craftClassificationIdFromForm(formData, company.id);

  const dispatchDateRaw = String(formData.get("dispatchDate") ?? "").trim();
  if (!dispatchDateRaw) {
    return actionFail("Name the date the hall dispatched this worker.");
  }
  const dispatchDate = new Date(dispatchDateRaw);
  if (Number.isNaN(dispatchDate.getTime())) {
    return actionFail("That dispatch date is not valid.");
  }

  const dispatchNumber = String(formData.get("dispatchNumber") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();

  // The browser has already finished the upload; what arrives here is the
  // URL the store returned. Re-checked rather than trusted, because a
  // Server Action is an endpoint anyone with a session can post to
  // directly and is not entitled to assume the caller went through the
  // token route: the URL must be OUR store's and must sit under THIS
  // job's dispatch-slip folder. `jobId` was proved to belong to this
  // company by `assertJobInCompany` above, so a blob under its prefix
  // cannot be another company's file.
  const submittedUrl = String(formData.get("fileUrl") ?? "").trim();
  let fileUrl: string | null = null;
  let fileName: string | null = null;
  if (submittedUrl) {
    const problem = documentUrlProblem(submittedUrl, "dispatch-slip", jobId, process.env);
    if (problem) {
      return actionFail(problem);
    }
    fileUrl = submittedUrl;
    fileName = documentDisplayFileName(String(formData.get("fileName") ?? ""));
  }

  await prisma.dispatchSlip.create({
    data: {
      jobId,
      // Exactly one is set — the branch above guarantees it and the XOR
      // CHECK "DispatchSlip_employee_or_crew" refuses a row naming both or
      // neither.
      employeeUserId,
      crewMemberId,
      craftClassificationId,
      dispatchDate,
      dispatchNumber: dispatchNumber || null,
      fileUrl,
      fileName,
      note: note || null,
    },
  });

  revalidatePath(`/jobs/${jobId}`);
  return actionOk;
}

export async function deleteDispatchSlip(jobId: string, dispatchSlipId: string) {
  const context = await requireCompanyContext();
  // Throws, matching this function's own contract below. Same capability
  // as the upload it reverses.
  if (!can(context, "MANAGE_FIELD")) throw new Error(FIELD_ONLY);
  const { company } = context;
  await assertJobInCompany(jobId, company.id);

  const slip = await prisma.dispatchSlip.findUnique({ where: { id: dispatchSlipId } });
  if (!slip || slip.jobId !== jobId) {
    throw new Error("Dispatch slip not found on this job");
  }

  await prisma.dispatchSlip.delete({ where: { id: dispatchSlipId } });

  revalidatePath(`/jobs/${jobId}`);
}

export async function deleteTimeEntry(jobId: string, timeEntryId: string) {
  const context = await requireCompanyContext();
  // Throws, matching this function's own contract below (it already throws
  // `lockedDayMessage` at a signed day). Of the three time-entry writes
  // this is the one that removes the record rather than changing it.
  if (!can(context, "MANAGE_FIELD")) throw new Error(FIELD_ONLY);
  const { company } = context;
  await assertJobInCompany(jobId, company.id);

  const timeEntry = await prisma.timeEntry.findUnique({ where: { id: timeEntryId } });
  if (!timeEntry || timeEntry.jobId !== jobId) {
    throw new Error("Time entry not found on this job");
  }
  // The row hides Remove on a signed day, so reaching this is a race with a
  // signature; the day-lock trigger would refuse the delete anyway.
  const live = await liveSignoff(jobId, timeEntry.date);
  if (live) {
    throw new Error(lockedDayMessage(timeEntry.date, live));
  }

  await prisma.timeEntry.delete({ where: { id: timeEntryId } });

  revalidateJobLabor(jobId);
}

/** Attaches a government wage-determination document (or a link to one)
 * for a job's jurisdiction. This is attached storage, not a lookup --
 * there's no licensed prevailing-wage dataset in this app to query.
 *
 * The document arrives as a URL the browser already uploaded to the blob
 * store, not as bytes — see `uploadDispatchSlip` above for the whole of
 * why (#27). Its two 15MB/media-type constants went with the change, to
 * lib/document-uploads.ts, where they are enforced on the transfer. */
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

  // Already uploaded by the browser; the URL is re-checked here against
  // our own store and this job's own folder. Returned rather than thrown,
  // like every other refusal in this function — production redacts a
  // thrown Server Action message.
  const submittedUrl = String(formData.get("fileUrl") ?? "").trim();
  let fileUrl: string | null = null;
  let fileName: string | null = null;
  if (submittedUrl) {
    const problem = documentUrlProblem(submittedUrl, "prevailing-wage", jobId, process.env);
    if (problem) {
      return actionFail(problem);
    }
    fileUrl = submittedUrl;
    fileName = documentDisplayFileName(String(formData.get("fileName") ?? ""));
  }

  // Both inputs are labelled optional because EITHER satisfies this -- but
  // one of them is required, and that rule lives nowhere the browser can
  // enforce. It used to `throw`, which production redacts to a digest, so
  // submitting with both empty took down the whole page through the error
  // boundary instead of saying this one sentence next to the field.
  if (!fileUrl && !sourceUrl) {
    return actionFail("Attach the determination document, or paste a link to it — either one is enough.");
  }

  // What the document says about itself — its number, issue and expiration
  // dates and the asterisk after the expiration — all optional, all read
  // off the document by the person attaching it. The standing line on the
  // tab is derived from these (lib/determination-standing.ts); a row
  // attached with none of them is reported as unchecked, exactly like every
  // row that predates the columns.
  const facts = determinationFactsFromForm(formData);
  if (!facts.ok) return actionFail(facts.error);

  await prisma.prevailingWageDetermination.create({
    data: {
      jobId,
      jurisdiction,
      fileUrl,
      fileName,
      sourceUrl: sourceUrl || null,
      note: note || null,
      uploadedByUserId: user.id,
      ...facts.value,
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
