"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@prova/db";
import { catalogKey, parseCatalogImport, splitAgainstExisting } from "@/lib/catalog-import";
import { ActionResult, actionFail, actionOk, InputError, runAction, BID_INVITATION_STATUSES, assertEditableDirectly, assertJobInCompany, craftClassificationIdFromForm, enumFromForm, nullableDecimalFromForm, ownerRefusal, tradeScopeFromForm } from "./shared";
import { catalogActuals, catalogSourcedLine, repriceDecision } from "@/lib/catalog-actuals";
import { quotePriceDecision } from "@/lib/catalog-quote-price";
import { bidQuoteProblem } from "@/lib/bid-levelling";
import { addendumProblem, requirementProblem } from "@/lib/bid-responsiveness";
import { optionalDateFromString } from "@/lib/bid-pursuits";
import { bidLineProblem } from "@/lib/bid-lines";
import { todayInZone } from "@/lib/viewer-timezone";
import { viewerTimeZone } from "@/lib/viewerToday";
import { loadFringeSchedulesByCraft, TIME_ENTRY_COST_SELECT } from "@/lib/fringe-schedules-query";
import { loadEmployerBurdenRates } from "@/lib/employer-burden-query";
import { addCatalogLine } from "@/lib/estimating/catalog-line";
import { createBidInvitationRecord } from "@/lib/estimating/bid-invitation";
import { issueEstimateVersionNumber } from "@/lib/estimating/estimate-version";

/** Logs a GC inviting this company to bid — tracked independent of Job,
 * since most invitations are declined or lost and never become one.
 *
 * The body is lib/estimating/bid-invitation.ts, shared with the Ask
 * command `log_bid_invitation`; this keeps its throw for the form, and
 * throws the core's own sentences, so the page and the card refuse a
 * missing name or a foreign contact in one voice. */
export async function createBidInvitation(contactId: string, formData: FormData): Promise<ActionResult> {
  const { company } = await requireCompanyContext();
  return runAction(async () => {
    const projectName = String(formData.get("projectName") ?? "").trim();
    const dueDateRaw = String(formData.get("dueDate") ?? "").trim();
    const notes = String(formData.get("notes") ?? "").trim();
    const tradeScope = tradeScopeFromForm(formData);
    const bidAmount = nullableDecimalFromForm(formData, "bidAmount");

    const result = await createBidInvitationRecord(company.id, {
      contactId,
      projectName,
      dueDate: dueDateRaw ? new Date(dueDateRaw) : null,
      notes: notes || null,
      tradeScope,
      bidAmount,
    });
    if (!result.ok) return actionFail(result.error);

    revalidatePath(`/contacts/${contactId}`);
    revalidatePath("/bids");
    return actionOk;
  });
}

/** Updates a bid invitation's outcome (invited/submitted/won/lost/declined)
 * and, once known, what was actually bid — together with tradeScope this
 * is what makes the table a historical bid database, not just a log. */
export async function updateBidInvitationStatus(
  bidInvitationId: string,
  formData: FormData,
): Promise<ActionResult> {
  const { company } = await requireCompanyContext();
  return runAction(async () => {
      const bid = await prisma.bidInvitation.findUnique({ where: { id: bidInvitationId } });
      if (!bid || bid.companyId !== company.id) {
        throw new Error("Bid invitation not found");
      }

      const status = enumFromForm(formData, "status", BID_INVITATION_STATUSES);
      const bidAmount = nullableDecimalFromForm(formData, "bidAmount");

      await prisma.bidInvitation.update({ where: { id: bidInvitationId }, data: { status, bidAmount } });

      revalidatePath(`/contacts/${bid.contactId}`);
      revalidatePath("/bids");
      return actionOk;
  });
}

export async function deleteBidInvitation(bidInvitationId: string) {
  const { company } = await requireCompanyContext();

  const bid = await prisma.bidInvitation.findUnique({ where: { id: bidInvitationId } });
  if (!bid || bid.companyId !== company.id) {
    throw new Error("Bid invitation not found");
  }

  await prisma.bidInvitation.delete({ where: { id: bidInvitationId } });

  revalidatePath(`/contacts/${bid.contactId}`);
  revalidatePath("/bids");
}

/**
 * The catalog entry this company already has under that description, if any.
 * #105 finding 7.
 *
 * Compared in JS against catalogKey rather than matched in the query:
 * Prisma's `mode: "insensitive"` lowers to Postgres ILIKE, where `%` and `_`
 * in the description are WILDCARDS — so a description containing an
 * underscore (this trade writes plenty, e.g. "5/8_ Type X") would match rows
 * it isn't, and wrongly refuse a legitimate create. A catalog is bounded by
 * what people type into it, so loading every description for the company and
 * comparing in JS costs nothing that matters.
 *
 * Why a duplicate is worse here than merely untidy: every entry accumulates
 * its own actuals from the lines priced off it, and CATALOG_MIN_SAMPLE is 2
 * — so two copies of "5/8in Type X board" split the evidence and can each
 * sit at one costed line forever, suppressing a variance flag the merged
 * sample would correctly raise.
 */
