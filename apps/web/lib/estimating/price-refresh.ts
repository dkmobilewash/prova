import { bidTotalOf } from "@/lib/estimating/recap-state";

/**
 * "UPDATE PRICES ON THIS ESTIMATE" — which lines have fallen behind the price
 * book, and what repricing them would do to the bid.
 *
 * A catalog entry is a template: changing it never reaches back into a line
 * already priced from it (jobs.prisma, ARCHITECTURE.md). That is right for a
 * bid a GC may already hold, and wrong the day the board supplier sends an 8%
 * increase and three open bids are quietly short. This is the one deliberate
 * door: a person asks, sees old -> new per line, and confirms.
 *
 * ── WHAT A LINE DOES NOT RECORD ──
 *
 * It records WHICH entry it came from (`sourceCatalogEntryId`) but not the price
 * it was generated at, and an edit of a price leaves no mark. So "behind the
 * price book" can only mean "different from the price book TODAY", and a linked
 * line whose price somebody set on purpose looks identical to a stale one. The
 * honest handling is per-line choice: every candidate is listed with old -> new
 * and can be unticked, and the screen says why. Lines with NO catalog link —
 * typed by hand, or AI-drafted with no match — are never candidates: nothing
 * says what they should cost, so they are listed as kept. An exact answer needs
 * a recorded "priced from" figure on the line (an additive column); see the PR.
 *
 * ── TWO FIGURES, AND ONLY ONE OF THEM IS ALWAYS SAFE TO MOVE ──
 *
 * `budgetedUnitCost` is what the line costs; the bid recap marks THAT up.
 * `unitPrice` is what the line charges. Once "Apply to line prices" has been
 * pressed the unit prices are a spread of the marked-up bid, no longer the
 * catalog's price, so overwriting them here would silently strip the markup
 * off the bid. After that point only COST moves, and the result says the
 * recap needs applying again.
 *
 * Pure: loading and writing are in `lib/actions/priceRefresh.ts`.
 */

export type RefreshLine = {
  id: string;
  description: string;
  quantity: number;
  unit: string | null;
  unitPrice: number | null;
  budgetedUnitCost: number | null;
  currentEstimatedUnitCost: number | null;
  /** The row's `sourceCatalogEntryId`, under its own name on purpose: this is
   *  a read-only view, and `catalogLineWriterCensus.test.ts` treats any
   *  `sourceCatalogEntryId:` key as a row write that must carry the inherited
   *  fields. Nothing here creates a catalog-sourced line. */
  catalogEntryId: string | null;
};

export type RefreshEntry = {
  id: string;
  unit: string | null;
  defaultUnitPrice: number | null;
  defaultBudgetedUnitCost: number | null;
};

export type Figure = { old: number | null; next: number };

export type LineUpdate = {
  lineId: string;
  description: string;
  quantity: number;
  unit: string | null;
  price: Figure | null;
  cost: Figure | null;
  /** quantity x (new price - old price); null price counts as 0 old. */
  priceEffect: number;
  costEffect: number;
};

export type KeptReason =
  | "no-link" // typed by hand, or drafted with no catalog match
  | "entry-missing" // the entry it came from has been deleted
  | "no-catalog-price" // the entry carries no price or cost to update to
  | "unit-differs"; // the line's unit is not the entry's unit

export type KeptLine = { lineId: string; description: string; reason: KeptReason };

export type RefreshPlan = {
  updates: LineUpdate[];
  kept: KeptLine[];
  /** Linked lines already matching the price book. */
  current: number;
  /** True when line prices are a recap spread and so were not touched. */
  priceHeldForRecap: boolean;
  bidBefore: number;
  bidAfter: number;
  priceEffect: number;
  costEffect: number;
};

const cents = (n: number) => Math.round(n * 100);
const sameMoney = (a: number | null, b: number) => a != null && cents(a) === cents(b);
const unitKey = (u: string | null) => (u ?? "").trim().toLowerCase();

