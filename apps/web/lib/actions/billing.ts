"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { putDocument } from "@/lib/blob";
import { linkToken } from "@/lib/tokens";
import { requireCompanyContext } from "@/lib/auth";
import { Prisma, prisma } from "@prova/db";
import { revokeToken, refreshTokens, getCompanyInfo, generateWipNarrative, type QuickBooksCompanyInfo } from "@prova/integrations";
import { calculateLineItemWip, calculateJobWip } from "@/lib/wip";
import { MIN_EARNED_COVERAGE } from "@/lib/company-financials";
import { payAppEntryError, payApplicationFingerprint } from "@/lib/pay-application";
import { DUPLICATE_WRITE_WINDOW_MS, isRepeatOf, moneyPart } from "@/lib/duplicate-writes";
import { lockAgainstDuplicates } from "./duplicates";
import {
  actionFail,
  actionOk,
  type ActionResult,
  assertJobInCompany,
  assertLineItemOnJob,
  assertOwner,
  decimalFromForm,
  enumFromForm,
  INVOICE_STATUSES,
  nullableDecimalFromForm,
  type ActionResultWith,
} from "./shared";

/**
 * Creates a client-signing link for a job's contract. Only while ESTIMATE —
 * this is signing the estimate that becomes the contract, not something you
 * re-sign after the fact. Idempotent: if an unsigned request already
 * exists, reuses it instead of spawning a second link.
 *
 * The token is generated HERE, by `linkToken()`, and not by the schema. It
 * used to be `@default(cuid())` — an identifier generator standing as the
 * sole access control on an unauthenticated page that renders the contract
 * and will legally sign it. Same generator as the portal link now, which is
 * what the schema comment always claimed. `token` has no default any more,
 * so a create that forgets it fails to typecheck rather than quietly issuing
 * a weak one.
 */
export async function createSignatureRequest(jobId: string) {
  const { company } = await requireCompanyContext();
  const job = await assertJobInCompany(jobId, company.id);

  if (job.status !== "ESTIMATE") {
    throw new Error("This job is already contracted");
  }

  const existing = await prisma.signatureRequest.findFirst({
    where: { jobId, status: "PENDING" },
  });
  if (!existing) {
    await prisma.signatureRequest.create({ data: { jobId, token: linkToken() } });
  }

  revalidatePath(`/jobs/${jobId}`);
}

/**
 * Public action — no requireCompanyContext(). The client signing a
 * contract has no account; the unguessable token in the URL is the access
 * control. Captures signer name, IP, user agent, and an immutable snapshot
 * of what was signed at this moment (audit-only — see SignatureRequest in
 * schema.prisma and ARCHITECTURE.md).
 */
export async function signRequest(token: string, formData: FormData) {
  const request = await prisma.signatureRequest.findUnique({
    where: { token },
    include: { job: { include: { company: true, contact: true } } },
  });
  if (!request) {
    throw new Error("Signing link not found");
  }
  if (request.status === "SIGNED") {
    throw new Error("This contract has already been signed");
  }

  const signerName = String(formData.get("signerName") ?? "").trim();
  const signerEmail = String(formData.get("signerEmail") ?? "").trim();
  const agreed = formData.get("agree") === "on";
  if (!signerName) {
    throw new Error("Name is required");
  }
  if (!agreed) {
    throw new Error("You must confirm you agree before signing");
  }

  const headerList = await headers();
  const forwardedFor = headerList.get("x-forwarded-for");
  const ipAddress = forwardedFor ? forwardedFor.split(",")[0].trim() : null;
  const userAgent = headerList.get("user-agent");

  const lineItems = await prisma.jobLineItem.findMany({
    where: { jobId: request.jobId, isDeleted: false },
    orderBy: { createdAt: "asc" },
  });
  const total = lineItems.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unitPrice), 0);

  const snapshot = {
    companyName: request.job.company.name,
    jobName: request.job.name,
    clientName: request.job.contact.name,
    scope: request.job.scope,
    total,
    lineItems: lineItems.map((item) => ({
      description: item.description,
      quantity: item.quantity.toString(),
      unit: item.unit,
      unitPrice: item.unitPrice?.toString() ?? null,
    })),
  };

  await prisma.signatureRequest.update({
    where: { id: request.id },
    data: {
      status: "SIGNED",
      signedAt: new Date(),
      signerName,
      signerEmail: signerEmail || null,
      ipAddress,
      userAgent,
      snapshot,
    },
  });

  revalidatePath(`/esign/${token}`);
  revalidatePath(`/jobs/${request.jobId}`);
}

