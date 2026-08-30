/**
 * Turning a Prova invoice into a QuickBooks invoice, and checking that what
 * landed is what we sent.
 *
 * The contractor-software research this project is built against found
 * accounting sync to be the single most-corroborated failure in the market
 * — six platforms, ten-plus independent sources, always the same shape:
 * "batches transfer with wrong amounts," "two way sync does not work in
 * many areas," "it doesn't work, we ended up just not trying anymore."
 *
 * Two design commitments follow from that, and both live in this file.
 *
 * ONE DIRECTION, HONESTLY. This pushes to QuickBooks. It does not claim to
 * pull. Every platform in that research advertises bidirectional sync and
 * is savaged because it isn't really one, and a sync that quietly loses an
 * edit made in QuickBooks is worse than one that never promised to carry it.
 *
 * A PUSH IS NOT EVIDENCE. Every write is followed by reading the record
 * back and comparing it. This project has already been burned once by a
 * tool reporting "successfully applied" against a database nobody read;
 * money deserves at least that much suspicion.
 *
 * Everything here is pure. No network, no Prisma — so the arithmetic and
 * the comparison can be tested without a QuickBooks sandbox, which is the
 * part that would otherwise only be verifiable in production.
 */

/** Cents, as an integer. Money never travels through this file as a float:
 * 0.1 + 0.2 is the oldest bug in accounting software. */
export type Cents = number;

export type InvoiceLineToPush = {
  /** Our JobLineItem id — becomes the QuickBooks line description anchor. */
  lineItemId: string;
  description: string;
  /** Work completed this period, in cents. */
  billedCents: Cents;
  /** Materials stored this period, in cents. Separate line in QuickBooks
   * because it is separate money on a G703 and folding them together makes
   * the pay application and the ledger disagree. */
  materialsStoredCents: Cents;
};

export type InvoiceToPush = {
  invoiceId: string;
  /** Our invoice number, scoped to the job. */
  number: number;
  jobName: string;
  /** The GC being billed. */
  customerQboId: string;
  issuedOn: string;
  dueOn: string | null;
  memo: string | null;
  totalCents: Cents;
  retainageWithheldCents: Cents;
  lines: InvoiceLineToPush[];
};

export type QboLine = {
  Description: string;
  Amount: number;
  DetailType: "SalesItemLineDetail";
  /**
   * ItemRef is REQUIRED, not optional.
   *
   * It was optional, every caller omitted it, and QuickBooks rejected every
   * invoice with "Required parameter Line.SalesItemLineDetail is missing"
   * — an empty object reads as absent. Making it required means the
   * compiler refuses the payload that failed, rather than a test having to
   * remember to check for it.
   */
  SalesItemLineDetail: { ItemRef: { value: string }; TaxCodeRef?: { value: string } };
};

export type QboInvoicePayload = {
  CustomerRef: { value: string };
  DocNumber: string;
  TxnDate: string;
  DueDate?: string;
  PrivateNote?: string;
  Line: QboLine[];
  /** Present only on an update; QuickBooks rejects a stale token, which is
   * the behaviour we want — see the note in the schema. */
  Id?: string;
  SyncToken?: string;
  sparse?: boolean;
};

export function centsToAmount(cents: Cents): number {
  return Math.round(cents) / 100;
}

export function amountToCents(amount: number): Cents {
  return Math.round(amount * 100);
}

/**
 * The document number QuickBooks shows.
 *
 * Job-scoped invoice numbers collide across jobs — two jobs both have an
 * invoice 1 — and QuickBooks DocNumber is company-wide. Prefixing with a
 * short, stable slice of the job's identity keeps them distinct without
 * inventing a second numbering scheme that would then need its own counter.
 */
export function docNumberFor(invoice: Pick<InvoiceToPush, "invoiceId" | "number">): string {
  return `${invoice.invoiceId.slice(-6).toUpperCase()}-${invoice.number}`;
}

/**
 * A key that is the same for every retry of the same logical push, and
 * different the moment the invoice's money changes.
 *
 * This is the specific defence against the failure every competitor is
 * criticised for — a retry posting a second copy. Including the total and
 * the line count means a genuine edit produces a new key (so the update is
 * a real update), while a network timeout and its retry produce the same
 * one.
 */
export function idempotencyKeyFor(invoice: InvoiceToPush): string {
  const lineFingerprint = invoice.lines
    .map((l) => `${l.lineItemId}:${l.billedCents}:${l.materialsStoredCents}`)
    .sort()
    .join("|");
  return [
    "invoice",
    invoice.invoiceId,
    invoice.totalCents,
    invoice.lines.length,
    hash(lineFingerprint),
  ].join(":");
}

/** A small, stable, non-cryptographic digest — this identifies a payload,
 * it does not protect one. */