export const KEPT_REASON_TEXT: Record<KeptReason, string> = {
  "no-link": "kept — you set this price",
  "entry-missing": "kept — its price book item was deleted",
  "no-catalog-price": "kept — its price book item has no price to update to",
  "unit-differs": "kept — its unit is not the price book item's unit",
};

export function planPriceRefresh(
  lines: readonly RefreshLine[],
  entries: readonly RefreshEntry[],
  opts: { recapApplied: boolean },
): RefreshPlan {
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const updates: LineUpdate[] = [];
  const kept: KeptLine[] = [];
  let current = 0;

  for (const line of lines) {
    const keep = (reason: KeptReason) => kept.push({ lineId: line.id, description: line.description, reason });
    if (!line.catalogEntryId) {
      keep("no-link");
      continue;
    }
    const entry = entryById.get(line.catalogEntryId);
    if (!entry) {
      keep("entry-missing");
      continue;
    }
    if (entry.defaultUnitPrice == null && entry.defaultBudgetedUnitCost == null) {
      keep("no-catalog-price");
      continue;
    }
    if (line.unit != null && entry.unit != null && unitKey(line.unit) !== unitKey(entry.unit)) {
      keep("unit-differs");
      continue;
    }

    const cost =
      entry.defaultBudgetedUnitCost != null && !sameMoney(line.budgetedUnitCost, entry.defaultBudgetedUnitCost)
        ? { old: line.budgetedUnitCost, next: entry.defaultBudgetedUnitCost }
        : null;
    const price =
      !opts.recapApplied &&
      entry.defaultUnitPrice != null &&
      !sameMoney(line.unitPrice, entry.defaultUnitPrice)
        ? { old: line.unitPrice, next: entry.defaultUnitPrice }
        : null;
    if (!cost && !price) {
      current += 1;
      continue;
    }
    updates.push({
      lineId: line.id,
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      price,
      cost,
      priceEffect: price ? line.quantity * (price.next - (price.old ?? 0)) : 0,
      costEffect: cost ? line.quantity * (cost.next - (cost.old ?? 0)) : 0,
    });
  }

  const priceEffect = updates.reduce((sum, u) => sum + u.priceEffect, 0);
  const costEffect = updates.reduce((sum, u) => sum + u.costEffect, 0);
  const bidBefore = bidTotalOf(lines);
  return {
    updates,
    kept,
    current,
    priceHeldForRecap: opts.recapApplied,
    bidBefore,
    // The same sum the header and the proposal use, run over the lines as they
    // would stand — not `bidBefore + priceEffect`, a second way to add a bid up.
    bidAfter: bidTotalOf(
      lines.map((line) => {
        const update = updates.find((u) => u.lineId === line.id);
        return { quantity: line.quantity, unitPrice: update?.price ? update.price.next : line.unitPrice };
      }),
    ),
    priceEffect,
    costEffect,
  };
}

/** One line and the figures it will take — what a confirmation vouches for. The
 * client joins the sorted tokens of the lines it ticked; the server recomputes. */
export function updateToken(update: Pick<LineUpdate, "lineId" | "cost" | "price">): string {
  return `${update.lineId}:${update.cost?.next ?? "-"}:${update.price?.next ?? "-"}`;
}

/**
 * What to write for ONE line. `currentEstimatedUnitCost` follows the budgeted
 * cost only while it still equals it (or is unset) — at estimate stage it is
 * the same number, and a forecast somebody typed over it is theirs.
 */
export function lineWrite(update: LineUpdate, line: Pick<RefreshLine, "budgetedUnitCost" | "currentEstimatedUnitCost">) {
  const data: { unitPrice?: string; budgetedUnitCost?: string; currentEstimatedUnitCost?: string } = {};
  if (update.price) data.unitPrice = update.price.next.toString();
  if (update.cost) {
    data.budgetedUnitCost = update.cost.next.toString();
    const follows =
      line.currentEstimatedUnitCost == null ||
      (line.budgetedUnitCost != null && cents(line.currentEstimatedUnitCost) === cents(line.budgetedUnitCost));
    if (follows) data.currentEstimatedUnitCost = update.cost.next.toString();
  }
  return data;
}
