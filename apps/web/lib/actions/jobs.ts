"use server";

import { revalidatePath } from "next/cache";
import { takeoffCeiling, takeoffWall } from "@/lib/takeoff";
import { redirect } from "next/navigation";
import { requireCompanyContext } from "@/lib/auth";
import { Prisma, prisma } from "@prova/db";
import { draftEstimateLineItems } from "@prova/integrations";
import { actionFail, actionOk, type ActionResult, assertEditableDirectly, assertJobInCompany, assertLineItemOnJob, COST_CATEGORIES, craftClassificationIdFromForm, decimalFromForm, nullableDecimalFromForm, tradeScopeFromForm } from "./shared";

/** Creates a Job with a new Contact. This is the start of the estimate. */
export async function createJob(formData: FormData) {
  const { company } = await requireCompanyContext();

  const jobName = String(formData.get("jobName") ?? "").trim();
  const scope = String(formData.get("scope") ?? "").trim();
  const contactName = String(formData.get("contactName") ?? "").trim();
  const contactEmail = String(formData.get("contactEmail") ?? "").trim();

  if (!jobName || !contactName) {
    throw new Error("Job name and client name are required");
  }

  const contact = await prisma.contact.create({
    data: {
      companyId: company.id,
      name: contactName,
      email: contactEmail || null,
    },
  });

  const job = await prisma.job.create({
    data: {
      companyId: company.id,
      contactId: contact.id,
      name: jobName,
      scope: scope || null,
    },
  });

  revalidatePath("/dashboard");
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

  const signedRequest = await prisma.signatureRequest.findFirst({
    where: { jobId, status: "SIGNED" },
  });
  if (!signedRequest) {
    return actionFail("The client needs to sign the contract before this job can be contracted.");
  }

  await prisma.job.update({
    where: { id: jobId },
    data: { status: "CONTRACTED" },
  });

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/dashboard");
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
export async function addTakeoffLineItems(jobId: string, formData: FormData) {
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
    throw new Error("Those dimensions produce no quantities — check the measurements.");
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
}
