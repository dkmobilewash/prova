"use server";

import { revalidatePath } from "next/cache";
import { takeoffCeiling, takeoffWall } from "@/lib/takeoff";
import { redirect } from "next/navigation";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { putDocument } from "@/lib/blob";
import { Prisma, prisma } from "@prova/db";
import { draftEstimateLineItems } from "@prova/integrations";
import {
  CONTRACT_NOT_EXECUTED_REFUSAL,
  parseExecutedSignedDate,
} from "@/lib/contract-execution";
import {
  isJobStatus,
  jobStatusTransitionRefusal,
  type JobStatusValue,
} from "@/lib/job-status-transitions";
import { actionFail, actionOk, type ActionResult, assertEditableDirectly, assertJobInCompany, assertLineItemOnJob, COST_CATEGORIES, craftClassificationIdFromForm, decimalFromForm, nullableDecimalFromForm, tradeScopeFromForm } from "./shared";

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

  let resolvedContactId: string;
  if (contactId) {
    // Scoped to this company: a contact id is a client-supplied string, and
    // without the companyId check this form would attach another tenant's
    // GC — and with it that GC's terms and history — to our job.
    const existing = await prisma.contact.findFirst({
      where: { id: contactId, companyId: company.id },
      select: { id: true },
    });
    if (!existing) {
      return actionFail("That GC isn't on your account. Pick one from the list, or add a new one.");
    }
    resolvedContactId = existing.id;
  } else {
    if (!contactName) {
      return actionFail("Pick the GC this job is for, or enter a name to add a new one.");
    }
    const created = await prisma.contact.create({
      data: {
        companyId: company.id,
        name: contactName,
        email: contactEmail || null,
      },
    });
    resolvedContactId = created.id;
  }

  const job = await prisma.job.create({
    data: {
      companyId: company.id,
      contactId: resolvedContactId,
      name: jobName,
      scope: scope || null,
    },
  });

  revalidatePath("/dashboard");
  revalidatePath("/contacts");
  redirect(`/jobs/${job.id}`);
}

/**
 * Adds a line item directly to the estimate. Because contract/budget/costing
 * all read from JobLineItem, this single insert is what "building the
 * estimate" means — nothing else needs to be told about it separately.
 */
export async function addLineItem(jobId: string, formData: FormData) {
  const { company } = await requireCompanyContext();
  const job = await assertJobInCompany(jobId, company.id);
  assertEditableDirectly(job);

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
  const craftClassificationId = await craftClassificationIdFromForm(formData, company.id);

  if (!description) {
    throw new Error("Description is required");
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
      craftClassificationId,
    },
  });

  revalidatePath(`/jobs/${jobId}`);
}

/** Turns pasted scope-of-work text into draft JobLineItem rows — the
 * "draft-estimate-from-text" feature. Same gating as addLineItem (only an
 * ESTIMATE-stage job can get new lines this way): these are ordinary,
 * fully-editable line items the moment they're created, just flagged
 * aiDrafted for the UI to prompt review. Never auto-creates a contract or
 * changes job.status itself. */
