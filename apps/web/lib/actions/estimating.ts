"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { prisma } from "@prova/db";
import { catalogKey, parseCatalogImport, splitAgainstExisting } from "@/lib/catalog-import";
import { ActionResult, actionFail, actionOk, BID_INVITATION_STATUSES, assertEditableDirectly, assertJobInCompany, craftClassificationIdFromForm, decimalFromForm, enumFromForm, nullableMoneyFromForm, optionalEnumFromForm, tradeScopeFromForm } from "./shared";
import { catalogActuals, repriceDecision, type JobStatusForActuals } from "@/lib/catalog-actuals";

/** Local alias for the shared money parser, kept short because this file
 * calls it five times. See nullableMoneyFromForm in ./shared — it lives
 * there rather than here so a test can reach it: this module is
 * "use server" and may only export async functions. */
const moneyFromForm = nullableMoneyFromForm;

/** Logs a GC inviting this company to bid — tracked independent of Job,
 * since most invitations are declined or lost and never become one.
 *
 * Status and amount are both optional and both settable here. They used to
 * be a mandatory second pass: every invitation was born INVITED with no
 * amount, so recording a bid already submitted — or already won — meant
 * creating it and then finding it again. That skewed what /pipeline reports
 * on, since a won bid entered in one pass was invisible as a win until
 * somebody went back for it (#133). Left alone, the row still falls to the
 * schema's INVITED default with a null amount, so nothing is invented. */
export async function createBidInvitation(
  contactId: string,
  formData: FormData,
): Promise<ActionResult> {
  const { company } = await requireCompanyContext();

  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact || contact.companyId !== company.id) {
    return actionFail("That contact no longer exists.");
  }

  const projectName = String(formData.get("projectName") ?? "").trim();
  const dueDateRaw = String(formData.get("dueDate") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const tradeScope = tradeScopeFromForm(formData);

  const bidAmount = moneyFromForm(formData, "bidAmount", "Bid amount");
  if (!bidAmount.ok) return actionFail(bidAmount.error);

  if (!projectName) {
    return actionFail("Give this invitation a project name.");
  }

  let status: (typeof BID_INVITATION_STATUSES)[number] | null;
  try {
    status = optionalEnumFromForm(formData, "status", BID_INVITATION_STATUSES);
  } catch {
    return actionFail("That isn't a bid status this app recognises.");
  }

  await prisma.bidInvitation.create({
    data: {
      companyId: company.id,
      contactId,
      projectName,
      dueDate: dueDateRaw ? new Date(dueDateRaw) : null,
      notes: notes || null,
      tradeScope,
      bidAmount: bidAmount.value,
      // Omitted rather than nulled when unset, so the schema default
      // (INVITED) is what decides.
      ...(status ? { status } : {}),
    },
  });

  revalidatePath(`/contacts/${contactId}`);
  revalidatePath("/bids");
  return actionOk;
}

/** Updates a bid invitation's outcome (invited/submitted/won/lost/declined)
 * and, once known, what was actually bid — together with tradeScope this
 * is what makes the table a historical bid database, not just a log. */
export async function updateBidInvitationStatus(
  bidInvitationId: string,
  formData: FormData,
): Promise<ActionResult> {
  const { company } = await requireCompanyContext();

  const bid = await prisma.bidInvitation.findUnique({ where: { id: bidInvitationId } });
  if (!bid || bid.companyId !== company.id) {
    return actionFail("That bid invitation no longer exists.");
  }

  let status: (typeof BID_INVITATION_STATUSES)[number];
  try {
    status = enumFromForm(formData, "status", BID_INVITATION_STATUSES);
  } catch {
    return actionFail("Pick one of the bid statuses in the list.");
  }

  const bidAmount = moneyFromForm(formData, "bidAmount", "Bid amount");
  if (!bidAmount.ok) return actionFail(bidAmount.error);

  await prisma.bidInvitation.update({
    where: { id: bidInvitationId },
    data: { status, bidAmount: bidAmount.value },
  });

  revalidatePath(`/contacts/${bid.contactId}`);
  revalidatePath("/bids");
  return actionOk;
}

export async function deleteBidInvitation(bidInvitationId: string): Promise<ActionResult> {
  const { company } = await requireCompanyContext();

  const bid = await prisma.bidInvitation.findUnique({ where: { id: bidInvitationId } });
  if (!bid || bid.companyId !== company.id) {
    return actionFail("That bid invitation no longer exists.");
  }

  await prisma.bidInvitation.delete({ where: { id: bidInvitationId } });

  revalidatePath(`/contacts/${bid.contactId}`);
  revalidatePath("/bids");
  return actionOk;
}