/**
 * Generates the client's portal access link. Idempotent — if a token
 * already exists, does nothing. Same access-control pattern as
 * SignatureRequest: no client login, the unguessable token is the login.
 */
export async function enablePortalAccess(contactId: string) {
  const { company } = await requireCompanyContext();

  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact || contact.companyId !== company.id) {
    throw new Error("Contact not found");
  }
  if (contact.portalToken) {
    return;
  }

  await prisma.contact.update({ where: { id: contactId }, data: { portalToken: linkToken() } });

  revalidatePath(`/contacts/${contactId}`);
}

/**
 * Issues the next invoice number for a job.
 *
 * Reads nothing from Invoice on purpose. This used to be `max(number) + 1`,
 * which CLAUDE.md's counter rule forbids by name and for a reason this
 * feature makes concrete: delete a job's newest invoice and the next one
 * reissues its number, so "Invoice 4" names two different bills — and the
 * GC is holding both. `InvoiceCounter` only ever increments, and it is
 * bumped inside the same transaction as the insert so two submissions
 * cannot read the same value. Same shape as issueRfiNumber and
 * issueSubmittalNumber.
 *
 * Existing jobs were seeded from their highest invoice number by the
 * migration that added the table, so the create branch below starting at 1
 * only ever applies to a job with no invoices at all.
 */
