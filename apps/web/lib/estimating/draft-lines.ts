import { prisma } from "@prova/db";
import { draftEstimateLineItems, type DraftPriceBasis } from "@prova/integrations";
import type { ActionResultWith } from "@/lib/actions/shared";

/**
 * Draft line items from scope text — the one place in the app where model
 * output already becomes rows, lifted out of `draftLineItemsFromScope` so
 * the Ask command can call it with an id and get a count back.
 *
 * Unchanged in what it writes: every line is flagged `aiDrafted`, a line
 * that matched a catalog entry is created the way "add from catalog"
 * creates one, and `priceBasis` records where each price came from. What
 * changed is the shape: guards return their sentence instead of throwing
 * it, because the command shows that sentence on a card and production
 * redacts a throw.
 *
 * The status guard is the same sentence `assertEditableDirectly` throws,
 * kept word for word so the form and the command disagree about nothing.
 */
export const NOT_ESTIMATE_STAGE =
  "This job is contracted — edit line items via a change order instead of directly.";

/**
 * Where the price on THIS row came from — derived from the branch that
 * actually chose the number, never copied from the model.
 *
 * The drafter normalises what the model CLAIMED about its own price
 * (anthropic.ts), but the number written is chosen here: a matched catalog
 * entry's own default overrides whatever the model said. Those two
 * decisions were made in two files and nothing reconciled them, so the
 * badge on the job page (`PriceBasisBadge`) could contradict the figure
 * printed beside it, in both directions:
 *
 *   - an entry with NO default price, claimed COMPANY_CATALOG: the number
 *     stored is the model's own invention and the badge read the green
 *     "Your catalog price". False confidence is the exact thing this field
 *     exists to prevent, so it degrades to the weakest basis — the same
 *     rule anthropic.ts already applies to a catalog claim with no entry
 *     behind it;
 *   - an entry WITH a default price and any other claim: the number stored
 *     is the company's own, badged "AI guess, no company data" or, with no
 *     claim at all, "AI-drafted, unpriced" beside a price. The price is the
 *     catalog's; say so.
 *
 * No price means no claim about where a price came from.
 */
export function priceBasisFor(
  fromCatalog: boolean,
  unitPrice: string | null,
  claimed: DraftPriceBasis | null,
): DraftPriceBasis | null {
  if (unitPrice == null) return null;
  if (fromCatalog) return "COMPANY_CATALOG";
  return claimed === null || claimed === "COMPANY_CATALOG" ? "GENERAL_KNOWLEDGE" : claimed;
}

export async function draftLinesFromScope(
  companyId: string,
  input: { jobId: string; scopeText: string },
): Promise<ActionResultWith<{ count: number }>> {
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

  const scopeText = input.scopeText.trim();
  if (!scopeText) {
    return { ok: false, error: "Paste or type a scope of work to draft from" };
  }

  // Ground the draft in what this company actually charges, rather than what
  // the market roughly charges: the catalog is its own priced work, and won
  // bids are the prices that have actually cleared with a GC.
  const [catalogEntries, wonBids] = await Promise.all([
    prisma.lineItemCatalogEntry.findMany({
      where: { companyId },
      orderBy: { description: "asc" },
      select: { id: true, description: true, unit: true, defaultUnitPrice: true, tradeScope: true },
    }),
    prisma.bidInvitation.findMany({
      where: { companyId, status: "WON", bidAmount: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: { projectName: true, tradeScope: true, bidAmount: true },
    }),
  ]);

  let draftLineItems: Awaited<ReturnType<typeof draftEstimateLineItems>>;
  try {
    draftLineItems = await draftEstimateLineItems(scopeText, {
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
  } catch (err) {
    // The drafter throws when the model returns nothing usable. That is a
    // sentence for the person, not a bug: say so and write nothing.
    return {
      ok: false,
      error:
        err instanceof Error && err.message
          ? err.message
          : "Couldn't draft line items from that text",
    };
  }

  // A line that matched a catalog entry carries the entry's own cost and
  // craft defaults, not just the price the model echoed back.
  const matchedEntries = await prisma.lineItemCatalogEntry.findMany({
    where: {
      companyId,
      id: { in: draftLineItems.map((item) => item.catalogEntryId).filter((id): id is string => !!id) },
    },
  });
  const fullEntryById = new Map(matchedEntries.map((entry) => [entry.id, entry]));

  const created = await prisma.jobLineItem.createMany({
    data: draftLineItems.map((item) => {
      const entry = item.catalogEntryId ? fullEntryById.get(item.catalogEntryId) : undefined;
      const fromCatalog = entry?.defaultUnitPrice != null;
      const unitPrice = fromCatalog
        ? entry!.defaultUnitPrice!.toString()
        : item.unitPrice != null
          ? item.unitPrice.toString()
          : null;
      return {
        jobId: job.id,
        description: entry?.description ?? item.description,
        quantity: item.quantity.toString(),
        unit: entry?.unit ?? item.unit,
        unitPrice,
        budgetedUnitCost: entry?.defaultBudgetedUnitCost ?? null,
        currentEstimatedUnitCost: entry?.defaultBudgetedUnitCost ?? null,
        laborHours: entry?.defaultLaborHours ?? null,
        craftClassificationId: entry?.craftClassificationId ?? null,
        tradeScope: entry?.tradeScope ?? item.tradeScope,
        sourceCatalogEntryId: entry?.id ?? null,
        priceBasis: priceBasisFor(fromCatalog, unitPrice, item.priceBasis),
        aiDrafted: true,
      };
    }),
  });

  return { ok: true, value: { count: created.count } };
}
