import { bidTotalOf } from "@/lib/estimating/recap-state";

/**
 * HOW THE PROPOSAL PRESENTS THE PRICE — and what it refuses to print.
 *
 * ── THE DEFECT ──
 *
 * `/jobs/[id]/proposal` printed every estimate line: "W2 — 3-5/8" 25ga stud,
 * 1,240 EA, $X". A sub's material and labour unit prices are the one thing a
 * sub does not hand a GC, so the document read as an internal estimate. Three
 * presentations now exist:
 *
 *   LUMP     one price for the scope. The default for a proposal.
 *   SCOPE    a subtotal per wall type (or trade scope, for a hand-kept line).
 *   ITEMIZED the schedule of values exactly as it was.
 *
 * ── THE RULE THAT MATTERS: ONE TOTAL, THREE VIEWS ──
 *
 * Every mode's total is `bidTotalOf` over the same lines — the number the job
 * header, the recap and the contract value already read. Nothing here sums a
 * price a second way. The only new arithmetic is the SPLIT of that one total
 * into per-scope subtotals, and it is whole cents with a reconciliation: lines
 * can carry sub-cent extensions (2.5 SF at $1.15), so rounding each scope on
 * its own can add up to a different number than the bid. The cents are
 * handed out largest-remainder-first — the rule `spreadToLines` uses — so the
 * printed subtotals ALWAYS add up to the printed total, to the cent.
 *
 * ── THE ROW TYPES CANNOT CARRY A UNIT PRICE ──
 *
 * The LUMP and SCOPE rows have no `unitPrice`, `quantity`, `unit`, cost or
 * hours field at all. A page that wanted to leak one would have to change this
 * type first, which a test pins. A render-time `if (mode === "itemized")` can
 * be inverted without anybody noticing; a field that does not exist cannot.
 *
 * Pure. No database, no React.
 */

export const PROPOSAL_MODES = ["lump", "scope", "itemized"] as const;
export type ProposalMode = (typeof PROPOSAL_MODES)[number];

/** A new proposal is a lump sum. Nothing is persisted: the choice rides on the
 * page's `?mode=` so the printed page and the screen are the same URL. */
export const DEFAULT_PROPOSAL_MODE: ProposalMode = "lump";

export const PROPOSAL_MODE_LABELS: Record<ProposalMode, string> = {
  lump: "Lump sum",
  scope: "By scope",
  itemized: "Itemized",
};

export function parseProposalMode(value: string | string[] | undefined): ProposalMode {
  const one = Array.isArray(value) ? value[0] : value;
  return (PROPOSAL_MODES as readonly string[]).includes(one ?? "") ? (one as ProposalMode) : DEFAULT_PROPOSAL_MODE;
}

const TRADE_SCOPE_LABELS: Record<string, string> = {
  METAL_FRAMING_DRYWALL: "Metal framing & drywall",
  LATH_PLASTER: "Lath & plaster",
  EIFS: "EIFS",
  ACOUSTICAL_CEILINGS: "Acoustical ceilings",
  FIREPROOFING: "Fireproofing",
};

/** A job line as the page already holds it. */
export type ProposalLineInput = {
  id: string;
  description: string;
  unit: string | null;
  quantity: number;
  unitPrice: number | null;
  /** The wall type the line was generated from, when it was. */
  wallType: { code: string; name: string } | null;
  tradeScope: string | null;
};

export type ItemizedRow = {
  id: string;
  description: string;
  quantity: number;
  unit: string | null;
  unitPrice: number | null;
  total: number | null;
};

/** One scope's share of the bid. Deliberately nothing but a name and money. */
export type ScopeRow = { key: string; label: string; amountCents: number };

export type ProposalPresentation =
  | { mode: "itemized"; rows: ItemizedRow[]; total: number; adjustmentCents: number | null }
  | { mode: "scope"; rows: ScopeRow[]; total: number }
  | { mode: "lump"; rows: ScopeRow[]; total: number };

const OTHER_KEY = "other";
function scopeOf(line: ProposalLineInput): { key: string; label: string } {
  if (line.wallType) {
    return { key: `wall:${line.wallType.code}`, label: `${line.wallType.code} — ${line.wallType.name}` };
  }
  if (line.tradeScope) {
    return { key: `trade:${line.tradeScope}`, label: TRADE_SCOPE_LABELS[line.tradeScope] ?? line.tradeScope };
  }
  return { key: OTHER_KEY, label: "Other work" };
}

/** Exact dollars to a number with no float dust, so a floor lands right. */
const exactCents = (dollars: number): number => Number((dollars * 100).toFixed(6));

/**
 * The bid split into scopes, in whole cents that add up to the bid.
 * A cost-only line (no unit price) is in no scope, as it is in no total.
 */