async function issueInvoiceNumber(tx: Prisma.TransactionClient, jobId: string) {
  const counter = await tx.invoiceCounter.upsert({
    where: { jobId },
    create: { jobId, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
    select: { lastNumber: true },
  });
  return counter.lastNumber;
}

/** Bills the client. Only once a job is CONTRACTED or later — you don't
 * invoice an estimate nobody has agreed to yet.
 *
 * A repeat of the same bill within a couple of minutes is treated as the
 * same click and does nothing (#102). SILENTLY, and that is a deliberate
 * choice rather than an oversight: this action is wired to a plain
 * `<form action>` in a server component, so it has no way to return a
 * sentence anybody would see, and a `throw` would be redacted to a digest
 * in production and take the page down through the error boundary. The
 * truthful outcome of a double-click is the one invoice that already
 * exists, and the revalidate below is what puts it on screen. Where the
 * call site CAN render a message — submitPayApplication, createBackcharge
 * — it gets one instead of silence. */
export async function createInvoice(jobId: string, formData: FormData) {
  const { company } = await requireCompanyContext();
  const job = await assertJobInCompany(jobId, company.id);

  if (job.status === "ESTIMATE") {
    throw new Error("Contract this job before invoicing it");
  }

  const description = String(formData.get("description") ?? "").trim();
  const amount = decimalFromForm(formData, "amount");
  const dueRaw = String(formData.get("dueAt") ?? "").trim();
  const dueAt = dueRaw ? new Date(dueRaw) : null;

  // Snapshotted from the job's current rate, not recomputed later if the
  // rate changes -- see Invoice.retainageWithheld.
  const retainageWithheld =
    job.retainagePercent != null ? (Number(amount) * (Number(job.retainagePercent) / 100)).toFixed(2) : null;

  await prisma.$transaction(async (tx) => {
    await lockAgainstDuplicates(tx, "invoice", [jobId, description, moneyPart(amount), dueAt]);

    const prior = await tx.invoice.findFirst({
      where: { jobId, description: description || null, amount, dueAt },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    // Before the number is issued, not after: refusing later would still
    // burn a number the counter never reissues, leaving a gap in the log
    // with nothing to explain it.
    if (isRepeatOf(prior?.createdAt, new Date())) return;

    await tx.invoice.create({
      data: {
        jobId,
        number: await issueInvoiceNumber(tx, jobId),
        description: description || null,
        amount,
        dueAt,
        retainageWithheld,
      },
    });
  });

  revalidatePath(`/jobs/${jobId}`);
}

/** Submits a full AIA-style pay application: one row per active line item
 * (this period billed + materials stored), rather than a single lump sum.
 * The invoice amount is computed from the breakdown, not entered directly —
 * a pay application's total IS the sum of what's billed per SOV line, so
 * there's nothing to reconcile against a separately-typed number. Rows
 * where both fields are blank/zero are dropped; at least one line must
 * have an amount.
 *
 * A NEGATIVE materials-stored entry is legitimate and is the documented way
 * to move value out of "stored" once the material is installed (see
 * billing.prisma). That is why the drop filter tests `!== 0` rather than
 * `> 0`: a row whose only content is the negative release is the whole
 * point of the entry, and dropping it re-introduces #95's double bill.
 *
 * Returns an ActionResult rather than throwing its guard messages —
 * production REDACTS thrown Server Action messages, so a refusal that
 * throws shows the user an opaque digest while the $140,000 application
 * they were trying to submit is simply not created, with no explanation. */
export async function submitPayApplication(jobId: string, formData: FormData): Promise<ActionResult> {
  const { company } = await requireCompanyContext();
  const job = await assertJobInCompany(jobId, company.id);

  if (job.status === "ESTIMATE") {
    return actionFail("Contract this job before invoicing it");
  }

  const lineItemIds = formData.getAll("lineItemId").map(String);
  const thisPeriodValues = formData.getAll("thisPeriodBilled").map(String);
  const materialsStoredValues = formData.getAll("materialsStoredValue").map(String);

  const rows = lineItemIds
    .map((lineItemId, i) => ({
      lineItemId,
      thisPeriodBilled: Number(thisPeriodValues[i] || "0") || 0,
      materialsStoredValue: Number(materialsStoredValues[i] || "0") || 0,
    }))
    .filter((row) => row.thisPeriodBilled !== 0 || row.materialsStoredValue !== 0);

  if (rows.length === 0) {
    return actionFail("Enter an amount for at least one line item");
  }

  for (const row of rows) {
    await assertLineItemOnJob(row.lineItemId, jobId);
  }

  // Prior-period context this action never used to fetch. Two narrow reads
  // before the write, both outside any transaction, because the Neon pooled
  // connection limit is 5 and these validate the numbers a person typed
  // rather than deciding whether to insert.
  //
  // This comment used to claim Invoice's @@unique([jobId, number]) was what
  // stopped two concurrent submissions from both landing. It never did two
  // useful things and now does neither. It could only ever fire when both
  // submissions computed the SAME number, which is a property of the old
  // `max(number) + 1`, not of the duplicate; and when it did fire it threw
  // an uncaught P2002 — a raw 500 on a $140,000 pay application, the exact
  // shape of the dead guards in #25 and #26. Numbers now come from
  // InvoiceCounter, so two submissions get two numbers, and what actually
  // stops the second one is the advisory lock and fingerprint check in the
  // transaction below.
  const sovLines = await prisma.jobLineItem.findMany({
    where: { jobId },
    select: { id: true, description: true, quantity: true, unitPrice: true },
  });
  const sovById = new Map(sovLines.map((line) => [line.id, line]));

  // At creation time this invoice is the newest on the job, so every
  // existing InvoiceLineItem row is "previous" by definition.
  const priorRows = await prisma.invoiceLineItem.findMany({
    where: { invoice: { jobId } },
    select: { lineItemId: true, thisPeriodBilled: true, materialsStoredValue: true },
  });

  const entryErrors = rows
    .map((row) => {
      const line = sovById.get(row.lineItemId);
      const prior = priorRows.filter((p) => p.lineItemId === row.lineItemId);
      return payAppEntryError({
        lineItemId: row.lineItemId,
        description: line?.description ?? "This line item",
        // Same expression the job page and the report use for a live line.
        scheduledValue: line ? Number(line.quantity) * Number(line.unitPrice ?? 0) : 0,
        previousBilled: prior.reduce((sum, p) => sum + Number(p.thisPeriodBilled), 0),
        thisPeriodBilled: row.thisPeriodBilled,
        previousMaterialsStored: prior.reduce((sum, p) => sum + Number(p.materialsStoredValue), 0),
        materialsStoredValue: row.materialsStoredValue,
      });
    })
    .filter((message): message is string => message != null);

  if (entryErrors.length > 0) {
    // All or nothing. A partially-accepted pay application is a worse
    // artifact than a rejected one, and this document leaves the company.
    return actionFail(entryErrors.join(" "));
  }

  const description = String(formData.get("description") ?? "").trim();
  const dueRaw = String(formData.get("dueAt") ?? "").trim();
  const dueAt = dueRaw ? new Date(dueRaw) : null;

  const amount = rows.reduce((sum, row) => sum + row.thisPeriodBilled + row.materialsStoredValue, 0);
  const retainageWithheld =
    job.retainagePercent != null ? ((amount * Number(job.retainagePercent)) / 100).toFixed(2) : null;

  // The submission's own identity, and the whole of the repeat guard below.
  const fingerprint = payApplicationFingerprint(rows);

  const duplicate = await prisma.$transaction(async (tx) => {
    // FIRST statement in the transaction. The check that follows is a
    // SELECT under READ COMMITTED, where two simultaneous submissions both
    // see nothing and both insert; this serializes them so the second one
    // looks after the first has landed. See lib/actions/duplicates.ts.
    await lockAgainstDuplicates(tx, "payApplication", [jobId, fingerprint]);

    const recent = await tx.invoice.findMany({
      where: { jobId, createdAt: { gte: new Date(Date.now() - DUPLICATE_WRITE_WINDOW_MS) } },
      select: {
        number: true,
        lineItems: { select: { lineItemId: true, thisPeriodBilled: true, materialsStoredValue: true } },
      },
    });
    const alreadySubmitted = recent.find(
      (invoice) =>
        invoice.lineItems.length > 0 &&
        payApplicationFingerprint(
          invoice.lineItems.map((line) => ({
            lineItemId: line.lineItemId,
            thisPeriodBilled: line.thisPeriodBilled.toString(),
            materialsStoredValue: line.materialsStoredValue.toString(),
          })),
        ) === fingerprint,
    );
    if (alreadySubmitted) return alreadySubmitted.number;

    await tx.invoice.create({
      data: {
        jobId,
        // Issued only once the repeat guard has passed. Issuing it first
        // and refusing afterwards would burn a number InvoiceCounter never
        // reissues, and leave the GC's invoice sequence with an unexplained
        // gap for a click that produced nothing.
        number: await issueInvoiceNumber(tx, jobId),
        description: description || null,
        amount: amount.toFixed(2),
        dueAt,
        retainageWithheld,
        lineItems: {
          create: rows.map((row) => ({
            lineItemId: row.lineItemId,
            thisPeriodBilled: row.thisPeriodBilled.toFixed(2),
            materialsStoredValue: row.materialsStoredValue.toFixed(2),
          })),
        },
      },
    });
    return null;
  });

  revalidatePath(`/jobs/${jobId}`);

  // This call site is a client component that renders the failure, so it
  // gets a sentence rather than the silence createInvoice has to settle
  // for — and the sentence names the application that already exists, so
  // the person can go and look at it.
  if (duplicate !== null) {
    return actionFail(
      `Pay application #${duplicate} on this job was already submitted with these same amounts a moment ago. ` +
        `Nothing was billed twice. Check the pay applications list — it should be there now.`,
    );
  }

  return actionOk;
}

/** Sets this job's retainage rate and expected substantial-completion
 * date. Only affects future invoices -- see Invoice.retainageWithheld. */
export async function updateJobRetainageTerms(jobId: string, formData: FormData) {
  const { company } = await requireCompanyContext();
  await assertJobInCompany(jobId, company.id);

  const retainagePercent = nullableDecimalFromForm(formData, "retainagePercent");
  const completionRaw = String(formData.get("substantialCompletionDate") ?? "").trim();
  const substantialCompletionDate = completionRaw ? new Date(completionRaw) : null;

  await prisma.job.update({
    where: { id: jobId },
    data: { retainagePercent, substantialCompletionDate },
  });

  revalidatePath(`/jobs/${jobId}`);
}

async function assertInvoiceInCompany(invoiceId: string, companyId: string) {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { job: true } });
  if (!invoice || invoice.job.companyId !== companyId) {
    throw new Error("Invoice not found");
  }
  return invoice;
}

/** Sets where a pay application stands with the GC — see InvoiceStatus in
 * schema.prisma for why this is a plain field rather than derived from
 * payment totals. */
export async function updateInvoiceStatus(jobId: string, invoiceId: string, formData: FormData) {
  const { company } = await requireCompanyContext();
  await assertJobInCompany(jobId, company.id);
  const invoice = await assertInvoiceInCompany(invoiceId, company.id);
  if (invoice.jobId !== jobId) {
    throw new Error("Invoice not found on this job");
  }

  const status = enumFromForm(formData, "status", INVOICE_STATUSES);

  await prisma.invoice.update({ where: { id: invoiceId }, data: { status } });

  revalidatePath(`/jobs/${jobId}`);
}

/** Logs a payment received against an invoice. Not a charge — just a
 * record (check, cash, card handled elsewhere). Supports partial payments;
 * an invoice's balance is always amount - SUM(payments.amount).
 *
 * The worst duplicate in the app, and the reason #102 was filed. $10,000
 * logged twice against a $20,000 invoice makes the balance zero, and
 * `calculateArAgingInvoice` returns null for a balance of zero or less — so
 * the invoice drops out of A/R aging, out of `totalOutstanding` and out of
 * the cash forecast while $10,000 is still owed. Nothing anywhere renders a
 * negative balance, so there is no symptom at all: the money simply stops
 * being chased.
 *
 * An identical payment on the same invoice within a couple of minutes is
 * therefore read as the same click and does nothing. Silent, for the same
 * reason createInvoice is silent — a plain `<form action>` in a server
 * component has nowhere to put a sentence — and safe, because two separate
 * cheques for the same amount from the same GC arriving within two minutes
 * of each other is not a thing that happens; if it somehow did, entering
 * the second one a minute later records it. */
export async function logPayment(jobId: string, invoiceId: string, formData: FormData) {
  const { company } = await requireCompanyContext();
  await assertJobInCompany(jobId, company.id);
  const invoice = await assertInvoiceInCompany(invoiceId, company.id);
  if (invoice.jobId !== jobId) {
    throw new Error("Invoice not found on this job");
  }

  const amount = decimalFromForm(formData, "amount");
  const method = String(formData.get("method") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();

  await prisma.$transaction(async (tx) => {
    await lockAgainstDuplicates(tx, "payment", [invoiceId, moneyPart(amount), method, note]);

    const prior = await tx.payment.findFirst({
      where: { invoiceId, amount, method: method || null, note: note || null },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (isRepeatOf(prior?.createdAt, new Date())) return;

    await tx.payment.create({
      data: { invoiceId, amount, method: method || null, note: note || null },
    });
  });

  revalidatePath(`/jobs/${jobId}`);
}

/** Removes a mistaken payment entry. */
export async function deletePayment(jobId: string, paymentId: string) {
  const { company } = await requireCompanyContext();
  await assertJobInCompany(jobId, company.id);

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { invoice: { include: { job: true } } },
  });
  if (!payment || payment.invoice.job.companyId !== company.id || payment.invoice.jobId !== jobId) {
    throw new Error("Payment not found");
  }

  await prisma.payment.delete({ where: { id: paymentId } });

  revalidatePath(`/jobs/${jobId}`);
}

/** Records retainage actually paid back to the sub -- a lump sum against
 * the job's accumulated withheld balance, not against any one invoice.
 * See RetainageRelease in schema.prisma.
 *
 * Logged twice, this says money came back that did not: the outstanding
 * retainage balance is withheld minus SUM(releases), so a duplicated
 * $30,000 release reports $30,000 already recovered that is still sitting
 * with the GC — and retainage is the money a sub chases hardest and
 * longest. Same accidental-repeat guard, same silence, same reason for it
 * as logPayment above. */
export async function createRetainageRelease(jobId: string, formData: FormData) {
  const { company, ...user } = await requireCompanyContext();
  await assertJobInCompany(jobId, company.id);

  const amount = decimalFromForm(formData, "amount");
  const releasedRaw = String(formData.get("releasedAt") ?? "").trim();
  const releasedAt = releasedRaw ? new Date(releasedRaw) : new Date();
  const note = String(formData.get("note") ?? "").trim();

  await prisma.$transaction(async (tx) => {
    await lockAgainstDuplicates(tx, "retainageRelease", [jobId, moneyPart(amount), note]);

    // `releasedAt` is deliberately NOT part of the match. It defaults to
    // `new Date()` when the field is left blank, so two clicks a second
    // apart carry two different instants and matching on it would make the
    // guard miss exactly the case it exists for.
    const prior = await tx.retainageRelease.findFirst({
      where: { jobId, amount, note: note || null },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (isRepeatOf(prior?.createdAt, new Date())) return;

    await tx.retainageRelease.create({
      data: { jobId, amount, releasedAt, note: note || null, createdByUserId: user.id },
    });
  });

  revalidatePath(`/jobs/${jobId}`);
}

export async function deleteRetainageRelease(jobId: string, releaseId: string) {
  const { company } = await requireCompanyContext();
  await assertJobInCompany(jobId, company.id);

  const release = await prisma.retainageRelease.findUnique({ where: { id: releaseId } });
  if (!release || release.jobId !== jobId) {
    throw new Error("Retainage release not found on this job");
  }

  await prisma.retainageRelease.delete({ where: { id: releaseId } });

  revalidatePath(`/jobs/${jobId}`);
}

// QuickBooks OAuth start moved to app/api/quickbooks/start/route.ts (a
// plain Route Handler, not a Server Action) — see that file for why.

/** Ends the QuickBooks connection: best-effort revoke on Intuit's side,
 * then always removes the local record regardless of whether the revoke
 * call succeeded — an orphaned token we can no longer use is harmless. */
export async function disconnectQuickBooks() {
  const context = await requireCompanyContext();
  assertOwner(context);
  const { company } = context;

  const connection = await prisma.quickBooksConnection.findUnique({ where: { companyId: company.id } });
  if (!connection) {
    return;
  }

  try {
    await revokeToken(connection.refreshToken);
  } catch {
    // Already revoked, expired, or a transient network error — either way,
    // proceed to remove our record.
  }

  await prisma.quickBooksConnection.delete({ where: { companyId: company.id } });

  revalidatePath("/settings");
}

/**
 * Read-only connectivity check: refreshes the access token first if it's
 * about to expire, then fetches company info from the Accounting API.
 * Called directly from a client component (not a <form action>) so its
 * return value can be shown inline.
 */
export async function testQuickBooksConnection(): Promise<QuickBooksCompanyInfo> {
  const context = await requireCompanyContext();
  assertOwner(context);
  const { company } = context;

  const connection = await prisma.quickBooksConnection.findUnique({ where: { companyId: company.id } });
  if (!connection) {
    throw new Error("QuickBooks is not connected");
  }

  let accessToken = connection.accessToken;

  if (connection.accessTokenExpiresAt.getTime() - Date.now() < 60_000) {
    const refreshed = await refreshTokens(connection.refreshToken);
    await prisma.quickBooksConnection.update({
      where: { companyId: company.id },
      data: {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
        refreshTokenExpiresAt: refreshed.refreshTokenExpiresAt,
      },
    });
    accessToken = refreshed.accessToken;
  }

  return getCompanyInfo(connection.realmId, accessToken);
}

/**
 * Generates a short AI narrative over a job's WIP figures. Recomputes the
 * exact same deterministic numbers lib/wip.ts computes for the page itself
 * (single source of truth for the math), then hands only those numbers to
 * Claude for interpretation — never lets the model touch the arithmetic.
 * On-demand only: called directly from a client component (not a <form
 * action>) so the result can be shown inline, and nothing here is
 * persisted — every click regenerates fresh rather than reading a cached
 * value, since there's no schema field to cache it in yet.
 */
export async function generateJobWipNarrative(
  jobId: string,
): Promise<ActionResultWith<string>> {
  const { company } = await requireCompanyContext();
  const job = await assertJobInCompany(jobId, company.id);

  const lineItems = await prisma.jobLineItem.findMany({
    where: { jobId, isDeleted: false },
    orderBy: { createdAt: "asc" },
    include: { costEntries: true },
  });
  const invoices = await prisma.invoice.findMany({ where: { jobId } });

  const lineItemWip = lineItems.map((item) => ({
    item,
    wip: calculateLineItemWip({
      quantity: Number(item.quantity),
      unitPrice: item.unitPrice != null ? Number(item.unitPrice) : null,
      budgetedUnitCost: item.budgetedUnitCost != null ? Number(item.budgetedUnitCost) : null,
      currentEstimatedUnitCost:
        item.currentEstimatedUnitCost != null ? Number(item.currentEstimatedUnitCost) : null,
      estimatedCostToComplete:
        item.estimatedCostToComplete != null ? Number(item.estimatedCostToComplete) : null,
      actualCostToDate: item.costEntries.reduce((s, entry) => s + Number(entry.amount), 0),
    }),
  }));
  const billedToDate = invoices.reduce((sum, invoice) => sum + Number(invoice.amount), 0);
  const jobWip = calculateJobWip(
    lineItemWip.map((l) => l.wip),
    billedToDate,
  );

  // The model's system prompt tells it every figure it receives is exact and
  // final, and asks it to judge whether the job is overbilled. On a job
  // whose lines are only half estimated, earnedRevenue is summed with `?? 0`
  // against a contract value counted in full — so handing these numbers over
  // would have Claude write confident prose about an artefact. The job page
  // already refuses to print the same figure; this refuses to narrate it.
  if (jobWip.earnedCoverage < MIN_EARNED_COVERAGE) {
    return {
      ok: false,
      error: `Only ${Math.round(
        jobWip.earnedCoverage * 100,
      )}% of this job's value has a cost estimate, so the WIP figures aren't complete enough to interpret. Budget the remaining lines first.`,
    };
  }

  const narrative = await generateWipNarrative({
    jobName: job.name,
    jobStatus: job.status,
    contractValue: jobWip.contractValue,
    percentComplete: jobWip.percentComplete,
    earnedRevenue: jobWip.earnedRevenue,
    billedToDate: jobWip.billedToDate,
    overUnderBilling: jobWip.overUnderBilling,
    lineItems: lineItemWip.map(({ item, wip }) => ({
      description: item.description,
      contractValue: wip.contractValue,
      percentComplete: wip.percentComplete,
      budgetedCost: wip.budgetedCost,
      currentEstimatedCost: wip.currentEstimatedCost,
      actualCostToDate: wip.actualCostToDate,
    })),
  });

  return { ok: true, value: narrative };
}

// --- Company profile: insurance/bonding and locations ---------------------
// All OWNER-gated, same as team/QuickBooks management: these are company-
// wide compliance and identity records, not per-job data.

const CONTRACT_DOCUMENT_MEDIA_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"] as const;

const CONTRACT_DOCUMENT_MAX_BYTES = 15 * 1024 * 1024;

/** Uploads the actual subcontract agreement file (or a later amendment) —
 * distinct from SignatureRequest.snapshot, which is Prova's own line-item
 * data at the moment of e-signing, not a document the GC handed over.
 * Each upload is a new, numbered version (original = 1); nothing is ever
 * overwritten, so the full amendment history stays visible. Not gated by
 * job status: a GC can send an amendment at any point in the job's life,
 * not just pre-award. */
export async function uploadContractDocument(jobId: string, formData: FormData) {
  const { company, ...user } = await requireCompanyContext();
  await assertJobInCompany(jobId, company.id);

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("A file is required");
  }
  if (!(CONTRACT_DOCUMENT_MEDIA_TYPES as readonly string[]).includes(file.type)) {
    throw new Error("Upload a PDF, PNG, JPEG, or WEBP file");
  }
  if (file.size > CONTRACT_DOCUMENT_MAX_BYTES) {
    throw new Error("File is too large (max 15MB)");
  }

  const note = String(formData.get("note") ?? "").trim();

  const [buffer, lastVersion] = await Promise.all([
    file.arrayBuffer().then(Buffer.from),
    prisma.contractDocument.findFirst({ where: { jobId }, orderBy: { versionNumber: "desc" } }),
  ]);

  const blob = await putDocument(`contracts/${jobId}/${file.name}`, buffer, file.type);

  await prisma.contractDocument.create({
    data: {
      jobId,
      versionNumber: (lastVersion?.versionNumber ?? 0) + 1,
      fileUrl: blob.url,
      fileName: file.name,
      note: note || null,
      uploadedByUserId: user.id,
    },
  });

  revalidatePath(`/jobs/${jobId}`);
}

export async function deleteContractDocument(contractDocumentId: string) {
  const context = await requireCompanyContext();
  assertOwner(context);
  const { company } = context;

  const document = await prisma.contractDocument.findUnique({
    where: { id: contractDocumentId },
    include: { job: true },
  });
  if (!document || document.job.companyId !== company.id) {
    throw new Error("Contract document not found");
  }

  await prisma.contractDocument.delete({ where: { id: contractDocumentId } });

  revalidatePath(`/jobs/${document.jobId}`);
}