async function duplicateCatalogEntry(companyId: string, description: string) {
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
  return runAction(async () => {
    const description = String(formData.get("description") ?? "").trim();
    const unit = String(formData.get("unit") ?? "").trim();
    const tradeScope = tradeScopeFromForm(formData);
    const defaultUnitPrice = nullableDecimalFromForm(formData, "defaultUnitPrice");
    const defaultBudgetedUnitCost = nullableDecimalFromForm(formData, "defaultBudgetedUnitCost");
    const defaultLaborHours = nullableDecimalFromForm(formData, "defaultLaborHours");
    const craftClassificationId = await craftClassificationIdFromForm(formData, company.id);

    // InputError, not Error: both of these are things a person can fix, and
    // a thrown one arrives redacted. Same reason the parsers above changed.
    if (!description) {
      throw new InputError("Description is required");
    }

    const duplicate = await duplicateCatalogEntry(company.id, description);
    if (duplicate) {
      throw new InputError(
        `"${duplicate.description}" is already in the catalog. Edit that entry instead — a second copy splits its actuals history between the two and can hide a bad price on both.`,
      );
    }

    await prisma.lineItemCatalogEntry.create({
      data: {
        companyId: company.id,
        description,
        unit: unit || null,
        tradeScope,
        defaultUnitPrice,
        defaultBudgetedUnitCost,
        defaultLaborHours,
        craftClassificationId,
      },
    });

    revalidatePath("/catalog");
    return actionOk;
  });
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
/**
 * The three writes in this module that are posted from the ESTIMATE tab
 * rather than from `/catalog`, and the capability they answer to.
 *
 * VIEW_JOB_COSTS, deliberately, and not the MANAGE_ESTIMATING that
 * `/catalog`'s own actions take: both of their doors —
 * `/jobs/[id]/estimate` and `/jobs/new/[jobId]/items` — withhold on
 * VIEW_JOB_COSTS, and asserting MANAGE_ESTIMATING instead would newly
 * refuse an ACCOUNTING member who holds VIEW_JOB_COSTS and can reach
 * these controls today. Closing a hole must not take anything from
 * somebody who already has it; tightening further is a separate decision
 * with `/catalog`'s gate to reconcile, not this one. Issue #383.
 */
const JOB_COSTS_ONLY =
  "A job's costs and pricing aren't part of your job function. The account owner sets who sees what, on the Team page.";

export async function saveLineItemAsCatalogEntry(lineItemId: string) {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) throw new Error(JOB_COSTS_ONLY);
  const { company } = context;

  const lineItem = await prisma.jobLineItem.findUnique({
    where: { id: lineItemId },
    include: { job: true },
  });
  if (!lineItem || lineItem.job.companyId !== company.id) {
    throw new Error("Line item not found");
  }

  // The click this guard exists for: the same line saved from two different
  // jobs, or the same job's line saved twice, each landing a copy at
  // whatever that job happened to price it at. See duplicateCatalogEntry.
  const duplicate = await duplicateCatalogEntry(company.id, lineItem.description);
  if (duplicate) {
    throw new Error(
      `"${duplicate.description}" is already in the catalog, so this wasn't saved again. A second copy at a different price would split the actuals between the two and hide a bad price on both — update the existing entry on /catalog instead if this line prices it better.`,
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
}

/** Adds a new JobLineItem pre-filled from a catalog entry, through the
 * exact same create call addLineItem uses — a catalog entry is a template
 * for that call, not a second live copy of estimate data. */
export async function addLineItemFromCatalog(jobId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  const { company } = context;
  const catalogEntryId = String(formData.get("catalogEntryId") ?? "").trim();
  const quantity = String(formData.get("quantity") ?? "").trim();

  // The body lives in lib/estimating/catalog-line.ts, shared with the Ask
  // command `add_catalog_line`; the sentences it returns are the core's.
  const added = await addCatalogLine(company.id, { jobId, catalogEntryId, quantity });
  if (!added.ok) {
    return actionFail(added.error);
  }

  revalidatePath(`/jobs/${jobId}`);
  return actionOk;
}

/** Saves a manual checkpoint of the estimate's current line items — "what
 * did we price this at before the scope changed." A snapshot, not an
 * automatic log of every edit; only available pre-award, same gate as
 * every other direct estimate edit. */
export async function saveEstimateVersion(jobId: string, formData: FormData) {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) throw new Error(JOB_COSTS_ONLY);
  const { company, ...user } = context;
  const job = await assertJobInCompany(jobId, company.id);
  assertEditableDirectly(job);

  const note = String(formData.get("note") ?? "").trim();

  const lineItems = await prisma.jobLineItem.findMany({
    where: { jobId, isDeleted: false },
    orderBy: { sortOrder: "asc" },
  });

  // THE VERSION NUMBER COMES FROM THE COUNTER, in the same transaction as
  // the insert — issue #289. This used to read MAX(versionNumber) off the
  // surviving rows and add one, outside any transaction, which meant two
  // people saving a checkpoint on the same job at once both read the same
  // max and the second lost their save to
  // @@unique([jobId, versionNumber]) — a throw this action does not catch,
  // so a redacted digest in production and no checkpoint. 49 of 50 rounds
  // at two concurrent saves, measured. SubmitButton (#19) already stopped
  // the single-tab double-click; two tabs and two people were what got
  // through.
  //
  // The snapshot is read before the transaction deliberately: it is the
  // line items as the person sees them, and holding a transaction open
  // across that read would buy nothing — nothing here depends on the two
  // being atomic with each other, only on the bump and the insert being so.
  await prisma.$transaction(async (tx) => {
    await tx.estimateVersion.create({
      data: {
        jobId,
        versionNumber: await issueEstimateVersionNumber(tx, jobId),
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
 * #105 finding 3: the number written here is RE-DERIVED from the job line
 * items, never taken from the request. It used to arrive in a hidden input
 * and be written after being checked only for parsing as a number — on the
 * one control in the app that edits a price every future bid and every AI
 * draft reads, so a stale tab, an edited field, or a replayed POST could set
 * a catalog default to anything. `importCatalogEntries` below already
 * refuses exactly that pattern for a pasted price list; this is the same
 * discipline applied here. The only thing still taken from the request is
 * the margin checkbox — see repriceDecision in lib/catalog-actuals.ts, which
 * also re-checks the flag and the sample size that made this button appear,
 * since the page that rendered it may be minutes old.
 *
 * RETURNS ITS REFUSALS RATHER THAN THROWING THEM, as of 2026-09-21, and the
 * conversion is not cosmetic. Every refusal in here was a `throw`, which
 * production redacts to a digest, on a control reachable by somebody it
 * always refuses: `/catalog` demands MANAGE_ESTIMATING and ESTIMATOR holds
 * it, so an estimator can open the page and click this. The owner case is
 * not even the common one — `repriceDecision` refuses the OWNER on an
 * ordinary race, when the page is minutes old and a costed line has landed
 * since, and that sentence (which names the fringe schedule to add, or the
 * cost entry to recategorise) was thrown away too. `ownerRefusal` is the
 * right guard now that this declares `ActionResult`; `assertOwner` throws
 * and belongs only in the throw-style actions — see shared.ts.
 */
export async function updateCatalogDefaultsFromActuals(
  entryId: string,
  formData: FormData,
): Promise<ActionResult> {
  const { company, ...user } = await requireCompanyContext();
  const refusal = ownerRefusal(user, "Only the account owner can re-price the catalog.");
  if (refusal) return refusal;

  const [entry, fringeSchedulesByCraft, employerBurdenRates] = await Promise.all([
    prisma.lineItemCatalogEntry.findUnique({
      where: { id: entryId },
      include: {
        jobLineItems: {
          where: { isDeleted: false },
          select: {
            quantity: true,
            // `category` is load-bearing, not decoration: it is the only thing
            // that can tell a LABOR cost entry sitting beside logged hours from
            // a material one. Without it every line reads as unambiguous and
            // `hasAmbiguousLaborCost` can never fire.
            costEntries: { select: { amount: true, category: true } },
            // #287: the crew's hours are most of a self-performed line's
            // cost. Without this the figure written below is materials-only,
            // and since it can only ever be LOW, every click walks the
            // catalog nearer to zero — the same one-directional bias #105
            // finding 2 documents for unfinished jobs.
            timeEntries: { select: TIME_ENTRY_COST_SELECT },
            job: { select: { status: true } },
          },
        },
      },
    }),
    loadFringeSchedulesByCraft(company.id),
    loadEmployerBurdenRates(company.id),
  ]);
  if (!entry || entry.companyId !== company.id) {
    // Returned rather than thrown like its siblings elsewhere: this
    // function now promises a readable refusal, and half-keeping the promise
    // is how a person ends up looking at a digest for one branch and a
    // sentence for the next. Reachable by an ordinary stale tab — the entry
    // was deleted from another window.
    return actionFail("Catalog entry not found — it may have been deleted. Reload the page.");
  }

  const actuals = catalogActuals(
    entry.jobLineItems.map((line) => catalogSourcedLine(line, fringeSchedulesByCraft, employerBurdenRates)),
    entry.defaultBudgetedUnitCost != null ? Number(entry.defaultBudgetedUnitCost) : null,
  );

  const decision = repriceDecision(
    actuals,
    entry.defaultUnitPrice != null ? Number(entry.defaultUnitPrice) : null,
    String(formData.get("alsoUpdatePrice") ?? "") === "on",
  );
  if (!decision.ok) {
    // THE REFUSAL THE OWNER ACTUALLY MEETS. `repriceDecision` re-checks the
    // flag and the sample that made this button render, because the page may
    // be minutes old, and its messages are the useful ones — add a fringe
    // rate schedule for that craft and dates, recategorise the Labor cost
    // entry, the variance has closed. Every one of them was thrown, and so
    // redacted to a digest in production.
    return actionFail(decision.error);
  }

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
 * Sets a catalog entry's default COST from the cheapest live vendor quote in
 * that entry's own unit. Explicit, one click, never automatic — the same
 * shape as `updateCatalogDefaultsFromActuals` above, for the same reasons.
 *
 * WHY THIS IS ALLOWED TO EXIST, given that `estimating.prisma` said for a
 * while that "a quote never writes a price back into this template". The half
 * of that sentence which matters is untouched and always will be: nothing here
 * is ever summed into a JOB — a quote is reference data, and job cost lives on
 * `CostEntry`. What the sentence got too absolute about was the template: the
 * vendors page has always ended its own warning with "updating the catalog is
 * a decision about your own pricing, and it belongs on the catalog", and this
 * is the button that link points at. Nothing automatic writes anything; an
 * owner presses this, having read which vendor, at what price, on what date.
 *
 * THE FIGURE IS RE-DERIVED HERE and the form carries no numbers — #105
 * finding 3, on the one control in the app that edits a price every future bid
 * and every AI draft reads. The only thing taken from the request is the
 * margin checkbox, which is a pricing judgement rather than a fact the quotes
 * establish.
 */
export async function priceCatalogEntryFromQuotes(entryId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  // MANAGE_ESTIMATING first — the capability /catalog itself withholds — and
  // THEN the owner check. Its sibling above asserts only the owner, which
  // `action-capability-guards.test.ts` records as a known-open door; a new
  // action does not get to inherit that.
  if (!can(context, "MANAGE_ESTIMATING")) {
    return actionFail("Estimating isn't part of your job function. The account owner sets who sees what, on the Team page.");
  }
  const { company, ...user } = context;
  const refusal = ownerRefusal(user, "Only the account owner can re-price the catalog.");
  if (refusal) return refusal;

  const entry = await prisma.lineItemCatalogEntry.findFirst({
    where: { id: entryId, companyId: company.id },
    include: {
      priceQuotes: {
        include: { vendor: { select: { name: true } } },
        orderBy: { quotedOn: "desc" },
      },
    },
  });
  if (!entry) {
    return actionFail("Catalog entry not found — it may have been deleted. Reload the page.");
  }

  const decision = quotePriceDecision(
    {
      unit: entry.unit,
      defaultBudgetedUnitCost: entry.defaultBudgetedUnitCost != null ? Number(entry.defaultBudgetedUnitCost) : null,
      defaultUnitPrice: entry.defaultUnitPrice != null ? Number(entry.defaultUnitPrice) : null,
    },
    entry.priceQuotes.map((quote) => ({
      id: quote.id,
      vendorId: quote.vendorId,
      vendorName: quote.vendor.name,
      catalogEntryId: quote.catalogEntryId,
      description: quote.description,
      unit: quote.unit,
      unitPrice: Number(quote.unitPrice),
      quotedOn: quote.quotedOn.toISOString().slice(0, 10),
      validUntil: quote.validUntil ? quote.validUntil.toISOString().slice(0, 10) : null,
      source: quote.source,
      notes: quote.notes,
    })),
    // The viewer's own calendar day: whether a quote expired "today" is a
    // question about where the person reading it is standing.
    todayInZone(await viewerTimeZone()),
    String(formData.get("alsoUpdatePrice") ?? "") === "on",
  );
  if (!decision.ok) return actionFail(decision.error);

  // Only ever the entry's own defaults. Every JobLineItem already priced from
  // this template keeps its numbers, as do every EstimateVersion snapshot and
  // every invoice drawn from them.
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
 *
 * RETURNS ITS REFUSALS RATHER THAN THROWING THEM, as of 2026-09-21, and on
 * this action that is the difference between a sentence and a lost
 * afternoon. THE INPUT IS A PASTE — two hundred rows out of a supplier's
 * spreadsheet, living in `CatalogImport`'s React state and nowhere else.
 * Every refusal here was a `throw`; production redacts a thrown Server
 * Action message to a digest, so the person got the error boundary, and the
 * error boundary UNMOUNTS THE COMPONENT HOLDING THE PASTE. No reason, and
 * nothing to go back to.
 *
 * Who meets it: `/catalog` demands MANAGE_ESTIMATING and nothing else, and
 * ESTIMATOR holds that (lib/permissions.ts). So the one job function this
 * page exists for is the one this action always refuses. The page no longer
 * renders the control to them at all — that is the other half, and the more
 * important one — but a page guard stops a page rendering and does nothing
 * about the endpoint behind it.
 */
export async function importCatalogEntries(formData: FormData): Promise<ActionResult> {
  const { company, ...user } = await requireCompanyContext();
  const refusal = ownerRefusal(user, "Only the account owner can import a price list.");
  if (refusal) return refusal;

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

// ───────────────────────────────────────────────────────────────────────────
// LEVELLING — the quotes a sub collects from its OWN suppliers and subs for
// one bid. Not `VendorPriceQuote`, which is price history and carries no bid.
// MANAGE_ESTIMATING, the same capability `/bids` withholds on.
// ───────────────────────────────────────────────────────────────────────────

/** Creates or updates one quote received against a bid's scope package. */
export async function saveBidQuote(bidInvitationId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) {
    return actionFail("Estimating isn't part of your job function. The account owner sets who sees what, on the Team page.");
  }
  const { company } = context;

  const bid = await prisma.bidInvitation.findFirst({
    where: { id: bidInvitationId, companyId: company.id },
    select: { id: true },
  });
  if (!bid) return actionFail("That bid is no longer on this company. Reload the page.");

  return runAction(async () => {
    const packageLabel = String(formData.get("packageLabel") ?? "").trim();
    const vendorName = String(formData.get("vendorName") ?? "").trim();
    const amountValue = nullableDecimalFromForm(formData, "amount");
    const exclusions = String(formData.get("exclusions") ?? "").trim();
    const notes = String(formData.get("notes") ?? "").trim();

    const problem = bidQuoteProblem({
      packageLabel,
      vendorName,
      amount: amountValue === null ? null : Number(amountValue),
    });
    if (problem) return actionFail(problem);

    // Entered, not stamped: a quote logged on Friday for a price given on
    // Tuesday is a Tuesday price, the rule every dated record here follows.
    // Read through the shared YYYY-MM-DD -> UTC-midnight parser rather than a
    // fourth private copy of one (materialOrders, closeout and backcharges
    // each grew their own).
    const quotedOn = optionalDateFromString(formData.get("quotedOn"));

    // A PRICE AND THE DAY IT WAS GIVEN TRAVEL TOGETHER. Either both or
    // neither: an amount with no date is a number nobody can age, and a date
    // with no amount reads as an answer that never came. A row with neither is
    // the legitimate third case — a request that is still out.
    if (amountValue !== null && !quotedOn) {
      return actionFail("Say what day the quote was given — the day they gave it, not today.");
    }
    if (amountValue === null && quotedOn) {
      return actionFail("You've given a quote date with no amount. Enter what they quoted, or clear the date.");
    }

    // Optional. A quote from somebody not yet in the vendor list is still a
    // quote — refusing it would make the comparison partial, which is worse
    // than none because nobody would know it was partial.
    const vendorIdRaw = String(formData.get("vendorId") ?? "").trim();
    let vendorId: string | null = null;
    if (vendorIdRaw) {
      const vendor = await prisma.vendor.findFirst({
        where: { id: vendorIdRaw, companyId: company.id },
        select: { id: true },
      });
      if (!vendor) return actionFail("That supplier isn't on this company. Reload the page.");
      vendorId = vendor.id;
    }

    // THE REQUEST HALF IS WRITTEN ONLY BY A FORM THAT CARRIES IT. The answer
    // form has no `requestedOn`/`dueBy` field at all, and spreading them in as
    // `null` regardless would erase the record of having asked at the exact
    // moment the answer arrives — the one edit where losing it is invisible,
    // because the row looks complete afterwards. `formData.has` distinguishes
    // "the form left this blank" from "this form does not own this field";
    // an omitted key is left alone by Prisma.
    const requestFields: { requestedOn?: Date | null; dueBy?: Date | null } = {};
    if (formData.has("requestedOn")) requestFields.requestedOn = optionalDateFromString(formData.get("requestedOn"));
    if (formData.has("dueBy")) requestFields.dueBy = optionalDateFromString(formData.get("dueBy"));

    const data = {
      packageLabel,
      vendorName,
      vendorId,
      amount: amountValue,
      quotedOn,
      exclusions: exclusions || null,
      notes: notes || null,
      ...requestFields,
    };

    const bidQuoteId = String(formData.get("bidQuoteId") ?? "").trim();
    if (bidQuoteId) {
      const updated = await prisma.bidQuote.updateMany({
        where: { id: bidQuoteId, companyId: company.id, bidInvitationId },
        // An amount arriving clears any decline: they said no and then priced
        // it anyway, which happens, and the row should read as the answer it
        // now is rather than carrying both.
        data: amountValue === null ? data : { ...data, declinedAt: null },
      });
      if (updated.count === 0) return actionFail("That quote is no longer on this bid. Reload the page.");
    } else {
      await prisma.bidQuote.create({ data: { ...data, companyId: company.id, bidInvitationId } });
    }

    revalidatePath("/bids");
    return actionOk;
  });
}

/**
 * They came back and said they are not bidding it.
 *
 * A DATE AND NOT A DELETE. "Gamma declined to bid this" is the answer to "why
 * did we only get two prices", and next time it says who not to wait on —
 * both of which are lost if the row goes. It is also a date rather than a
 * boolean, for the reason every other evidence field here gives: when they
 * declined is part of what happened.
 *
 * Passing no date CLEARS the decline, which is the un-decline path: a supplier
 * who says no on Monday and prices it on Wednesday is not a new request.
 */
export async function recordBidQuoteDecline(bidQuoteId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) {
    return actionFail("Estimating isn't part of your job function. The account owner sets who sees what, on the Team page.");
  }
  const { company } = context;

  return runAction(async () => {
    const declinedAt = optionalDateFromString(formData.get("declinedAt"));

    const updated = await prisma.bidQuote.updateMany({
      where: { id: bidQuoteId, companyId: company.id },
      data: { declinedAt },
    });
    if (updated.count === 0) return actionFail("That quote is no longer on this bid. Reload the page.");

    revalidatePath("/bids");
    return actionOk;
  });
}

export async function deleteBidQuote(bidQuoteId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) {
    return actionFail("Estimating isn't part of your job function. The account owner sets who sees what, on the Team page.");
  }
  const { company } = context;

  const deleted = await prisma.bidQuote.deleteMany({ where: { id: bidQuoteId, companyId: company.id } });
  if (deleted.count === 0) return actionFail("That quote is already gone. Reload the page.");

  revalidatePath("/bids");
  return actionOk;
}

// ───────────────────────────────────────────────────────────────────────────
// WHAT A BID CARRIES BESIDES ITS NUMBER — alternates, unit prices, allowances.
//
// All three assert MANAGE_ESTIMATING, which is what `/bids` itself withholds
// on. Every refusal is RETURNED: production redacts a thrown Server Action
// message to a digest, and "an allowance cannot be negative" is exactly the
// sentence somebody needs to see.
// ───────────────────────────────────────────────────────────────────────────

const ESTIMATING_ONLY =
  "Estimating isn't part of your job function. The account owner sets who sees what, on the Team page.";

/** The kinds, as the form posts them. */
const BID_LINE_KINDS = ["ALTERNATE", "UNIT_PRICE", "ALLOWANCE"] as const;

/**
 * Creates or updates one line on a bid.
 *
 * THE SHAPE RULES ARE `bidLineProblem`'s, not this file's, so the form and the
 * write refuse the same things for the same reasons — a unit price with a
 * total, an allowance that is negative, an alternate of zero. Re-run here
 * because the screen may be minutes old and a refusal it showed must not
 * become savable by posting the form again.
 */
export async function saveBidLine(bidInvitationId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return actionFail(ESTIMATING_ONLY);
  const { company } = context;

  const bid = await prisma.bidInvitation.findFirst({
    where: { id: bidInvitationId, companyId: company.id },
    select: { id: true },
  });
  if (!bid) return actionFail("That bid is no longer on this company. Reload the page.");

  return runAction(async () => {
    const kind = enumFromForm(formData, "kind", BID_LINE_KINDS);
    const label = String(formData.get("label") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();

    // A unit price holds a RATE and no total; the other two hold an amount
    // and no rate. Reading only the fields the kind owns is what stops a
    // stale hidden input from the other branch of the form arriving with it.
    const amount = kind === "UNIT_PRICE" ? null : nullableDecimalFromForm(formData, "amount");
    const unitPrice = kind === "UNIT_PRICE" ? nullableDecimalFromForm(formData, "unitPrice") : null;
    const unit = kind === "UNIT_PRICE" ? String(formData.get("unit") ?? "").trim() || null : null;

    const problem = bidLineProblem({
      kind,
      label,
      amount: amount === null ? null : Number(amount),
      unit,
      unitPrice: unitPrice === null ? null : Number(unitPrice),
      accepted: null,
    });
    if (problem) return actionFail(problem);

    const bidLineId = String(formData.get("bidLineId") ?? "").trim();
    const data = {
      kind,
      label,
      description: description || null,
      amount,
      unit,
      unitPrice,
    };

    if (bidLineId) {
      // Tenancy is the `where`: an id from another company matches nothing,
      // and the count is the refusal.
      const updated = await prisma.bidLine.updateMany({
        where: { id: bidLineId, companyId: company.id, bidInvitationId },
        data,
      });
      if (updated.count === 0) return actionFail("That line is no longer on this bid. Reload the page.");
    } else {
      const last = await prisma.bidLine.findFirst({
        where: { bidInvitationId },
        orderBy: { sortOrder: "desc" },
        select: { sortOrder: true },
      });
      await prisma.bidLine.create({
        data: { ...data, companyId: company.id, bidInvitationId, sortOrder: (last?.sortOrder ?? 0) + 1 },
      });
    }

    revalidatePath("/bids");
    return actionOk;
  });
}

/**
 * Records the GC's answer on an alternate.
 *
 * THREE STATES, NOT TWO. "Accepted", "rejected" and "they have not said" are
 * different facts about a live negotiation, and an award total computed while
 * alternates are outstanding is provisional — collapsing the third into
 * "rejected" would make it look settled.
 */
export async function setBidLineAccepted(bidLineId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return actionFail(ESTIMATING_ONLY);
  const { company } = context;

  const answer = String(formData.get("accepted") ?? "");
  const accepted = answer === "yes" ? true : answer === "no" ? false : null;

  const line = await prisma.bidLine.findFirst({
    where: { id: bidLineId, companyId: company.id },
    select: { kind: true },
  });
  if (!line) return actionFail("That line is no longer on this bid. Reload the page.");
  if (line.kind !== "ALTERNATE") {
    // Only an alternate is something a GC takes or leaves. A unit price is
    // held either way, and an allowance is already inside the bid.
    return actionFail("Only an alternate is accepted or declined — a unit price and an allowance are not.");
  }

  await prisma.bidLine.update({ where: { id: bidLineId }, data: { accepted } });
  revalidatePath("/bids");
  return actionOk;
}

export async function deleteBidLine(bidLineId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return actionFail(ESTIMATING_ONLY);
  const { company } = context;

  const deleted = await prisma.bidLine.deleteMany({ where: { id: bidLineId, companyId: company.id } });
  if (deleted.count === 0) return actionFail("That line is already gone. Reload the page.");

  revalidatePath("/bids");
  return actionOk;
}


/**
 * Links a won bid to the job it became — or unlinks it.
 *
 * WHY A PERSON DOES THIS AND NOT THE APP. Nothing in the data says which job a
 * bid became: project names rarely match the GC's wording, dates rarely line
 * up, and one GC can send three invitations for one building. A fuzzy match
 * here would attach a bid amount to the wrong job's costs and then TEACH the
 * estimator from it, which is worse than leaving the two unlinked. Same
 * posture as `JobLineItem.sourceCatalogEntryId`, which the schema says is
 * "deliberately NOT backfilled by fuzzy-matching descriptions".
 *
 * Only a WON bid can be linked. An invitation that was lost or declined did
 * not become anything, and a link from one would put a competitor's job — or
 * nothing at all — against our own costs.
 */
export async function linkBidToJob(bidInvitationId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) {
    return actionFail("Estimating isn't part of your job function. The account owner sets who sees what, on the Team page.");
  }
  const { company } = context;

  const bid = await prisma.bidInvitation.findFirst({
    where: { id: bidInvitationId, companyId: company.id },
  });
  if (!bid) return actionFail("That bid is no longer on this company. Reload the page.");
  if (bid.status !== "WON") {
    return actionFail("Only a bid marked Won can be linked to a job — mark it Won first.");
  }

  const jobId = String(formData.get("jobId") ?? "").trim();
  if (!jobId) {
    // Unlinking is the same control with nothing picked, so a mistaken link
    // can be undone without a second button.
    await prisma.bidInvitation.update({ where: { id: bidInvitationId }, data: { wonJobId: null } });
    revalidatePath("/bids");
    return actionOk;
  }

  // Tenancy is the `where`: a job id from another company matches nothing.
  const job = await prisma.job.findFirst({ where: { id: jobId, companyId: company.id }, select: { id: true } });
  if (!job) return actionFail("That job isn't on this company. Reload the page.");

  // `wonJobId` is unique, so a job already claimed by another bid would throw
  // a constraint error production REDACTS. Say which bid has it instead.
  const claimed = await prisma.bidInvitation.findFirst({
    where: { wonJobId: jobId, companyId: company.id, NOT: { id: bidInvitationId } },
    select: { projectName: true },
  });
  if (claimed) {
    return actionFail(`That job is already linked to the bid "${claimed.projectName}". Unlink it there first.`);
  }

  await prisma.bidInvitation.update({ where: { id: bidInvitationId }, data: { wonJobId: jobId } });
  revalidatePath("/bids");
  revalidatePath(`/jobs/${jobId}`);
  return actionOk;
}

/** The requirement kinds, as the form posts them. Deliberately carries no
 * member for anything the app can check itself — see bid-compliance.prisma. */
const BID_REQUIREMENT_KINDS = [
  "BID_BOND",
  "SIGNED_BID_FORM",
  "SUBCONTRACTOR_LIST",
  "INSURANCE_CERTIFICATE",
  "PREQUALIFICATION",
  "PARTICIPATION_FORMS",
  "OTHER",
] as const;

// ───────────────────────────────────────────────────────────────────────────
// BID-FORM COMPLIANCE — the paperwork that decides whether anybody reads the
// number. Addenda the GC issued, and the ITB items only a person can confirm.
// MANAGE_ESTIMATING, the same capability `/bids` withholds on.
//
// There is deliberately no action here that marks the bid "compliant". What
// is outstanding is DERIVED on every read by lib/bid-responsiveness.ts, from
// these rows and from BidLine — so there is no flag to set, and nothing that
// could disagree with the data underneath it.
// ───────────────────────────────────────────────────────────────────────────

/** Creates or updates one addendum the GC issued on this bid. */
export async function saveBidAddendum(bidInvitationId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) {
    return actionFail("Estimating isn't part of your job function. The account owner sets who sees what, on the Team page.");
  }
  const { company } = context;

  const bid = await prisma.bidInvitation.findFirst({
    where: { id: bidInvitationId, companyId: company.id },
    select: { id: true },
  });
  if (!bid) return actionFail("That bid is no longer on this company. Reload the page.");

  return runAction(async () => {
    const reference = String(formData.get("reference") ?? "").trim();
    const impactNote = String(formData.get("impactNote") ?? "").trim();
    const notes = String(formData.get("notes") ?? "").trim();

    const problem = addendumProblem({ reference });
    if (problem) return actionFail(problem);

    // Both entered, never stamped. The gap between them is how somebody finds
    // out they are hearing about changes late, and stamping either would
    // erase exactly that.
    const issuedOn = optionalDateFromString(formData.get("issuedOn"));
    const acknowledgedOn = optionalDateFromString(formData.get("acknowledgedOn"));

    const data = {
      reference,
      issuedOn,
      acknowledgedOn,
      affectsPricedScope: formData.get("affectsPricedScope") === "on",
      impactNote: impactNote || null,
      notes: notes || null,
    };

    const addendumId = String(formData.get("addendumId") ?? "").trim();
    if (addendumId) {
      const updated = await prisma.bidAddendum.updateMany({
        where: { id: addendumId, companyId: company.id, bidInvitationId },
        data,
      });
      if (updated.count === 0) return actionFail("That addendum is no longer on this bid. Reload the page.");
    } else {
      await prisma.bidAddendum.create({ data: { ...data, companyId: company.id, bidInvitationId } });
    }

    revalidatePath("/bids");
    return actionOk;
  });
}

/**
 * Records that an addendum has been acknowledged — or takes it back.
 *
 * Passing no date CLEARS it, which is the un-acknowledge path. Worth having
 * rather than forcing a delete: an addendum ticked by mistake is a bid that
 * looks responsive and is not, and deleting the row would lose the fact that
 * the GC issued it at all.
 */
export async function acknowledgeBidAddendum(addendumId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) {
    return actionFail("Estimating isn't part of your job function. The account owner sets who sees what, on the Team page.");
  }
  const { company } = context;

  return runAction(async () => {
    const acknowledgedOn = optionalDateFromString(formData.get("acknowledgedOn"));
    const updated = await prisma.bidAddendum.updateMany({
      where: { id: addendumId, companyId: company.id },
      data: { acknowledgedOn },
    });
    if (updated.count === 0) return actionFail("That addendum is no longer on this bid. Reload the page.");

    revalidatePath("/bids");
    return actionOk;
  });
}

export async function deleteBidAddendum(addendumId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) {
    return actionFail("Estimating isn't part of your job function. The account owner sets who sees what, on the Team page.");
  }
  const { company } = context;

  const deleted = await prisma.bidAddendum.deleteMany({ where: { id: addendumId, companyId: company.id } });
  if (deleted.count === 0) return actionFail("That addendum is already gone. Reload the page.");

  revalidatePath("/bids");
  return actionOk;
}

/** Creates or updates one ITB requirement only a person can confirm. */
export async function saveBidRequirement(bidInvitationId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) {
    return actionFail("Estimating isn't part of your job function. The account owner sets who sees what, on the Team page.");
  }
  const { company } = context;

  const bid = await prisma.bidInvitation.findFirst({
    where: { id: bidInvitationId, companyId: company.id },
    select: { id: true },
  });
  if (!bid) return actionFail("That bid is no longer on this company. Reload the page.");

  return runAction(async () => {
    const label = String(formData.get("label") ?? "").trim();
    const notes = String(formData.get("notes") ?? "").trim();

    const problem = requirementProblem({ label });
    if (problem) return actionFail(problem);

    const kind = enumFromForm(formData, "kind", BID_REQUIREMENT_KINDS);

    const data = {
      kind,
      label,
      required: formData.get("required") !== "off",
      satisfiedOn: optionalDateFromString(formData.get("satisfiedOn")),
      notes: notes || null,
    };

    const requirementId = String(formData.get("requirementId") ?? "").trim();
    if (requirementId) {
      const updated = await prisma.bidRequirement.updateMany({
        where: { id: requirementId, companyId: company.id, bidInvitationId },
        data,
      });
      if (updated.count === 0) return actionFail("That requirement is no longer on this bid. Reload the page.");
    } else {
      await prisma.bidRequirement.create({ data: { ...data, companyId: company.id, bidInvitationId } });
    }

    revalidatePath("/bids");
    return actionOk;
  });
}

/** Records an ITB item as done — or takes it back, by passing no date. */
export async function satisfyBidRequirement(requirementId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) {
    return actionFail("Estimating isn't part of your job function. The account owner sets who sees what, on the Team page.");
  }
  const { company } = context;

  return runAction(async () => {
    const satisfiedOn = optionalDateFromString(formData.get("satisfiedOn"));
    const updated = await prisma.bidRequirement.updateMany({
      where: { id: requirementId, companyId: company.id },
      data: { satisfiedOn },
    });
    if (updated.count === 0) return actionFail("That requirement is no longer on this bid. Reload the page.");

    revalidatePath("/bids");
    return actionOk;
  });
}

export async function deleteBidRequirement(requirementId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) {
    return actionFail("Estimating isn't part of your job function. The account owner sets who sees what, on the Team page.");
  }
  const { company } = context;

  const deleted = await prisma.bidRequirement.deleteMany({ where: { id: requirementId, companyId: company.id } });
  if (deleted.count === 0) return actionFail("That requirement is already gone. Reload the page.");

  revalidatePath("/bids");
  return actionOk;
}
