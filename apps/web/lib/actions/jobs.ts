"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { documentDisplayFileName, documentUrlProblem } from "@/lib/document-uploads";
import { prisma } from "@prova/db";
import { pushToUser } from "@/lib/push";
import { issueContractDocumentVersion } from "@/lib/billing/contract-document-version";
import { createEstimateJob } from "@/lib/estimating/create-job";
import { draftLinesFromScope } from "@/lib/estimating/draft-lines";
import { END_BEFORE_START } from "@/lib/estimating/job-schedule";
import {
  CONTRACT_NOT_EXECUTED_REFUSAL,
  parseExecutedSignedDate,
} from "@/lib/contract-execution";
import {
  isJobStatus,
  jobStatusTransitionRefusal,
  type JobStatusValue,
} from "@/lib/job-status-transitions";
import { asCostCategory } from "@/lib/cost-category";
import { actionFail, actionOk, InputError, runAction, type ActionResult, assertEditableDirectly, assertJobInCompany, assertLineItemOnJob, craftClassificationIdFromForm, decimalFromForm, isUniqueConstraintError, phaseCodeIdFromForm, nullableDecimalFromForm, tradeScopeFromForm } from "./shared";
import { parseNumericInput } from "@/lib/numeric-input";

/**
 * Starts a job against a GC — an EXISTING one by preference, a new one when
 * this really is the first job with them.
 *
 * This used to call `prisma.contact.create` unconditionally, off two free-
 * text fields, with no picker anywhere in the app. So three jobs for one GC
 * meant three Contact rows, and everything that reads a GC across their
 * jobs quietly read a third of the truth: payment reliability
 * (lib/gc-reliability.ts), project history, the bid pipeline, the
 * interaction log. Worst of the lot, Job.retainagePercent is pre-filled
 * from Contact.defaultRetainagePercent — and a contact minted fresh on
 * every job arrives with that null, so a GC's standing terms could never
 * reach the job they were recorded for.
 *
 * Existing duplicates are NOT touched here. Merging them is a reviewed data
 * job with real judgement in it (which row's terms win, what happens to the
 * jobs on the losing row) and doing it as a side effect of a form post is
 * how you lose a GC's payment history.
 *
 * Returns its failures rather than throwing them: production redacts a
 * thrown Server Action message to a digest, so "that GC isn't on your
 * account" would have reached the user as "An error occurred in the Server
 * Components render." On success this redirects, which never returns.
 */
export async function createJob(formData: FormData): Promise<ActionResult> {
  const { company } = await requireCompanyContext();

  const jobName = String(formData.get("jobName") ?? "").trim();
  const scope = String(formData.get("scope") ?? "").trim();
  const contactId = String(formData.get("contactId") ?? "").trim();
  const contactName = String(formData.get("contactName") ?? "").trim();
  const contactEmail = String(formData.get("contactEmail") ?? "").trim();

  if (!jobName) {
    return actionFail("Give the job a name.");
  }
  if (!contactId && !contactName) {
    return actionFail("Pick the GC this job is for, or enter a name to add a new one.");
  }

  // The body lives in lib/estimating/create-job.ts, shared with the Ask
  // command `create_estimate_job`. This action is the form's parse → core →
  // revalidate → redirect; an existing contact is asserted in-company, a
  // new name is a new contact.
  const created = await createEstimateJob(company.id, {
    jobName,
    scope,
    contact: contactId ? { id: contactId } : { name: contactName, email: contactEmail },
  });
  if (!created.ok) {
    return actionFail(created.error);
  }

  revalidatePath("/dashboard");
  revalidatePath("/contacts");
  // Used to land on `/jobs/${id}` directly — the job's full management
  // page, mid-scroll of every section a contracted job eventually grows.
  // This is the one and only caller of `createJob` (the Ask command hits
  // `createEstimateJob` above directly and builds its own confirmation
  // card), so redirecting it into the rest of the bid-creation stepper
  // instead — add work, then review — changes nothing else that reads
  // this action. The job exists in the database the moment this redirect
  // fires, so leaving the wizard here is never data loss: `/jobs/${id}`
  // still opens the same ESTIMATE-stage job directly, stepper or not.
  redirect(`/jobs/new/${created.value.jobId}/items`);
}