/**
 * The catalog entry this company already has under that description, if any.
 *
 * Trimmed and case-insensitive, the same key splitAgainstExisting uses for
 * a pasted price list — so the three ways an entry can be created agree
 * about what counts as the same item. They did not: the import refused a
 * duplicate and the other two happily made one.
 *
 * Why a duplicate is worse here than untidy. Every entry accumulates its own
 * actuals from the lines priced off it, and CATALOG_MIN_SAMPLE is 2 — so two
 * copies of "5/8in Type X board" split the evidence and can each sit at one
 * costed line forever, suppressing a variance flag that the merged sample
 * would raise. Two prices for one item, and the loop that was supposed to
 * catch the wrong one goes quiet.
 */
async function duplicateCatalogEntry(companyId: string, description: string) {
  // Compared in JS against catalogKey rather than matched in the query.
  // Prisma's `mode: "insensitive"` equals lowers to ILIKE on Postgres, where
  // `%` and `_` in the description are WILDCARDS — so "TYPE_X BOARD" would
  // match entries it is not, and refuse a create that is legitimate. This is
  // the same call importCatalogEntries already makes for the whole company,
  // and a catalog is bounded by what a person types into it.
  const key = catalogKey(description);
  const entries = await prisma.lineItemCatalogEntry.findMany({
    where: { companyId },
    select: { id: true, description: true },
  });
  return entries.find((entry) => catalogKey(entry.description) === key) ?? null;
}

/** Adds a reusable line-item template, scoped to the company. Not tied to
 * any job — see LineItemCatalogEntry in schema.prisma. */
export async function createLineItemCatalogEntry(formData: FormData): Promise<ActionResult> {
  const { company } = await requireCompanyContext();

  const description = String(formData.get("description") ?? "").trim();
  const unit = String(formData.get("unit") ?? "").trim();
  const tradeScope = tradeScopeFromForm(formData);

  if (!description) {
    return actionFail("Give the entry a description.");
  }

  const price = moneyFromForm(formData, "defaultUnitPrice", "Default unit price");
  if (!price.ok) return actionFail(price.error);
  const cost = moneyFromForm(formData, "defaultBudgetedUnitCost", "Default budgeted cost");
  if (!cost.ok) return actionFail(cost.error);
  const hours = moneyFromForm(formData, "defaultLaborHours", "Default labor hours");
  if (!hours.ok) return actionFail(hours.error);

  let craftClassificationId: string | null;
  try {
    craftClassificationId = await craftClassificationIdFromForm(formData, company.id);
  } catch {
    return actionFail("That craft classification isn't one of your union agreements.");
  }

  const duplicate = await duplicateCatalogEntry(company.id, description);
  if (duplicate) {
    return actionFail(
      `"${duplicate.description}" is already in the catalog. Edit that entry instead — a second copy splits the actuals between them and can hide a bad price on both.`,
    );
  }

  await prisma.lineItemCatalogEntry.create({
    data: {
      companyId: company.id,
      description,
      unit: unit || null,
      tradeScope,
      defaultUnitPrice: price.value,
      defaultBudgetedUnitCost: cost.value,
      defaultLaborHours: hours.value,
      craftClassificationId,
    },
  });

  revalidatePath("/catalog");
  return actionOk;
}

export async function deleteLineItemCatalogEntry(catalogEntryId: string): Promise<ActionResult> {
  const { company } = await requireCompanyContext();

  const entry = await prisma.lineItemCatalogEntry.findUnique({ where: { id: catalogEntryId } });
  if (!entry || entry.companyId !== company.id) {
    // Returned, not thrown: production redacts thrown Server Action messages,
    // so a throw here would surface as an unexplained failure on the row.
    return actionFail("That catalog entry no longer exists.");
  }

  await prisma.lineItemCatalogEntry.delete({ where: { id: catalogEntryId } });

  revalidatePath("/catalog");
  return actionOk;
}

/** Turns an existing estimate line into a reusable catalog entry — the way
 * the catalog actually grows in practice, from real priced work, rather
 * than requiring separate manual data entry. */
export async function saveLineItemAsCatalogEntry(lineItemId: string): Promise<ActionResult> {
  const { company } = await requireCompanyContext();

  const lineItem = await prisma.jobLineItem.findUnique({
    where: { id: lineItemId },
    include: { job: true },
  });
  if (!lineItem || lineItem.job.companyId !== company.id) {
    return actionFail("That line item no longer exists.");
  }

  // The click this guard is for: the same button on the same line on two
  // different jobs, or on the same job twice, each landing a copy at
  // whatever that job happened to price it at. See duplicateCatalogEntry.
  const duplicate = await duplicateCatalogEntry(company.id, lineItem.description);
  if (duplicate) {
    return actionFail(
      `"${duplicate.description}" is already in the catalog, so this wasn't saved again. A second copy at a different price would split the actuals between the two and hide a bad price on both — update the existing entry on /catalog if this line prices it better.`,
    );
  }

  await prisma.lineItemCatalogEntry.create({
    data: {
      companyId: company.id,
      description: lineItem.description,
      unit: lineItem.unit,
      tradeScope: lineItem.tradeScope,
      defaultUnitPrice: lineItem.unitPrice,
      defaultBudgetedUnitCost: lineItem.budgetedUnitCost,
      defaultLaborHours: lineItem.laborHours,
      craftClassificationId: lineItem.craftClassificationId,
    },
  });

  revalidatePath("/catalog");
  return actionOk;
}

