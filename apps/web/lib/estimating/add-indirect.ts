import { prisma } from "@prova/db";
import type { ActionResultWith } from "@/lib/actions/shared";
import { NOT_ESTIMATE_STAGE } from "./draft-lines";
import { catalogLineFields } from "./catalog-line";
import { INDIRECT_COST_LABEL, type IndirectCostKindValue } from "./indirect-costs";

/**
 * ADDS ONE GENERAL-CONDITIONS LINE, from the company's own figure where it has
 * one and as a named placeholder where it does not.
 *
 * The way out of the sentence `missingIndirects` produces. CLAUDE.md asks for
 * one by name — "real empty states with a way out" — and `setLineBudgetedCost`
 * states the cost of not having one: "Naming the problem and leaving the fix on
 * another part of the page is the dead-end empty state."
 *
 * ── IT WRITES A COST-ONLY LINE, AND THAT IS THE WHOLE POINT ──
 *
 * `unitPrice: null`, always, even when the catalog entry carries a default
 * price. A general-conditions line is recovered through the billable lines —
 * `spreadToLines` excludes it from the spread for exactly that reason, and
 * giving it a price of its own would "make a general-conditions line look
 * sold". The GC portal has a test whose failure message is "a cost-only budget
 * line reached the GC's contract"; this is the writer that would cause it.
 *
 * So the entry's cost is copied and its price is dropped. That is the one place
 * this diverges from `catalogLineFields`, and it is deliberate rather than an
 * omission.
 *
 * ── NOTHING ABOUT THE FIGURE COMES FROM THE REQUEST ──
 *
 * The caller names a job and a KIND. The cost is read from the company's own
 * catalog entry server-side — #105 finding 3, and the rule
 * `priceCatalogEntryFromQuotes` states as "there is nowhere here for a number
 * the browser sent to come in". A pressed button must not be able to put an
 * arbitrary cost on a bid.
 *
 * ── AND IT REFUSES A KIND THAT IS ALREADY THERE ──
 *
 * Not for safety — a second supervision line is a legal thing to want — but
 * because this button exists to answer "you have nothing for X", and pressing
 * it twice from a stale page would silently double it. `quotePriceDecision`'s
 * "already matches" refusal is the same shape.
 */
export async function addIndirectLine(
  companyId: string,
  input: { jobId: string; kind: IndirectCostKindValue },
): Promise<ActionResultWith<{ lineItemId: string; description: string; hasCost: boolean }>> {
  const job = await prisma.job.findFirst({
    where: { id: input.jobId, companyId },
    select: { id: true, status: true },
  });
  if (!job) return { ok: false, error: "Job not found" };
  if (job.status !== "ESTIMATE") return { ok: false, error: NOT_ESTIMATE_STAGE };

  const label = INDIRECT_COST_LABEL[input.kind];
  if (!label) {
    // An unrecognised kind must be refused rather than written as a line with a
    // blank description — the `setLineCostCategory` rule (#527): an
    // unrecognised value must never be silently coerced.
    return { ok: false, error: "That isn't a kind of general conditions this app knows." };
  }

  const already = await prisma.jobLineItem.findFirst({
    where: { jobId: job.id, isDeleted: false, indirectKind: input.kind },
    select: { id: true },
  });
  if (already) {
    return {
      ok: false,
      error: `This estimate already carries a ${label.label.toLowerCase()} line. Edit that one rather than adding a second.`,
    };
  }

  const entry = await prisma.lineItemCatalogEntry.findFirst({
    where: { companyId, indirectKind: input.kind },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      description: true,
      unit: true,
      defaultUnitPrice: true,
      defaultBudgetedUnitCost: true,
      defaultLaborHours: true,
      productionRate: true,
      tradeScope: true,
      costCategory: true,
      indirectKind: true,
      craftClassificationId: true,
    },
  });

  const created = entry
    ? await prisma.jobLineItem.create({
        data: {
          jobId: job.id,
          ...catalogLineFields(entry),
          quantity: 1,
          // THE ONE DIVERGENCE FROM THE CATALOG COPY — see the header. A
          // general-conditions line carries cost and no price whatever the
          // entry says, because the bid recovers it through the billable lines.
          unitPrice: null,
        },
        select: { id: true, description: true, budgetedUnitCost: true },
      })
    : await prisma.jobLineItem.create({
        data: {
          jobId: job.id,
          // NAMED BUT UNPRICED, which is honest: nobody has said what it costs.
          // `apply-template.ts` takes the same position on an item with no
          // catalog entry behind it, and the costless line is then visible to
          // `bid-margin.ts` rather than hidden.
          description: label.label,
          quantity: 1,
          unitPrice: null,
          indirectKind: input.kind,
        },
        select: { id: true, description: true, budgetedUnitCost: true },
      });

  return {
    ok: true,
    value: {
      lineItemId: created.id,
      description: created.description,
      hasCost: created.budgetedUnitCost != null,
    },
  };
}