/**
 * Adds a line item directly to the estimate. Because contract/budget/costing
 * all read from JobLineItem, this single insert is what "building the
 * estimate" means — nothing else needs to be told about it separately.
 */
/**
 * The Estimate tab's refusal, in the house voice.
 *
 * `/jobs/[id]/estimate` and the bid wizard's pricing step
 * (`/jobs/new/[jobId]/items`) BOTH withhold their content on
 * VIEW_JOB_COSTS — a job function without it sees a job's scope and never
 * its prices. That withholding stops a reader and does nothing about the
 * endpoint: a Server Action has a stable id and answers whoever posts to
 * it. Every write below now asserts the capability its own two doors
 * already withhold on — issue #383.
 */
const JOB_COSTS_ONLY =
  "A job's costs and pricing aren't part of your job function. The account owner sets who sees what, on the Team page.";

export async function addLineItem(jobId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  const { company } = context;
  const job = await assertJobInCompany(jobId, company.id);
  assertEditableDirectly(job);

  return runAction(async () => {
    const description = String(formData.get("description") ?? "").trim();
    const unit = String(formData.get("unit") ?? "").trim();
    const quantity = decimalFromForm(formData, "quantity");
    // Nullable: a cost-only budget line (general conditions, overhead,
    // contingency) has no client-facing sale price.
    const unitPrice = nullableDecimalFromForm(formData, "unitPrice");
    const budgetedUnitCost = nullableDecimalFromForm(formData, "budgetedUnitCost");
    // currentEstimatedUnitCost defaults to budgetedUnitCost at creation (app-
    // level, not a DB default) unless the form explicitly sets a different
    // value — see the field's doc comment in schema.prisma.
    const currentEstimatedUnitCost =
      nullableDecimalFromForm(formData, "currentEstimatedUnitCost") ?? budgetedUnitCost;
    const tradeScope = tradeScopeFromForm(formData);
    const laborHours = nullableDecimalFromForm(formData, "laborHours");
    const productionRate = nullableDecimalFromForm(formData, "productionRate");
    const craftClassificationId = await craftClassificationIdFromForm(formData, company.id);
    const phaseCodeId = await phaseCodeIdFromForm(formData, company.id);

    if (!description) {
      throw new InputError("Description is required");
    }

    await prisma.jobLineItem.create({
      data: {
        jobId,
        description,
        unit: unit || null,
        quantity,
        unitPrice,
        budgetedUnitCost,
        currentEstimatedUnitCost,
        tradeScope,
        laborHours,
        productionRate,
        craftClassificationId,
        phaseCodeId,
      },
    });

    revalidatePath(`/jobs/${jobId}`);
    return actionOk;
  });
}

/** Turns pasted scope-of-work text into draft JobLineItem rows — the
 * "draft-estimate-from-text" feature. Same gating as addLineItem (only an
 * ESTIMATE-stage job can get new lines this way): these are ordinary,
 * fully-editable line items the moment they're created, just flagged
 * aiDrafted for the UI to prompt review. Never auto-creates a contract or
 * changes job.status itself. */
export async function draftLineItemsFromScope(jobId: string, formData: FormData) {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) throw new Error(JOB_COSTS_ONLY);
  const { company } = context;
  const scopeText = String(formData.get("scopeText") ?? "").trim();

  // The body lives in lib/estimating/draft-lines.ts, shared with the Ask
  // command `draft_estimate_lines`. This form's component catches a throw
  // and shows err.message, so the core's sentences are thrown here exactly
  // as the inline guards used to throw them.
  const drafted = await draftLinesFromScope(company.id, { jobId, scopeText });
  if (!drafted.ok) {
    throw new Error(drafted.error);
  }

  revalidatePath(`/jobs/${jobId}`);
}



