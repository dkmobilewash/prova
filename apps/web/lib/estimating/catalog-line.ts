import { Prisma, prisma, type TradeScope } from "@prova/db";
import { parseNumericInput } from "@/lib/numeric-input";
import type { ActionResultWith } from "@/lib/actions/shared";
import { NOT_ESTIMATE_STAGE } from "./draft-lines";

/**
 * "Add 200 SF of 5/8 Type X to the estimate" — the body of
 * `addLineItemFromCatalog`, lifted so the Ask command can call it by id.
 * Same rows written, same `priceBasis: COMPANY_CATALOG`, same
 * `sourceCatalogEntryId` reference; guards return their sentence instead of
 * throwing it.
 *
 * The quantity arrives as the person's own typed string and is stored as
 * the Decimal it parses to. No extended total is computed here or anywhere
 * near the model: the job page does that arithmetic, once.
 */
export async function addCatalogLine(
  companyId: string,
  input: { jobId: string; catalogEntryId: string; quantity: string },
): Promise<ActionResultWith<{ lineItemId: string; description: string; unit: string | null }>> {
  const job = await prisma.job.findFirst({
    where: { id: input.jobId, companyId },
    select: { id: true, status: true },
  });
  if (!job) {
    return { ok: false, error: "Job not found" };
  }
  if (job.status !== "ESTIMATE") {
    return { ok: false, error: NOT_ESTIMATE_STAGE };
  }

  const entry = await prisma.lineItemCatalogEntry.findFirst({
    where: { id: input.catalogEntryId, companyId },
  });
  if (!entry) {
    return { ok: false, error: "Catalog entry not found" };
  }

  // THIS COMMENT USED TO SAY "the same test decimalFromForm applies", and
  // it was true when written. `decimalFromForm` moved to
  // `lib/numeric-input.ts` on 2026-09-21 and this did not, which left the
  // wizard's "Add from catalog" box refusing `2,800` on the SAME SCREEN
  // where the hand-typed Qty next to it had just started accepting it —
  // the original bug, surviving inside the fix for it because a sentence
  // claiming agreement went stale instead of failing.
  //
  // It also returned the RAW string for a Decimal column, so `0x10` and
  // `Infinity` got through here exactly as they did there.
  const parsed = parseNumericInput(input.quantity, { label: "Quantity", min: 0 });
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }
  const quantity = parsed.value;

  const line = await prisma.jobLineItem.create({
    data: {
      jobId: job.id,
      ...catalogLineFields(entry),
      quantity,
    },
    select: { id: true },
  });

  return { ok: true, value: { lineItemId: line.id, description: entry.description, unit: entry.unit } };
}

/**
 * THE FIELDS A LINE INHERITS FROM A CATALOG ENTRY, in one place.
 *
 * Extracted 2026-09-25 when estimate templates became a second writer of
 * catalog-sourced lines. Two copies of this mapping would drift, and this
 * file already carries the scar of exactly that: the comment a few lines
 * above records a fix that survived inside the bug it fixed, because a
 * sentence claiming two things agreed went stale instead of failing.
 *
 * `quantity` is deliberately NOT here. It is the one field the two callers
 * genuinely disagree about — one parses a person's typed string, the other
 * takes a template's default — and folding it in would hide that.
 */
export function catalogLineFields(entry: {
  id: string;
  description: string;
  unit: string | null;
  defaultUnitPrice: Prisma.Decimal | null;
  defaultBudgetedUnitCost: Prisma.Decimal | null;
  defaultLaborHours: Prisma.Decimal | null;
  tradeScope: TradeScope | null;
  craftClassificationId: string | null;
}) {
  return {
      description: entry.description,
      unit: entry.unit,
      unitPrice: entry.defaultUnitPrice,
      budgetedUnitCost: entry.defaultBudgetedUnitCost,
      currentEstimatedUnitCost: entry.defaultBudgetedUnitCost,
      tradeScope: entry.tradeScope,
      // FLAT, on purpose as of now and pinned by catalog-line.test.ts: the
      // entry's hours land on the line unchanged at every quantity, while
      // unitPrice and budgetedUnitCost above are per-unit figures the job page
      // multiplies out. That asymmetry is real and was undocumented, and an
      // estimator could not tell which was meant.
      //
      // It is NOT settled which it should be — the two writers of
      // `defaultLaborHours` disagree with each other. `saveLineItemAsCatalogEntry`
      // copies a line's total hours in without dividing by quantity (flat);
      // `importCatalogEntries` maps a price list's hours column straight in, and
      // a price list's hours column is a per-unit productivity factor (the
      // import sample's own 0.012 for a SF of board). Changing this line to
      // multiply would re-scale the labor burden on every catalog-sourced line
      // already estimated, and `Decimal(8, 2)` cannot hold a per-unit rate
      // anyway — 0.012 stores as 0.01. So the behaviour stays put, the labels
      // now say what it is, and the decision is written up for a person.
      laborHours: entry.defaultLaborHours,
      craftClassificationId: entry.craftClassificationId,
      // Records which template this came from, so /catalog can later report
      // how work priced from it actually costed. A reference, not a live
      // link: changing the entry's defaults never touches this row.
      sourceCatalogEntryId: entry.id,
      priceBasis: "COMPANY_CATALOG" as const,
  };
}
