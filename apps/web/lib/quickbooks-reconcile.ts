import { amountToCents, formatUsd, type Cents } from "./quickbooks-sync";

/**
 * What Prova holds against what QuickBooks holds, invoice by invoice.
 *
 * This exists because of a gap the sync was honest about but did nothing
 * with. The sync is one-directional: an edit made inside QuickBooks is
 * refused rather than absorbed, which is correct — overwriting a person's
 * edit is how every platform in the contractor-software research ends up
 * "silently diverging". But refusing an edit and never mentioning it again
 * is only half an answer. An invoice was changed to $200.00 in QuickBooks
 * while Prova showed $123.45, and nothing anywhere said so until someone
 * happened to press a button.
 *
 * So: this READS both sides and reports. It does not write, and it must
 * not — a reconciliation view that quietly fixes things is a two-way sync
 * wearing a disguise, and the whole design rests on not pretending to be
 * one.
 *
 * Nothing here is stored either. A cached "in sync" flag is wrong the
 * instant either side changes, which is the same rule this schema applies
 * to every other derived value.
 */

export type ReconcileStatus =
  /** Both sides agree on every compared field. */
  | "MATCHES"
  /** Both exist, and something differs. The interesting case. */
  | "DIFFERS"
  /** We hold a link, QuickBooks has nothing at that id — deleted or voided there. */
  | "MISSING_IN_QUICKBOOKS"
  /** Never pushed. Not a disagreement, but it is "not in QuickBooks". */
  | "NEVER_SENT";

export type ProvaInvoiceSide = {
  invoiceId: string;
  number: number;
  jobName: string;
  totalCents: Cents;
  /** Null when this invoice has never been pushed. */
  qboId: string | null;
  /** When a push last read the record back and found it matching. */
  lastVerifiedAt: Date | null;
};

export type QuickBooksInvoiceSide = {
  qboId: string;
  totalCents: Cents;
  docNumber: string | null;
  /** QuickBooks keeps voided invoices with a zero total and a VOID marker
   * rather than deleting them; treated as a difference, not as missing. */
  voided: boolean;
};

export type Reconciliation = {
  invoiceId: string;
  number: number;
  jobName: string;
  status: ReconcileStatus;
  ourTotalCents: Cents;
  theirTotalCents: Cents | null;
  qboId: string | null;
  lastVerifiedAt: Date | null;
  /** Plain sentences, not field names. Empty unless status is DIFFERS. */
  differences: string[];
};

/**
 * Compares one invoice.
 *
 * Compared in cents, and only on what can actually cost someone money or
 * hide a document: the total, and whether QuickBooks still has it at all.
 *
 * Deliberately NOT compared: line counts and descriptions. QuickBooks
 * legitimately adds its own lines (tax, discounts) and a bookkeeper may
 * reasonably retitle something. Flagging those would fill this view with
 * noise, and a reconciliation view people learn to ignore is worse than
 * none — that is the same reasoning the push-time verification uses.
 */
export function reconcileInvoice(
  ours: ProvaInvoiceSide,
  theirs: QuickBooksInvoiceSide | null,
): Reconciliation {
  const base = {
    invoiceId: ours.invoiceId,
    number: ours.number,
    jobName: ours.jobName,
    ourTotalCents: ours.totalCents,
    qboId: ours.qboId,
    lastVerifiedAt: ours.lastVerifiedAt,
  };

  if (ours.qboId === null) {
    return { ...base, status: "NEVER_SENT", theirTotalCents: null, differences: [] };
  }

  if (theirs === null) {
    return {
      ...base,
      status: "MISSING_IN_QUICKBOOKS",
      theirTotalCents: null,
      differences: [],
    };
  }

  const differences: string[] = [];

  if (theirs.voided) {
    differences.push("It has been voided in QuickBooks.");
  }

  if (ours.totalCents !== theirs.totalCents) {
    differences.push(
      `Prova has ${formatUsd(ours.totalCents)}, QuickBooks has ${formatUsd(theirs.totalCents)}.`,
    );
  }

  return {
    ...base,
    status: differences.length === 0 ? "MATCHES" : "DIFFERS",
    theirTotalCents: theirs.totalCents,
    differences,
  };
}

/**
 * The whole company's invoices against QuickBooks, worst first.
 *
 * Order matters more than it looks: a disagreement about money is what
 * someone needs to see, an invoice QuickBooks no longer has is next, and
 * everything else is reassurance. Sorting alphabetically or by date would
 * bury the two rows that are the reason to open this page at all.
 */
const STATUS_ORDER: Record<ReconcileStatus, number> = {
  DIFFERS: 0,
  MISSING_IN_QUICKBOOKS: 1,
  NEVER_SENT: 2,
  MATCHES: 3,
};

export function reconcileAll(
  ours: ProvaInvoiceSide[],
  theirsById: Map<string, QuickBooksInvoiceSide>,
): Reconciliation[] {
  return ours
    .map((invoice) =>
      reconcileInvoice(
        invoice,
        invoice.qboId === null ? null : (theirsById.get(invoice.qboId) ?? null),
      ),
    )
    .sort((a, b) => {
      const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      if (byStatus !== 0) return byStatus;
      // Within a status, biggest disagreement first — a $4,000 gap matters
      // more than a $2 one and should not be below it by accident.
      const gap = (r: Reconciliation) =>
        r.theirTotalCents === null ? 0 : Math.abs(r.ourTotalCents - r.theirTotalCents);
      const byGap = gap(b) - gap(a);
      if (byGap !== 0) return byGap;
      return a.number - b.number;
    });
}

export function summarizeReconciliation(rows: Reconciliation[]) {
  const count = (status: ReconcileStatus) => rows.filter((r) => r.status === status).length;
  return {
    differs: count("DIFFERS"),
    missing: count("MISSING_IN_QUICKBOOKS"),
    neverSent: count("NEVER_SENT"),
    matches: count("MATCHES"),
    total: rows.length,
    /** True when nothing needs a human. Computed, never stored — a cached
     * version of this is wrong the moment either side changes. */
    allAgree: count("DIFFERS") === 0 && count("MISSING_IN_QUICKBOOKS") === 0,
  };
}

/** Parses what the QuickBooks query returns into the side this compares.
 * Kept here so the shape QuickBooks actually sends is asserted in tests
 * rather than assumed — the lesson from a payload shape nobody checked. */
export function quickBooksSideFrom(raw: {
  Id: string;
  TotalAmt?: number;
  DocNumber?: string;
  /** QuickBooks marks a voided invoice in its private note rather than with
   * a dedicated field, which is not obvious and is easy to miss. */
  PrivateNote?: string;
}): QuickBooksInvoiceSide {
  return {
    qboId: raw.Id,
    totalCents: amountToCents(raw.TotalAmt ?? 0),
    docNumber: raw.DocNumber ?? null,
    voided: (raw.PrivateNote ?? "").toUpperCase().includes("VOIDED"),
  };
}