/** Direct edit of a line item — only while the job is still an ESTIMATE. */
export async function updateLineItem(
  jobId: string,
  lineItemId: string,
  formData: FormData,
): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  const { company } = context;
  const job = await assertJobInCompany(jobId, company.id);
  assertEditableDirectly(job);
  await assertLineItemOnJob(lineItemId, jobId);

  return runAction(async () => {
    const description = String(formData.get("description") ?? "").trim();
    const unit = String(formData.get("unit") ?? "").trim();
    const quantity = decimalFromForm(formData, "quantity");
    const unitPrice = nullableDecimalFromForm(formData, "unitPrice");
    const budgetedUnitCost = nullableDecimalFromForm(formData, "budgetedUnitCost");
    const currentEstimatedUnitCost =
      nullableDecimalFromForm(formData, "currentEstimatedUnitCost") ?? budgetedUnitCost;
    const tradeScope = tradeScopeFromForm(formData);
    const laborHours = nullableDecimalFromForm(formData, "laborHours");
    const productionRate = nullableDecimalFromForm(formData, "productionRate");
    const craftClassificationId = await craftClassificationIdFromForm(formData, company.id);
    const phaseCodeId = await phaseCodeIdFromForm(formData, company.id);

    if (!description) {
      throw new InputError("Description is required");
    }

    await prisma.jobLineItem.update({
      where: { id: lineItemId },
      data: {
        description,
        unit: unit || null,
        quantity,
        unitPrice,
        budgetedUnitCost,
        currentEstimatedUnitCost,
        tradeScope,
        laborHours,
        productionRate,
        craftClassificationId,
        phaseCodeId,
      },
    });

    revalidatePath(`/jobs/${jobId}`);
    return actionOk;
  });
}

/**
 * Re-forecasts a line item's cost — the PM's live percent-complete input,
 * separate from budgetedUnitCost (the frozen historical baseline) and from
 * unitPrice/quantity (client-facing terms, change-order-gated once
 * CONTRACTED). Not gated by job status, same reasoning as addCostEntry:
 * this is internal cost tracking, not a change to what the client agreed
 * to, and real spending/re-forecasting happens throughout the job.
 */
export async function updateLineItemForecast(
  jobId: string,
  lineItemId: string,
  formData: FormData,
): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  const { company } = context;
  await assertJobInCompany(jobId, company.id);
  await assertLineItemOnJob(lineItemId, jobId);

  return runAction(async () => {
      const currentEstimatedUnitCost = nullableDecimalFromForm(formData, "currentEstimatedUnitCost", {
        label: "Current estimated unit cost",
      });
      const estimatedCostToComplete = nullableDecimalFromForm(formData, "estimatedCostToComplete", {
        label: "Estimated cost to complete",
      });

      await prisma.jobLineItem.update({
        where: { id: lineItemId },
        data: { currentEstimatedUnitCost, estimatedCostToComplete },
      });

      revalidatePath(`/jobs/${jobId}`);
      return actionOk;
  });
}

/** Direct removal of a line item — only while the job is still an ESTIMATE. */
export async function deleteLineItem(jobId: string, lineItemId: string) {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) throw new Error(JOB_COSTS_ONLY);
  const { company } = context;
  const job = await assertJobInCompany(jobId, company.id);
  assertEditableDirectly(job);
  await assertLineItemOnJob(lineItemId, jobId);

  await prisma.jobLineItem.update({
    where: { id: lineItemId },
    data: { isDeleted: true },
  });

  revalidatePath(`/jobs/${jobId}`);
}


/**
 * Locks in the estimate as a contract. From this point on, line items are
 * only editable via change orders (see assertEditableDirectly /
 * assertEditableViaChangeOrder in ./shared, applied by ./changeOrders).
 */
export async function markJobContracted(jobId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  // The button is on the Estimate tab and the step it completes is a
  // pricing one — an estimate becoming a contract at an agreed value.
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  const { company } = context;
  const job = await assertJobInCompany(jobId, company.id);

  // Returned, not thrown. All three of these are things a person can fix,
  // and production REDACTS thrown Server Action messages — so throwing
  // "Add at least one line item" reached the user as "An error occurred in
  // the Server Components render. The specific message is omitted in
  // production builds." Browser testing caught it: the sentence written to
  // tell someone what to do was replaced by a crash. The caller already
  // had a try/catch and a slot to render the message; the message just
  // never survived the trip.
  if (job.status !== "ESTIMATE") {
    return actionFail("This job is already contracted.");
  }

  const lineItemCount = await prisma.jobLineItem.count({
    where: { jobId, isDeleted: false },
  });
  if (lineItemCount === 0) {
    return actionFail("Add at least one line item before contracting this job.");
  }

  // TWO routes to an executed contract, and this is the only place that
  // decides a job is billable, so both are checked here.
  //
  // The e-signature is unchanged and untouched. The second route exists
  // because a specialty-trade sub does not issue the subcontract — the GC
  // does, signs it, and sends it back on paper or through the GC's own
  // system. Requiring the GC to sign inside Prova made every downstream
  // thing (invoices, pay applications, change orders) unreachable for the
  // ordinary case, which is not a gate, it is a wall.
  //
  // The second route carries EVIDENCE, not a checkbox: a ContractDocument
  // with the uploaded executed file, the ENTERED date the GC signed, who
  // asserted it and when — see recordExecutedSubcontract below.
  const [signedRequest, executedDocument] = await Promise.all([
    prisma.signatureRequest.findFirst({ where: { jobId, status: "SIGNED" } }),
    prisma.contractDocument.findFirst({
      where: { jobId, executedSignedDate: { not: null } },
      orderBy: { versionNumber: "asc" },
    }),
  ]);
  if (!signedRequest && !executedDocument) {
    return actionFail(CONTRACT_NOT_EXECUTED_REFUSAL);
  }

  await prisma.job.update({
    where: { id: jobId },
    data: { status: "CONTRACTED" },
  });

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/dashboard");
  return actionOk;
}