export async function draftLineItemsFromScope(jobId: string, formData: FormData) {
  const { company } = await requireCompanyContext();
  const job = await assertJobInCompany(jobId, company.id);
  assertEditableDirectly(job);

  const scopeText = String(formData.get("scopeText") ?? "").trim();
  if (!scopeText) {
    throw new Error("Paste or type a scope of work to draft from");
  }

  // Ground the draft in what this company actually charges, rather than what
  // the market roughly charges. Both halves already existed and neither was
  // ever read at draft time: the catalog is its own priced work, and won
  // bids are the prices that have actually cleared with a GC.
  const [catalogEntries, wonBids] = await Promise.all([
    prisma.lineItemCatalogEntry.findMany({
      where: { companyId: company.id },
      orderBy: { description: "asc" },
      select: { id: true, description: true, unit: true, defaultUnitPrice: true, tradeScope: true },
    }),
    prisma.bidInvitation.findMany({
      where: { companyId: company.id, status: "WON", bidAmount: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: { projectName: true, tradeScope: true, bidAmount: true },
    }),
  ]);

  const draftLineItems = await draftEstimateLineItems(scopeText, {
    catalogEntries: catalogEntries.map((entry) => ({
      id: entry.id,
      description: entry.description,
      unit: entry.unit,
      defaultUnitPrice: entry.defaultUnitPrice != null ? Number(entry.defaultUnitPrice) : null,
      tradeScope: entry.tradeScope,
    })),
    wonBids: wonBids.map((bid) => ({
      projectName: bid.projectName,
      tradeScope: bid.tradeScope,
      bidAmount: Number(bid.bidAmount),
    })),
  });

  // A line that matched a catalog entry is created the same way "add from
  // catalog" creates one — carrying sourceCatalogEntryId, and the entry's own
  // cost and craft defaults, not just the price Claude echoed back. Anything
  // else is created from the drafted values alone.
  const matchedEntries = await prisma.lineItemCatalogEntry.findMany({
    where: {
      id: { in: draftLineItems.map((item) => item.catalogEntryId).filter((id): id is string => !!id) },
    },
  });
  const fullEntryById = new Map(matchedEntries.map((entry) => [entry.id, entry]));

  await prisma.jobLineItem.createMany({
    data: draftLineItems.map((item) => {
      const entry = item.catalogEntryId ? fullEntryById.get(item.catalogEntryId) : undefined;
      return {
        jobId,
        description: entry?.description ?? item.description,
        quantity: item.quantity.toString(),
        unit: entry?.unit ?? item.unit,
        unitPrice:
          entry?.defaultUnitPrice != null
            ? entry.defaultUnitPrice.toString()
            : item.unitPrice != null
              ? item.unitPrice.toString()
              : null,
        budgetedUnitCost: entry?.defaultBudgetedUnitCost ?? null,
        currentEstimatedUnitCost: entry?.defaultBudgetedUnitCost ?? null,
        laborHours: entry?.defaultLaborHours ?? null,
        craftClassificationId: entry?.craftClassificationId ?? null,
        tradeScope: entry?.tradeScope ?? item.tradeScope,
        sourceCatalogEntryId: entry?.id ?? null,
        priceBasis: item.priceBasis,
        aiDrafted: true,
      };
    }),
  });


  revalidatePath(`/jobs/${jobId}`);
}



/** Direct edit of a line item — only while the job is still an ESTIMATE. */
export async function updateLineItem(jobId: string, lineItemId: string, formData: FormData) {
  const { company } = await requireCompanyContext();
  const job = await assertJobInCompany(jobId, company.id);
  assertEditableDirectly(job);
  await assertLineItemOnJob(lineItemId, jobId);

  const description = String(formData.get("description") ?? "").trim();
  const unit = String(formData.get("unit") ?? "").trim();
  const quantity = decimalFromForm(formData, "quantity");
  const unitPrice = nullableDecimalFromForm(formData, "unitPrice");
  const budgetedUnitCost = nullableDecimalFromForm(formData, "budgetedUnitCost");
  const currentEstimatedUnitCost =
    nullableDecimalFromForm(formData, "currentEstimatedUnitCost") ?? budgetedUnitCost;
  const tradeScope = tradeScopeFromForm(formData);
  const laborHours = nullableDecimalFromForm(formData, "laborHours");
  const craftClassificationId = await craftClassificationIdFromForm(formData, company.id);

  if (!description) {
    throw new Error("Description is required");
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
      craftClassificationId,
    },
  });

  revalidatePath(`/jobs/${jobId}`);
}

/**
 * Re-forecasts a line item's cost — the PM's live percent-complete input,
 * separate from budgetedUnitCost (the frozen historical baseline) and from
 * unitPrice/quantity (client-facing terms, change-order-gated once
 * CONTRACTED). Not gated by job status, same reasoning as addCostEntry:
 * this is internal cost tracking, not a change to what the client agreed
 * to, and real spending/re-forecasting happens throughout the job.
 */