/** Adds a new JobLineItem pre-filled from a catalog entry, through the
 * exact same create call addLineItem uses — a catalog entry is a template
 * for that call, not a second live copy of estimate data. */
export async function addLineItemFromCatalog(jobId: string, formData: FormData) {
  const { company } = await requireCompanyContext();
  const job = await assertJobInCompany(jobId, company.id);
  assertEditableDirectly(job);

  const catalogEntryId = String(formData.get("catalogEntryId") ?? "").trim();
  const entry = await prisma.lineItemCatalogEntry.findUnique({ where: { id: catalogEntryId } });
  if (!entry || entry.companyId !== company.id) {
    throw new Error("Catalog entry not found");
  }

  const quantity = decimalFromForm(formData, "quantity");

  await prisma.jobLineItem.create({
    data: {
      jobId,
      description: entry.description,
      unit: entry.unit,
      quantity,
      unitPrice: entry.defaultUnitPrice,
      budgetedUnitCost: entry.defaultBudgetedUnitCost,
      currentEstimatedUnitCost: entry.defaultBudgetedUnitCost,
      tradeScope: entry.tradeScope,
      laborHours: entry.defaultLaborHours,
      craftClassificationId: entry.craftClassificationId,
      // Records which template this came from, so /catalog can later report
      // how work priced from it actually costed. A reference, not a live
      // link: changing the entry's defaults never touches this row.
      sourceCatalogEntryId: entry.id,
      priceBasis: "COMPANY_CATALOG",
    },
  });

  revalidatePath(`/jobs/${jobId}`);
}

/** Saves a manual checkpoint of the estimate's current line items — "what
 * did we price this at before the scope changed." A snapshot, not an
 * automatic log of every edit; only available pre-award, same gate as
 * every other direct estimate edit. */
export async function saveEstimateVersion(jobId: string, formData: FormData) {
  const { company, ...user } = await requireCompanyContext();
  const job = await assertJobInCompany(jobId, company.id);
  assertEditableDirectly(job);

  const note = String(formData.get("note") ?? "").trim();

  const [lineItems, lastVersion] = await Promise.all([
    prisma.jobLineItem.findMany({ where: { jobId, isDeleted: false }, orderBy: { sortOrder: "asc" } }),
    prisma.estimateVersion.findFirst({ where: { jobId }, orderBy: { versionNumber: "desc" } }),
  ]);

  await prisma.estimateVersion.create({
    data: {
      jobId,
      versionNumber: (lastVersion?.versionNumber ?? 0) + 1,
      note: note || null,
      snapshot: lineItems.map((item) => ({
        description: item.description,
        quantity: item.quantity.toString(),
        unit: item.unit,
        tradeScope: item.tradeScope,
        unitPrice: item.unitPrice?.toString() ?? null,
        budgetedUnitCost: item.budgetedUnitCost?.toString() ?? null,
        laborHours: item.laborHours?.toString() ?? null,
      })),
      createdByUserId: user.id,
    },
  });

  revalidatePath(`/jobs/${jobId}`);
}

/**
 * Sets a catalog entry's default cost from what work priced off it has
 * actually cost. Explicit, one click, never automatic.
 *
 * The invariant this has to respect is the one that makes the catalog safe:
 * an entry is a TEMPLATE, not a live link. This updates the template and
 * nothing else. Every JobLineItem already created from it keeps the numbers
 * it was created with — as do every EstimateVersion snapshot and every
 * Invoice drawn from them. A contractor who re-prices their catalog in
 * March must not find that a job they bid in January silently changed.
 *
 * Sale price is a separate, opt-in decision. Cost is a fact the jobs
 * measured; price is a margin call that belongs to the estimator, so
 * "our cost went up 20%" does not silently become "we now charge 20% more".
 *
 * The number written is RE-DERIVED here, never taken from the request. It
 * used to arrive in a hidden input and be checked only for being a number,
 * so the one control in the app that edits a price every future bid and
 * every AI draft reads would write whatever the browser sent — a stale tab,
 * an edited field, a replayed post. importCatalogEntries in this same file
 * already refuses exactly that, and says why. So does this now: it reloads
 * the lines, recomputes the actuals, and re-checks the flag and the sample
 * size that made the button appear in the first place.
 */