/* ------------------------------------------- the executed-subcontract route */

// THE SECOND COPY OF THE LIMITS IS GONE, and the note that used to defend
// it is worth keeping rather than deleting. It said the media-type list
// and the 15MB cap were deliberately duplicated from ./billing.ts so this
// route stayed revertible on its own. That argument held right up until
// the duplication turned out to be five copies of a number that had never
// been enforced once (#27): a Server Action body is capped at 1MB by the
// framework, multipart parts included, so nothing over that ever reached
// either copy. The rule lives in lib/document-uploads.ts now, in one
// place, and is applied by the store to the transfer itself.
//
// What did NOT move is the guard: this action still asserts MANAGE_JOBS
// and `uploadContractDocument` still asserts nothing beyond company
// membership, which is why the token route keys on the PURPOSE rather
// than on the `contracts/` folder the two of them share.

const JOBS_ONLY =
  "Managing jobs isn't part of your job function. The account owner sets who sees what, on the Team page.";

/**
 * Records a subcontract the GC issued, signed, and sent back — the second
 * route to a contracted job, alongside the e-signature.
 *
 * This is an EVIDENCE record, and everything about its shape follows from
 * that:
 *
 *  - The file is REQUIRED. A bare "yes we have a contract" checkbox would
 *    be an assertion with nothing behind it, and the whole point of a gate
 *    on billing is that somebody can go and look.
 *  - The signing date is ENTERED, never stamped. It is the GC's date — the
 *    date on the document — not the afternoon somebody got round to
 *    uploading it, and it is what lien deadlines and retainage clocks get
 *    counted from.
 *  - `createdAt` (stamped) and `uploadedByUserId` are the audit companions:
 *    when Prova was told, and who said so.
 *  - Nothing here is ever updated. ContractDocument has no update path at
 *    all — create, and an owner-only delete — so the identity of this
 *    record is locked the moment it exists. Correcting a mistyped signing
 *    date means recording it again, which leaves both versions visible,
 *    which is the correct behaviour for evidence.
 *
 * Not gated on job status: a GC sends executed amendments throughout a
 * job, not only before award — same reasoning as uploadContractDocument.
 * It does NOT change job.status either; contracting stays
 * markJobContracted's single decision, so there is exactly one job-status
 * write for becoming billable and it is the one carrying the gate.
 */