export function scopeSubtotals(
  lines: readonly ProposalLineInput[],
  /** A GC's own price, in cents, when it is not the estimate total. The scope
   * subtotals are then that price split in proportion to each scope's share of
   * the estimate, by the same largest-remainder rule, so they still add up to
   * the printed price to the cent. Omitted, they split the estimate itself. */
  priceCents?: number,
): { rows: ScopeRow[]; totalCents: number } {
  const estimateCents = Math.round(exactCents(bidTotalOf(lines)));
  const targetCents = priceCents ?? estimateCents;

  const groups = new Map<string, { label: string; exact: number }>();
  for (const line of lines) {
    if (line.unitPrice === null) continue;
    const { key, label } = scopeOf(line);
    const group = groups.get(key) ?? { label, exact: 0 };
    group.exact += exactCents(line.quantity * line.unitPrice);
    groups.set(key, group);
  }

  // A price that is not the estimate's own scales every scope's exact share by
  // price / estimate. An estimate of nothing has no shares to scale, so the
  // whole price is one "Other work" row rather than a division by zero.
  if (priceCents !== undefined && priceCents !== estimateCents) {
    const exactSum = [...groups.values()].reduce((sum, group) => sum + group.exact, 0);
    if (exactSum > 0) {
      const factor = priceCents / exactSum;
      for (const group of groups.values()) group.exact *= factor;
    } else {
      groups.clear();
      groups.set(OTHER_KEY, { label: "Other work", exact: priceCents });
    }
  }

  const shares = [...groups.entries()].map(([key, group]) => {
    const floor = Math.floor(Number(group.exact.toFixed(6)));
    return { key, label: group.label, exact: group.exact, floor, remainder: group.exact - floor };
  });

  let assigned = shares.reduce((sum, share) => sum + share.floor, 0);
  const order = [...shares].sort((a, b) => b.remainder - a.remainder || b.exact - a.exact || a.key.localeCompare(b.key));
  let index = 0;
  while (assigned < targetCents && order.length > 0) {
    order[index % order.length].floor += 1;
    assigned += 1;
    index += 1;
  }

  // Named scopes in the order they are first met; "Other work" last.
  const rows = shares
    .map((share) => ({ key: share.key, label: share.label, amountCents: share.floor }))
    .sort((a, b) => Number(a.key === OTHER_KEY) - Number(b.key === OTHER_KEY));
  return { rows, totalCents: targetCents };
}

export function proposalPresentation(
  lines: readonly ProposalLineInput[],
  mode: ProposalMode,
  /** THIS GC'S PRICE in whole cents (`lib/estimating/gc-price.ts`), when the
   * proposal is opened for one invitation. Omitted, every figure is the
   * estimate's own total, exactly as before. */
  priceCents?: number,
): ProposalPresentation {
  const estimateTotal = bidTotalOf(lines);
  const total = priceCents === undefined ? estimateTotal : priceCents / 100;
  if (mode === "itemized") {
    // The lines add up to the ESTIMATE; a GC priced differently gets one more
    // row carrying the difference, so the printed table still adds up to the
    // printed total. `adjustmentCents` is null on a plain proposal.
    const adjustmentCents =
      priceCents === undefined ? null : priceCents - Math.round(exactCents(estimateTotal));
    return {
      mode,
      total,
      adjustmentCents: adjustmentCents === 0 ? null : adjustmentCents,
      rows: lines.map((line) => ({
        id: line.id,
        description: line.description,
        quantity: line.quantity,
        unit: line.unit,
        unitPrice: line.unitPrice,
        total: line.unitPrice !== null ? line.quantity * line.unitPrice : null,
      })),
    };
  }
  const { rows, totalCents } = scopeSubtotals(lines, priceCents);
  if (mode === "scope") return { mode, total: totalCents / 100, rows };
  // One price for the whole scope. Same cents as the split above, summed.
  return { mode, total: totalCents / 100, rows: lines.length ? [{ key: "lump", label: "Lump sum", amountCents: totalCents }] : [] };
}

// ── THE BID FORM'S OWN LINES: ALTERNATES AND UNIT PRICES ──

export type BidFormLineInput = {
  kind: "ALTERNATE" | "UNIT_PRICE" | "ALLOWANCE";
  label: string;
  description: string | null;
  amount: number | null;
  unit: string | null;
  unitPrice: number | null;
};

export type BidFormRow = {
  label: string;
  description: string | null;
  /** The words printed in the price column. "No bid" when the sub left it blank. */
  price: string;
  blank: boolean;
};

export type BidFormSections = { alternates: BidFormRow[]; unitPrices: BidFormRow[]; blankCount: number };

const BLANK = "No bid";

/**
 * The alternates and unit prices the GC's form asked for, as printed.
 *
 * NOTHING IS INVENTED: a blank is printed as a blank ("No bid"), never as $0
 * and never filled from the estimate. Allowances are left out on purpose — they
 * are already INSIDE the base bid (`lib/bid-lines.ts`), and listing one under
 * the price invites the GC to add it twice.
 *
 * `format` is injected so this module needs no money formatter of its own.
 */
export function bidFormSections(
  lines: readonly BidFormLineInput[],
  format: (dollars: number) => string,
): BidFormSections {
  const alternates: BidFormRow[] = [];
  const unitPrices: BidFormRow[] = [];

  for (const line of lines) {
    if (line.kind === "ALTERNATE") {
      const amount = typeof line.amount === "number" && Number.isFinite(line.amount) ? line.amount : null;
      const price =
        amount === null || amount === 0
          ? BLANK
          : amount < 0
            ? `Deduct ${format(Math.abs(amount))}`
            : `Add ${format(amount)}`;
      alternates.push({ label: line.label, description: line.description, price, blank: price === BLANK });
    } else if (line.kind === "UNIT_PRICE") {
      const rate = typeof line.unitPrice === "number" && Number.isFinite(line.unitPrice) ? line.unitPrice : null;
      const per = line.unit?.trim();
      const price = rate === null ? BLANK : per ? `${format(rate)} per ${per}` : format(rate);
      unitPrices.push({ label: line.label, description: line.description, price, blank: rate === null });
    }
  }

  return {
    alternates,
    unitPrices,
    blankCount: [...alternates, ...unitPrices].filter((row) => row.blank).length,
  };
}