export async function updateCatalogDefaultsFromActuals(
  entryId: string,
  formData: FormData,
): Promise<ActionResult> {
  const { company, ...user } = await requireCompanyContext();
  // Checked here rather than through assertOwner, which throws: a thrown
  // message is a digest in production, and "only the owner can do this" is
  // precisely the sentence a member needs to read. Same call as
  // backcharges.ts makes, for the same reason.
  if (user.role !== "OWNER") {
    return actionFail("Only the account owner can re-price the catalog.");
  }

  const entry = await prisma.lineItemCatalogEntry.findUnique({
    where: { id: entryId },
    include: {
      jobLineItems: {
        where: { isDeleted: false },
        select: {
          quantity: true,
          costEntries: { select: { amount: true } },
          job: { select: { status: true } },
        },
      },
    },
  });
  if (!entry || entry.companyId !== company.id) {
    return actionFail("That catalog entry no longer exists.");
  }

  const actuals = catalogActuals(
    entry.jobLineItems.map((line) => ({
      quantity: Number(line.quantity),
      actualCost: line.costEntries.reduce((sum, cost) => sum + Number(cost.amount), 0),
      hasCosts: line.costEntries.length > 0,
      jobStatus: line.job.status as JobStatusForActuals,
    })),
    entry.defaultBudgetedUnitCost != null ? Number(entry.defaultBudgetedUnitCost) : null,
  );

  // The figure and the refusals are decided by repriceDecision, whose
  // arguments have nowhere for a number the browser sent to enter. The only
  // thing taken from the request is the margin checkbox.
  const decision = repriceDecision(
    actuals,
    entry.defaultUnitPrice != null ? Number(entry.defaultUnitPrice) : null,
    String(formData.get("alsoUpdatePrice") ?? "") === "on",
  );
  if (!decision.ok) return actionFail(decision.error);

  // Only ever the entry's own defaults — no JobLineItem is in scope here.
  const data: { defaultBudgetedUnitCost: string; defaultUnitPrice?: string } = {
    defaultBudgetedUnitCost: decision.defaultBudgetedUnitCost,
  };
  if (decision.defaultUnitPrice !== undefined) {
    data.defaultUnitPrice = decision.defaultUnitPrice;
  }

  await prisma.lineItemCatalogEntry.update({ where: { id: entryId }, data });

  revalidatePath("/catalog");
  return actionOk;
}

/**
 * Creates catalog entries from a pasted price list.
 *
 * The text is re-parsed here rather than trusting rows the browser sends.
 * The client parses the same text with the same function to render a
 * preview, but a preview is a courtesy — what gets written is decided from
 * the raw text on the server, so a tampered or stale payload can't put
 * numbers into the catalog that nobody saw.
 *
 * Existing entries are never overwritten and never silently duplicated.
 * Re-importing an updated price list is the normal case, and a catalog with
 * two "5/8in Type X board" rows at different prices is worse than one that
 * refused the second. Updating a price stays where it already lives: the
 * entry's own controls, and the actuals loop.
 */
export async function importCatalogEntries(formData: FormData): Promise<ActionResult> {
  const { company, ...user } = await requireCompanyContext();
  if (user.role !== "OWNER") {
    return actionFail("Only the account owner can import a price list.");
  }

  const text = String(formData.get("csv") ?? "");
  if (!text.trim()) {
    return actionFail("Paste a price list, or choose a CSV file, before importing.");
  }

  const { rows } = parseCatalogImport(text);
  if (rows.length === 0) {
    return actionFail("Nothing readable to import — check the preview for what went wrong.");
  }

  const existing = await prisma.lineItemCatalogEntry.findMany({
    where: { companyId: company.id },
    select: { description: true },
  });
  const { fresh } = splitAgainstExisting(
    rows,
    existing.map((entry) => entry.description),
  );

  if (fresh.length === 0) {
    return actionFail("Every item in that list is already in the catalog — nothing to add.");
  }

  await prisma.lineItemCatalogEntry.createMany({
    data: fresh.map((row) => ({
      companyId: company.id,
      description: row.description,
      unit: row.unit,
      defaultUnitPrice: row.unitPrice != null ? row.unitPrice.toString() : null,
      defaultBudgetedUnitCost: row.budgetedUnitCost != null ? row.budgetedUnitCost.toString() : null,
      defaultLaborHours: row.laborHours != null ? row.laborHours.toString() : null,
      tradeScope: row.tradeScope,
    })),
  });

  revalidatePath("/catalog");
  return actionOk;
}