export async function recordExecutedSubcontract(
  jobId: string,
  formData: FormData,
): Promise<ActionResult> {
  const context = await requireCompanyContext();
  const { company } = context;

  if (!can(context, "MANAGE_JOBS")) {
    return actionFail(JOBS_ONLY);
  }

  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job || job.companyId !== company.id) {
    return actionFail("Job not found.");
  }

  // The browser uploaded the file to the blob store already; this is the
  // URL it got back, and it is re-checked rather than trusted — a Server
  // Action answers whoever posts to it, so it proves for itself that the
  // URL is our own store's and sits under THIS job's contracts folder.
  // `job` was proved to be this company's immediately above.
  const fileUrl = String(formData.get("fileUrl") ?? "").trim();
  if (!fileUrl) {
    return actionFail("Attach the executed subcontract the GC sent — a PDF or a photo of it.");
  }
  const fileProblem = documentUrlProblem(fileUrl, "executed-subcontract", jobId, process.env);
  if (fileProblem) {
    return actionFail(fileProblem);
  }
  // NOT NULL on ContractDocument, so it falls back rather than being
  // allowed to be absent — see the same line in uploadContractDocument.
  const fileName = documentDisplayFileName(String(formData.get("fileName") ?? "")) ?? "document";

  const signedDate = parseExecutedSignedDate(
    String(formData.get("executedSignedDate") ?? ""),
    new Date(),
  );
  if (!signedDate.ok) {
    return actionFail(signedDate.error);
  }

  const note = String(formData.get("note") ?? "").trim();

  // THE VERSION NUMBER COMES FROM THE COUNTER, in the same transaction as
  // the insert — issue #280. This read `MAX(versionNumber) + 1` off the
  // surviving rows while `uploadContractDocument` used
  // `ContractDocumentVersionCounter`, so one table had two writers with two
  // numbering schemes and the counter only ever heard from one of them.
  //
  // The cost was not a stale number, it was a permanent outage per job. A
  // document written this way left the counter behind the rows, so the next
  // ordinary upload issued a number that already existed and violated
  // @@unique([jobId, versionNumber]); the bump and the insert being one
  // transaction meant the failure rolled the bump back too, so every retry
  // failed identically for ever. On a fresh job one click did it — the GC
  // sends the subcontract signed, this records it as version 1 with no
  // counter row, and every later amendment upload on that job was dead.
  await prisma.$transaction(async (tx) => {
    await tx.contractDocument.create({
      data: {
        jobId,
        versionNumber: await issueContractDocumentVersion(tx, jobId),
        fileUrl,
        fileName,
        note: note || null,
        executedSignedDate: signedDate.value,
        uploadedByUserId: context.id,
      },
    });
  });

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/dashboard");
  return actionOk;
}

/* ----------------------------------------------- the rest of the lifecycle */

/**
 * Moves a job between CONTRACTED, IN_PROGRESS and COMPLETE.
 *
 * Before this, `markJobContracted`'s `data: { status: "CONTRACTED" }` was
 * the only job-status write in the entire app — one grep hit — so
 * IN_PROGRESS and COMPLETE were values the schema allowed and nothing
 * could ever produce. The dashboard's "In progress" group was permanently
 * empty, the crew list in lib/today-dashboard.ts filtered on a status no
 * job could hold, and Ask answered "which jobs are in progress" with
 * nothing every single time, correctly.
 *
 * MANUAL. A person says when a job starts and when it is done; nothing
 * derives it from time entries or dates. JobStatus is a stored column and
 * CLAUDE.md's rule is that derived state is never stored — deriving one of
 * four stored values would build exactly the contradiction that rule
 * exists to prevent.
 *
 * The legal moves live in lib/job-status-transitions.ts, which also owns
 * the sentence explaining a refusal. Gated on MANAGE_JOBS, the same
 * capability as the rest of job management: a Server Action is its own
 * endpoint and answers whoever posts to it, so a guarded page in front of
 * an open action is not a guard.
 */
export async function setJobStatus(jobId: string, nextStatus: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  const { company } = context;

  if (!can(context, "MANAGE_JOBS")) {
    return actionFail(JOBS_ONLY);
  }

  if (!isJobStatus(nextStatus)) {
    return actionFail("That isn't a job status.");
  }

  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job || job.companyId !== company.id) {
    return actionFail("Job not found.");
  }

  const refusal = jobStatusTransitionRefusal(job.status as JobStatusValue, nextStatus);
  if (refusal) {
    return actionFail(refusal);
  }

  await prisma.job.update({
    where: { id: jobId },
    data: { status: nextStatus },
  });

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/dashboard");
  revalidatePath("/schedule");
  return actionOk;
}

/**
 * Logs an actual expense against a line item. Not gated by job status —
 * real spending happens throughout the job, including after it's
 * contracted and in progress, unlike scope/pricing changes.
 *
 * Returns an ActionResult only for the duplicate guard below — everything
 * else here still throws, consistent with the rest of this function's
 * existing style; a thrown message is redacted in production, which is
 * fine for "description is required" but not for a refusal explaining
 * itself.
 */