function hash(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/**
 * Builds the QuickBooks payload.
 *
 * Retainage is deliberately NOT deducted from the invoice total here. On a
 * subcontractor's pay application the full value of work completed is
 * earned and invoiced; retainage is money withheld from payment against it,
 * not a reduction of the amount billed. Netting it into the invoice would
 * make the ledger disagree with the G702 the GC signed, and would make
 * retainage invisible in QuickBooks exactly when someone needs to chase it.
 * It rides in the memo so a bookkeeper can see it without doing arithmetic.
 */
export function buildInvoicePayload(
  invoice: InvoiceToPush,
  options: {
    /**
     * The QuickBooks Product/Service ITEM every line is booked against.
     *
     * Not an Account id — a distinction that cost a whole test run. The
     * chart-of-accounts mapping stores an Account; QuickBooks invoice lines
     * reference an Item, which in turn posts to an account. Passing the
     * account id here would be a different failure, not a fix.
     *
     * Required, because the version where it was optional shipped with no
     * caller supplying it and every push was rejected.
     */
    incomeItemId: string;
    existing?: { qboId: string; syncToken: string };
  },
): QboInvoicePayload {
  const itemRef = { ItemRef: { value: options.incomeItemId } };

  const lines: QboLine[] = [];
  for (const line of invoice.lines) {
    if (line.billedCents !== 0) {
      lines.push({
        Description: line.description,
        Amount: centsToAmount(line.billedCents),
        DetailType: "SalesItemLineDetail",
        SalesItemLineDetail: { ...itemRef },
      });
    }
    // Its own line, never folded into the one above: on a G703 these are
    // two columns, and a bookkeeper reconciling stored materials needs to
    // see the same split the GC saw.
    if (line.materialsStoredCents !== 0) {
      lines.push({
        Description: `${line.description} — materials stored`,
        Amount: centsToAmount(line.materialsStoredCents),
        DetailType: "SalesItemLineDetail",
        SalesItemLineDetail: { ...itemRef },
      });
    }
  }

  // A lump-sum invoice has no per-line breakdown; one line carrying the
  // whole amount is honest, and matches what the GC was sent.
  if (lines.length === 0) {
    lines.push({
      Description: invoice.memo?.trim() || `${invoice.jobName} — invoice ${invoice.number}`,
      Amount: centsToAmount(invoice.totalCents),
      DetailType: "SalesItemLineDetail",
      SalesItemLineDetail: { ...itemRef },
    });
  }

  const memoParts = [`${invoice.jobName} — Prova invoice ${invoice.number}`];
  if (invoice.retainageWithheldCents > 0) {
    memoParts.push(
      `Retainage withheld: ${formatUsd(invoice.retainageWithheldCents)} (not deducted from this invoice)`,
    );
  }
  if (invoice.memo?.trim()) memoParts.push(invoice.memo.trim());

  const payload: QboInvoicePayload = {
    CustomerRef: { value: invoice.customerQboId },
    DocNumber: docNumberFor(invoice),
    TxnDate: invoice.issuedOn,
    PrivateNote: memoParts.join(" · "),
    Line: lines,
  };
  if (invoice.dueOn) payload.DueDate = invoice.dueOn;
  if (options.existing) {
    payload.Id = options.existing.qboId;
    payload.SyncToken = options.existing.syncToken;
    payload.sparse = false;
  }
  return payload;
}

export function formatUsd(cents: Cents): string {
  return `$${(Math.round(cents) / 100).toFixed(2)}`;
}

/** The subset of a QuickBooks invoice we read back to check ourselves. */
export type QboInvoiceReadback = {
  Id: string;
  SyncToken?: string;
  DocNumber?: string;
  TotalAmt?: number;
  Line?: { Amount?: number }[];
};

export type VerificationResult =
  | { ok: true }
  | { ok: false; problems: string[] };

/**
 * Did what land match what we sent?
 *
 * Compared in cents, and on the two things that can actually hurt someone:
 * the total, and the document number. A total that differs is the exact
 * "batches transferred with incorrect, doubled figures" complaint from the
 * research; a DocNumber that differs means QuickBooks renumbered the
 * document and our link now points at something the contractor cannot find.
 *
 * Line COUNT is checked but line contents are not: QuickBooks legitimately
 * adds its own lines (discounts, tax) and failing on that would train
 * people to ignore this.
 */
export function verifyPushedInvoice(
  sent: QboInvoicePayload,
  got: QboInvoiceReadback,
): VerificationResult {
  const problems: string[] = [];

  const sentTotal = sent.Line.reduce((sum, l) => sum + amountToCents(l.Amount), 0);
  const gotTotal =
    got.TotalAmt !== undefined
      ? amountToCents(got.TotalAmt)
      : (got.Line ?? []).reduce((sum, l) => sum + amountToCents(l.Amount ?? 0), 0);

  if (sentTotal !== gotTotal) {
    problems.push(
      `Total differs: sent ${formatUsd(sentTotal)}, QuickBooks holds ${formatUsd(gotTotal)}.`,
    );
  }
  if (got.DocNumber !== undefined && got.DocNumber !== sent.DocNumber) {
    problems.push(
      `Document number differs: sent ${sent.DocNumber}, QuickBooks assigned ${got.DocNumber}.`,
    );
  }
  if (got.Line !== undefined && got.Line.length < sent.Line.length) {
    problems.push(
      `QuickBooks holds ${got.Line.length} lines; ${sent.Line.length} were sent.`,
    );
  }

  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}

/** What must be true before a push is even attempted. Returned as reasons
 * rather than thrown, so the UI can say which one is missing. */
export function pushBlockers(input: {
  hasConnection: boolean;
  customerQboId: string | null;
  incomeAccountId: string | null;
  totalCents: Cents;
}): string[] {
  const blockers: string[] = [];
  if (!input.hasConnection) blockers.push("QuickBooks isn't connected.");
  if (!input.customerQboId) {
    blockers.push("This job's GC isn't linked to a QuickBooks customer yet.");
  }
  if (!input.incomeAccountId) {
    blockers.push(
      "No QuickBooks account is mapped for invoice revenue — set one under Settings → Chart of accounts.",
    );
  }
  if (input.totalCents <= 0) {
    blockers.push("An invoice for zero or less can't be pushed.");
  }
  return blockers;
}