export async function updateLineItemForecast(jobId: string, lineItemId: string, formData: FormData) {
  const { company } = await requireCompanyContext();
  await assertJobInCompany(jobId, company.id);
  await assertLineItemOnJob(lineItemId, jobId);

  const currentEstimatedUnitCost = nullableDecimalFromForm(formData, "currentEstimatedUnitCost");
  const estimatedCostToComplete = nullableDecimalFromForm(formData, "estimatedCostToComplete");

  await prisma.jobLineItem.update({
    where: { id: lineItemId },
    data: { currentEstimatedUnitCost, estimatedCostToComplete },
  });

  revalidatePath(`/jobs/${jobId}`);
}

/** Direct removal of a line item — only while the job is still an ESTIMATE. */
export async function deleteLineItem(jobId: string, lineItemId: string) {
  const { company } = await requireCompanyContext();
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
  const { company } = await requireCompanyContext();
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

// Mirrors the limits uploadContractDocument enforces in ./billing.ts.
// Deliberately a second copy rather than a shared export: those constants
// are in the billing lane, and this whole route is meant to be revertible
// on its own without touching a line of that file.
const EXECUTED_SUBCONTRACT_MEDIA_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;
const EXECUTED_SUBCONTRACT_MAX_BYTES = 15 * 1024 * 1024;

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

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return actionFail("Attach the executed subcontract the GC sent — a PDF or a photo of it.");
  }
  if (!(EXECUTED_SUBCONTRACT_MEDIA_TYPES as readonly string[]).includes(file.type)) {
    return actionFail("Upload a PDF, PNG, JPEG, or WEBP file.");
  }
  if (file.size > EXECUTED_SUBCONTRACT_MAX_BYTES) {
    return actionFail("That file is too large (max 15MB).");
  }

  const signedDate = parseExecutedSignedDate(
    String(formData.get("executedSignedDate") ?? ""),
    new Date(),
  );
  if (!signedDate.ok) {
    return actionFail(signedDate.error);
  }

  const note = String(formData.get("note") ?? "").trim();

  const [buffer, lastVersion] = await Promise.all([
    file.arrayBuffer().then(Buffer.from),
    prisma.contractDocument.findFirst({ where: { jobId }, orderBy: { versionNumber: "desc" } }),
  ]);

  const blob = await putDocument(`contracts/${jobId}/${file.name}`, buffer, file.type);

  await prisma.contractDocument.create({
    data: {
      jobId,
      versionNumber: (lastVersion?.versionNumber ?? 0) + 1,
      fileUrl: blob.url,
      fileName: file.name,
      note: note || null,
      executedSignedDate: signedDate.value,
      uploadedByUserId: context.id,
    },
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
 */
export async function addCostEntry(jobId: string, lineItemId: string, formData: FormData) {
  const { company } = await requireCompanyContext();
  await assertJobInCompany(jobId, company.id);
  await assertLineItemOnJob(lineItemId, jobId);

  const description = String(formData.get("description") ?? "").trim();
  const amount = decimalFromForm(formData, "amount");
  const categoryRaw = String(formData.get("category") ?? "OTHER");
  const category = COST_CATEGORIES.includes(categoryRaw as (typeof COST_CATEGORIES)[number])
    ? (categoryRaw as (typeof COST_CATEGORIES)[number])
    : "OTHER";
  const tradeScope = tradeScopeFromForm(formData);

  if (!description) {
    throw new Error("Description is required");
  }

  await prisma.costEntry.create({
    data: { lineItemId, description, amount, category, tradeScope },
  });

  revalidatePath(`/jobs/${jobId}`);
}

/** Removes a mistaken cost entry. */
export async function deleteCostEntry(jobId: string, costEntryId: string) {
  const { company } = await requireCompanyContext();
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

/** Sets a job's scheduled start/end dates. Either or both may be cleared. */
export async function updateJobSchedule(jobId: string, formData: FormData) {
  const { company } = await requireCompanyContext();
  await assertJobInCompany(jobId, company.id);

  const startRaw = String(formData.get("startDate") ?? "").trim();
  const endRaw = String(formData.get("endDate") ?? "").trim();
  const startDate = startRaw ? new Date(startRaw) : null;
  const endDate = endRaw ? new Date(endRaw) : null;

  if (startDate && endDate && endDate < startDate) {
    throw new Error("End date can't be before the start date");
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
  const { company } = await requireCompanyContext();
  await assertJobInCompany(jobId, company.id);

  const userId = String(formData.get("userId") ?? "");
  const member = await prisma.user.findUnique({ where: { id: userId } });
  if (!member || member.companyId !== company.id) {
    throw new Error("Team member not found");
  }

  try {
    await prisma.jobAssignment.create({ data: { jobId, userId } });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) {
      throw error;
    }
    // Already assigned — treat as a no-op rather than an error.
  }

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/schedule");
}

/** Removes a teammate from a job's crew. */
export async function unassignCrewMember(jobId: string, userId: string) {
  const { company } = await requireCompanyContext();
  await assertJobInCompany(jobId, company.id);

  await prisma.jobAssignment.deleteMany({ where: { jobId, userId } });

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/schedule");
}

/**
 * Creates line items from a measured takeoff.
 *
 * THE QUANTITIES ARE RECOMPUTED HERE, from the dimensions, and never taken
 * from the form. The screen shows a live preview so an estimator can see the
 * numbers before committing them — that preview runs the same pure functions
 * in the browser — but a quantity posted from a client is a number a client
 * chose. These end up in a bid; the arithmetic happens on this side.
 *
 * Lines are created UNPRICED. A takeoff produces quantities, not prices, and
 * filling in a unit price nobody entered is the guess this codebase refuses
 * everywhere else — the estimator prices them, or pulls a price across from
 * the catalog. They are ordinary line items from the moment they exist.
 *
 * Gated by assertEditableDirectly like every other way of adding a line, so
 * a contracted job still only changes through a change order.
 */
export async function addTakeoffLineItems(
  jobId: string,
  formData: FormData,
): Promise<ActionResult> {
  const { company } = await requireCompanyContext();
  const job = await assertJobInCompany(jobId, company.id);
  assertEditableDirectly(job);

  const surface = String(formData.get("surface") ?? "wall");
  const num = (key: string): number => {
    const raw = Number(String(formData.get(key) ?? ""));
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  };

  const options = {
    wastePercent: Number.isFinite(Number(formData.get("wastePercent")))
      ? Number(formData.get("wastePercent"))
      : undefined,
    spacingFt: num("spacingIn") > 0 ? num("spacingIn") / 12 : undefined,
  };

  // Openings arrive as parallel arrays from repeated inputs. A pair with
  // either side missing is dropped rather than treated as zero: a half-typed
  // opening is an unfinished thought, and deducting it as 0 x height would
  // silently do nothing while looking like it counted.
  const widths = formData.getAll("openingWidth").map((v) => Number(v));
  const heights = formData.getAll("openingHeight").map((v) => Number(v));
  const openings = widths
    .map((widthFt, i) => ({ widthFt, heightFt: heights[i] }))
    .filter((o) => Number.isFinite(o.widthFt) && Number.isFinite(o.heightFt) && o.widthFt > 0 && o.heightFt > 0);

  const label = String(formData.get("label") ?? "").trim();
  const lines =
    surface === "ceiling"
      ? takeoffCeiling({ lengthFt: num("lengthFt"), widthFt: num("widthFt") }, options)
      : takeoffWall(
          {
            lengthFt: num("lengthFt"),
            heightFt: num("heightFt"),
            sides: String(formData.get("sides")) === "1" ? 1 : 2,
            openings,
          },
          options,
        );

  const usable = lines.filter((line) => line.quantity > 0);
  if (usable.length === 0) {
    // RETURNED, not thrown. A production build redacts a thrown Server Action
    // message to a digest, so throwing here would put "an error occurred" on
    // screen for a person who simply left a field blank. The submit button is
    // disabled in this state, but that is a client-side attribute and a form
    // that hides a control is not a rule.
    return actionFail("Those dimensions produce no quantities — check the measurements.");
  }

  await prisma.$transaction(
    usable.map((line) =>
      prisma.jobLineItem.create({
        data: {
          jobId,
          // The label names WHERE it was measured. Without it a bid with four
          // takeoffs on it has four lines called "Drywall sheets" and no way
          // to tell which wall any of them came from.
          description: label ? `${label} — ${line.label}` : line.label,
          unit: line.unit,
          quantity: line.quantity,
        },
      }),
    ),
  );

  revalidatePath(`/jobs/${jobId}`);
  return actionOk;
}