export async function addCostEntry(jobId: string, lineItemId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  const { company } = context;
  await assertJobInCompany(jobId, company.id);
  await assertLineItemOnJob(lineItemId, jobId);

  const description = String(formData.get("description") ?? "").trim();
  // Returned, not thrown: this action promises `ActionResult` and has no
  // `runAction` boundary of its own.
  const parsedAmount = parseNumericInput(formData.get("amount"), {
    label: "Amount",
    maxDecimals: 2,
  });
  if (!parsedAmount.ok) return actionFail(parsedAmount.error);
  const amount = parsedAmount.value;
  const categoryRaw = String(formData.get("category") ?? "OTHER");
  // `?? "OTHER"` is deliberate HERE and only here: a logged cost has already
  // been spent, so it has to land somewhere, and Other is the category that
  // says "nobody coded this". The estimate side leaves an unknown value null
  // instead, because an uncategorised estimate line is a question, not a cost.
  const category = asCostCategory(categoryRaw) ?? "OTHER";
  const tradeScope = tradeScopeFromForm(formData);

  if (!description) {
    throw new Error("Description is required");
  }

  // A double-click or a retried submit resubmits the exact same entry, and
  // a second CostEntry here moves percent complete and the over/under
  // billing figure quoted to a bonding company (#102). Two genuinely
  // distinct entries can share every visible field — two real $500
  // material buys logged the same day under the same category — so this
  // only blocks an exact repeat (same line item, description, amount,
  // category and trade) landing within the last 10 seconds, not a second,
  // deliberate entry made moments later. NOT ATOMIC — read-then-write, no
  // lock — so this closes the sequential double-click, not two requests
  // landing at the exact same instant. See the longer version of this
  // caveat on logPayment's guard in lib/actions/billing.ts.
  const recentDuplicate = await prisma.costEntry.findFirst({
    where: {
      lineItemId,
      description,
      amount,
      category,
      tradeScope,
      createdAt: { gte: new Date(Date.now() - 10_000) },
    },
  });
  if (recentDuplicate) {
    return actionFail(
      "That looks like the same cost entry submitted moments ago — check the list below before logging it again.",
    );
  }

  await prisma.costEntry.create({
    data: { lineItemId, description, amount, category, tradeScope },
  });

  revalidatePath(`/jobs/${jobId}`);
  return actionOk;
}

/** Removes a mistaken cost entry. */
export async function deleteCostEntry(jobId: string, costEntryId: string) {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) throw new Error(JOB_COSTS_ONLY);
  const { company } = context;
  await assertJobInCompany(jobId, company.id);

  const costEntry = await prisma.costEntry.findUnique({
    where: { id: costEntryId },
    include: { lineItem: true },
  });
  if (!costEntry || costEntry.lineItem.jobId !== jobId) {
    throw new Error("Cost entry not found on this job");
  }

  await prisma.costEntry.delete({ where: { id: costEntryId } });

  revalidatePath(`/jobs/${jobId}`);
}

/**
 * The Schedule section's refusal — MANAGE_JOBS, not the VIEW_JOB_COSTS the
 * rest of this file asserts, and the difference is the whole point.
 *
 * WHERE THIS CAPABILITY COMES FROM, since the page cannot supply it. The
 * Schedule section of the Overview tab has no `showsJobMoney` wrapper and
 * no wrapper of any other kind: it renders for every job function, so
 * there is nothing to read off the file. The derivation is the OTHER
 * source this feature already uses — the Ask command for the same work.
 * `reschedule_job` (lib/ask/commands/schedule.ts) declares
 * `capability: "MANAGE_JOBS"` and names `action: "updateJobSchedule"`,
 * this exact function; its own doc comment gives the reasoning, "jobs
 * themselves, per the capability's own doc comment". So the two surfaces
 * now agree instead of one of them being open — precisely what #392 did
 * for `log_payment`/`logPayment`. No new rule, no new capability name.
 *
 * WHAT IT COSTS, stated rather than discovered later: ACCOUNTING and
 * PAYROLL_COMPLIANCE are the only two functions without MANAGE_JOBS, so
 * they are the only two who lose these three controls, and neither
 * schedules work or staffs a crew. FIELD holds MANAGE_JOBS, which is the
 * half that matters — the foreman who runs the crew keeps both.
 *
 * Thrown rather than returned, matching these three functions' existing
 * contract (`throw new Error(END_BEFORE_START)` below): the Overview tab
 * posts to them as plain `<form action={…}>` server actions with nowhere
 * to render a returned sentence. Production redacts the message, so what a
 * refused person sees is the error boundary — but the schedule does not
 * move and the crew does not change, which is the property that matters
 * here. Issue #383.
 */
const JOB_MANAGEMENT_ONLY =
  "A job's schedule and crew aren't part of your job function. The account owner sets who sees what, on the Team page.";

/** Sets a job's scheduled start/end dates. Either or both may be cleared. */
export async function updateJobSchedule(jobId: string, formData: FormData) {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_JOBS")) throw new Error(JOB_MANAGEMENT_ONLY);
  const { company } = context;
  await assertJobInCompany(jobId, company.id);

  const startRaw = String(formData.get("startDate") ?? "").trim();
  const endRaw = String(formData.get("endDate") ?? "").trim();
  const startDate = startRaw ? new Date(startRaw) : null;
  const endDate = endRaw ? new Date(endRaw) : null;

  if (startDate && endDate && endDate < startDate) {
    // The sentence the Ask card gets from lib/estimating/job-schedule.ts,
    // so the page and the card refuse this in one voice.
    throw new Error(END_BEFORE_START);
  }

  const operatingLocationId = String(formData.get("operatingLocationId") ?? "").trim() || null;
  if (operatingLocationId) {
    const location = await prisma.companyLocation.findUnique({ where: { id: operatingLocationId } });
    if (!location || location.companyId !== company.id) {
      throw new Error("Location not found");
    }
  }

  await prisma.job.update({
    where: { id: jobId },
    data: { startDate, endDate, operatingLocationId },
  });

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/schedule");
}

/** Assigns a company teammate to a job's crew. */
export async function assignCrewMember(jobId: string, formData: FormData) {
  const context = await requireCompanyContext();
  // Same section as updateJobSchedule above, same capability, same
  // reasoning — see JOB_MANAGEMENT_ONLY. There is no Ask command to defer
  // to here (lib/ask/commands/estimating.ts excludes both crew actions by
  // name), so the derivation is the control standing beside it in the same
  // ungated section: staffing a job is the job record itself, written as a
  // JobAssignment on Job.
  if (!can(context, "MANAGE_JOBS")) throw new Error(JOB_MANAGEMENT_ONLY);
  const { company } = context;
  const job = await assertJobInCompany(jobId, company.id);

  const userId = String(formData.get("userId") ?? "");
  const member = await prisma.user.findUnique({ where: { id: userId } });
  if (!member || member.companyId !== company.id) {
    throw new Error("Team member not found");
  }

  let assigned = false;
  try {
    await prisma.jobAssignment.create({ data: { jobId, userId } });
    assigned = true;
  } catch (error) {
    // `isUniqueConstraintError`, NOT `instanceof
    // Prisma.PrismaClientKnownRequestError` — that instanceof is false at
    // runtime under Next's bundling, so this guard never fired and the
    // no-op below never happened: assigning an already-assigned teammate
    // rethrew a raw Prisma error and 500'd the page (#26). The logic was
    // always right; only the class test was wrong. See isUniqueConstraintError
    // in ./shared for the measurement, and inviteTeamMember in ./company.ts
    // for the sibling fix (#25) that already landed this shape.
    if (!isUniqueConstraintError(error)) {
      throw error;
    }
    // Already assigned — treat as a no-op rather than an error.
  }

  // Real-time push to the teammate, so the assignment reaches their phone
  // rather than waiting to be found on the schedule. Best-effort — a push
  // failure never blocks the assignment.
  if (assigned) {
    void pushToUser(userId, "New job assignment", `You're assigned to ${job.name}`, { jobId });
  }

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/schedule");
}

/** Removes a teammate from a job's crew. */
export async function unassignCrewMember(jobId: string, userId: string) {
  const context = await requireCompanyContext();
  // The other half of assignCrewMember, and gated with it rather than left
  // as the looser of the pair — a remove is not weaker than the add it
  // reverses.
  if (!can(context, "MANAGE_JOBS")) throw new Error(JOB_MANAGEMENT_ONLY);
  const { company } = context;
  await assertJobInCompany(jobId, company.id);

  await prisma.jobAssignment.deleteMany({ where: { jobId, userId } });

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/schedule");
}
