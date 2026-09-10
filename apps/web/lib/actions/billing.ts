"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { putDocument, deleteDocument } from "@/lib/blob";
import { isSignatureLinkDead } from "@/lib/access-tokens";
import { linkToken } from "@/lib/tokens";
import { requireCompanyContext } from "@/lib/auth";
import { money as formatMoney } from "@/lib/money";
import { prisma } from "@prova/db";
import { revokeToken, refreshTokens, getCompanyInfo, generateWipNarrative, type QuickBooksCompanyInfo } from "@prova/integrations";
import { calculateLineItemWip, calculateJobWip } from "@/lib/wip";
import { createInvoiceRecord } from "@/lib/billing/create-invoice";
import { issueInvoiceNumber } from "@/lib/billing/invoice-number";
import { MIN_EARNED_COVERAGE } from "@/lib/company-financials";
import { payAppEntryError } from "@/lib/pay-application";
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
 *
 * `expiresAt` is set 30 days out — issue #106 finding 2. A PENDING request
 * renders the job's LIVE line items on every open, so a link that sits
 * unopened for weeks can end up binding whatever the pricing has become by
 * the time someone finally clicks it, not what was true when it was sent.
 * See SignatureRequest.expiresAt for why existing rows are left alone.
 */
const SIGNATURE_REQUEST_EXPIRY_DAYS = 30;

export async function createSignatureRequest(jobId: string) {
  const { company } = await requireCompanyContext();
  const job = await assertJobInCompany(jobId, company.id);

  if (job.status !== "ESTIMATE") {
    throw new Error("This job is already contracted");
  }

  // `revokedAt: null` matters here — without it a REVOKED request (still
  // `status: "PENDING"`, since revoking sets `revokedAt` rather than the
  // status) would read as "an unsigned request already exists" forever,
  // and the dead link on the job page could never be replaced.
  const existing = await prisma.signatureRequest.findFirst({
    where: { jobId, status: "PENDING", revokedAt: null },
  });
  if (!existing) {
    const expiresAt = new Date(Date.now() + SIGNATURE_REQUEST_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    await prisma.signatureRequest.create({ data: { jobId, token: linkToken(), expiresAt } });
  }

  revalidatePath(`/jobs/${jobId}`);
}

/**
 * Kills a PENDING signing link without deleting the row — the row is the
 * audit trail that a link was issued at all. Refuses on a SIGNED request:
 * there is nothing live left to protect (the page only ever renders the
 * frozen `snapshot`, never job data), and revoking would just hide a
 * legitimate evidence record for no security benefit — the same
 * "sent correspondence can close but never delete" rule as everywhere
 * else in this app.
 */
export async function revokeSignatureRequest(requestId: string) {
  const { company } = await requireCompanyContext();

  const request = await prisma.signatureRequest.findUnique({
    where: { id: requestId },
    include: { job: true },
  });
  if (!request || request.job.companyId !== company.id) {
    throw new Error("Signing link not found");
  }
  if (request.status !== "PENDING") {
    throw new Error("This contract has already been signed");
  }

  await prisma.signatureRequest.update({
    where: { id: requestId },
    data: { revokedAt: new Date() },
  });

  revalidatePath(`/jobs/${request.jobId}`);
}

/**
 * Public action — no requireCompanyContext(). The client signing a
 * contract has no account; the unguessable token in the URL is the access
 * control. Captures signer name, IP, user agent, and an immutable snapshot
 * of what was signed at this moment (audit-only — see SignatureRequest in
 * schema.prisma and ARCHITECTURE.md).
 *
 * Issue #106 finding 2: refuses a REVOKED or EXPIRED request with the same
 * message as a token that never existed. Distinguishing them would tell
 * whoever is holding a dead link that it once worked — the same
 * information-disclosure shape as the "wrong jobId 404s" pattern the
 * portal already gets right, applied to an error message rather than a
 * page.
 *
 * Issue #106 finding 8's server-side half, in two parts that guard two
 * different orderings of the same double-click:
 *
 *   1. SEQUENTIAL — the second request's own read happens after the
 *      first's write has already committed. It used to see
 *      `status: "SIGNED"` and THROW "This contract has already been
 *      signed", which production redacts to a digest — so the GC who
 *      double-clicked sees a failure screen for a signature that in fact
 *      committed. Now it returns quietly: the contract IS signed, which
 *      is what they wanted. Deterministically dbtested (there is no
 *      timing involved — the second call's own read genuinely sees the
 *      row already SIGNED).
 *
 *   2. CONCURRENT — both requests' reads land before either's write. The
 *      early check above can't catch this (both see PENDING), so without
 *      a guard, a plain `update` from EACH would still succeed against
 *      Postgres, and the one that commits second would silently
 *      overwrite the first signer's captured name/IP/user agent/snapshot
 *      with whatever the second submission carried — the row would end
 *      up SIGNED, but its audit fields would belong to the wrong
 *      request. `updateMany`'s `where: { status: "PENDING", ... }`
 *      folds that same check into the WRITE itself rather than a
 *      separate read, so only the request that is FIRST to actually
 *      commit can ever match it — a second commit against an
 *      already-SIGNED row matches zero rows and changes nothing.
 *      Genuine simultaneity isn't something a Node-scheduled test can
 *      force deterministically without an artificial delay hook this
 *      codebase doesn't have, so the dbtest for this exercises it via
 *      `Promise.all` (proving no exception and a coherent single-signer
 *      result under real, if not perfectly pinned, concurrency) rather
 *      than proving the zero-rows-matched path in isolation.
 */
export async function signRequest(token: string, formData: FormData) {
  const request = await prisma.signatureRequest.findUnique({
    where: { token },
    include: { job: { include: { company: true, contact: true } } },
  });
  if (!request) {
    throw new Error("Signing link not found");
  }
  if (isSignatureLinkDead(request, new Date())) {
    throw new Error("Signing link not found");
  }
  if (request.status === "SIGNED") {
    // Idempotent rather than an error: a duplicate submission (double
    // click, a retried request) means the contract is already signed,
    // which is what the submitter wanted. Nothing to do.
    return;
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

  // `updateMany` with `status: "PENDING"` in the WHERE, not a separate
  // check — see the function comment above. A `count` of 0 means this
  // submission lost the race to a concurrent one (or a concurrent
  // revoke): either way there is nothing more for it to do, so it falls
  // through to the same revalidation rather than branching.
  await prisma.signatureRequest.updateMany({
    where: { id: request.id, status: "PENDING", revokedAt: null },
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
 * already exists and is not revoked, does nothing. Same access-control
 * pattern as SignatureRequest: no client login, the unguessable token is
 * the login.
 *
 * Issue #106 finding 2 / #217: a REVOKED token is reactivated in place
 * (same link, `portalRevokedAt` cleared) rather than minting a new one.
 * Rotating to a fresh token is deliberately not what this does — that is
 * a different action a reasonable person might also want
 * (`revokeClientPortalAccess` followed by a rotate), but this app has no
 * UI asking for it yet and adding one un-asked is scope this issue didn't
 * need. Filed as a known gap rather than guessed at.
 */
export async function enablePortalAccess(contactId: string) {
  const { company } = await requireCompanyContext();

  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact || contact.companyId !== company.id) {
    throw new Error("Contact not found");
  }
  if (contact.portalToken && !contact.portalRevokedAt) {
    return;
  }

  await prisma.contact.update({
    where: { id: contactId },
    data: contact.portalToken
      ? { portalRevokedAt: null }
      : { portalToken: linkToken() },
  });

  revalidatePath(`/contacts/${contactId}`);
}

/**
 * Kills a portal link without deleting or rotating it — issue #106
 * finding 2 / #217 ("cannot be revoked, rotated, or even copied"; this
 * covers the revoke half). `enablePortalAccess` reactivates the same link
 * later if that's ever wanted.
 */
export async function revokeClientPortalAccess(contactId: string) {
  const { company } = await requireCompanyContext();

  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact || contact.companyId !== company.id) {
    throw new Error("Contact not found");
  }
  if (!contact.portalToken) {
    return;
  }

  await prisma.contact.update({
    where: { id: contactId },
    data: { portalRevokedAt: new Date() },
  });

  revalidatePath(`/contacts/${contactId}`);
}

/** Bills the client. Only once a job is CONTRACTED or later — you don't
 * invoice an estimate nobody has agreed to yet.
 *
 * The body is lib/billing/create-invoice.ts, shared with the Ask command
 * `draft_invoice`. This wrapper keeps the form's contract: it throws its
 * refusal, as it always did, because the job page posts to it as a plain
 * form action with no place to render a returned sentence. */
export async function createInvoice(jobId: string, formData: FormData) {
  const { company } = await requireCompanyContext();
  await assertJobInCompany(jobId, company.id);

  const description = String(formData.get("description") ?? "").trim();
  const amount = decimalFromForm(formData, "amount");
  const dueRaw = String(formData.get("dueAt") ?? "").trim();
  const dueAt = dueRaw ? new Date(dueRaw) : null;

  const result = await createInvoiceRecord(company.id, jobId, { description, amount, dueAt });
  if (!result.ok) throw new Error(result.error);

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
  // before the write, both outside any transaction: the Neon pooled
  // connection limit is 5, and wrapping reads in one buys nothing here —
  // Invoice's @@unique([jobId, number]) is what actually stops two
  // concurrent submissions from both landing (the loser fails on the
  // constraint), so this is a guard against a person's mistake rather than
  // a concurrency control, and it does not pretend otherwise.
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

  // A resubmitted click bills the GC again for the same period at a new
  // invoice number, and retainageWithheld is snapshotted at creation and
  // deliberately never recomputed (see the field comment on Invoice) — so a
  // duplicate here isn't just a second document, it's a second retainage
  // figure nothing ever reconciles against the first. There is no period
  // field on Invoice to use as a natural key (see billing.prisma), so this
  // checks the job's single most recent invoice for an identical amount and
  // per-line breakdown submitted in the last 10 seconds — long enough to
  // catch a double-click or retried request, short enough that a genuine
  // correction re-sent minutes later still goes through. `issuedAt`, not a
  // separate `createdAt` (Invoice has none — see billing.prisma), doubles
  // as the creation timestamp here: neither createInvoice nor this action
  // ever sets it, so it always defaults to the moment of submission.
  // NOT ATOMIC — read-then-write, no lock — so this closes the sequential
  // double-click, not two requests landing at the exact same instant. See
  // the longer version of this caveat on logPayment's guard above.
  const lastInvoice = await prisma.invoice.findFirst({
    where: { jobId },
    orderBy: { issuedAt: "desc" },
    include: { lineItems: true },
  });
  if (
    lastInvoice &&
    Date.now() - lastInvoice.issuedAt.getTime() < 10_000 &&
    Number(lastInvoice.amount).toFixed(2) === amount.toFixed(2) &&
    lastInvoice.lineItems.length === rows.length &&
    rows.every((row) =>
      lastInvoice.lineItems.some(
        (line) =>
          line.lineItemId === row.lineItemId &&
          Number(line.thisPeriodBilled) === row.thisPeriodBilled &&
          Number(line.materialsStoredValue) === row.materialsStoredValue,
      ),
    )
  ) {
    return actionFail(
      `Invoice #${lastInvoice.number} was just submitted with this exact breakdown — check the invoices ` +
        "list before submitting again.",
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.invoice.create({
      data: {
        jobId,
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
  });

  revalidatePath(`/jobs/${jobId}`);
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
 * Returns an ActionResult, unlike most of this module's create actions —
 * production redacts thrown Server Action messages, and the overpayment
 * guard below is a real refusal a normal user action can trigger, not a
 * bug. It needs to reach the person who tried to log it. */
export async function logPayment(jobId: string, invoiceId: string, formData: FormData): Promise<ActionResult> {
  const { company } = await requireCompanyContext();
  await assertJobInCompany(jobId, company.id);
  const invoice = await assertInvoiceInCompany(invoiceId, company.id);
  if (invoice.jobId !== jobId) {
    throw new Error("Invoice not found on this job");
  }

  const amount = decimalFromForm(formData, "amount");
  const method = String(formData.get("method") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();

  // #102's shape: calculateArAgingInvoice (lib/cash-flow.ts) treats
  // balance <= 0 as fully paid and returns null, dropping the invoice from
  // A/R aging and totalOutstanding — with nothing rendering a negative
  // balance to give it away. This is a business invariant, not a
  // duplicate-detector: no invoice can go into NEGATIVE-balance territory,
  // whether the payment pushing it there was a genuine second payment, a
  // resubmitted duplicate, or a typo. It does NOT catch every duplicate --
  // a repeat that happens to land EXACTLY on the remaining balance (as in
  // #102's own $10,000-twice-on-$20,000 example) is mathematically
  // identical to a legitimate final payment clearing that same balance,
  // and no ceiling check can tell those apart; only going PAST the total
  // is unambiguous. Computed in cents to avoid float-precision false
  // positives/negatives at the boundary, and using the exact same
  // amount - SUM(payments.amount) shape calculateArAgingInvoice uses, so
  // the two can never drift apart.
  //
  // NOT ATOMIC, and worth being honest about: this reads the sum, then
  // later creates the row, with no transaction or lock around the pair —
  // two requests landing at the same instant could both read the balance
  // before either writes and both pass. That closes the sequential
  // double-click / retried-request shape #102 describes and this file's
  // tests exercise, not a true concurrent race. A stricter version would
  // take a Postgres advisory lock on the invoice for the read-then-write —
  // an unmerged, unshipped WIP branch on this same issue
  // (`cyrus/idempotent-write-paths`, never a PR) used `pg_advisory_xact_lock`
  // for this reason on a different set of guards, which is where this
  // caveat was actually verified from, not invented — but that pattern is
  // NOT anywhere on `main` today, and adding it here changes the shape of
  // every call site in this file for a race narrower than the bug reported.
  const priorPayments = await prisma.payment.aggregate({
    where: { invoiceId },
    _sum: { amount: true },
  });
  const alreadyPaidCents = Math.round(Number(priorPayments._sum.amount ?? 0) * 100);
  const invoiceTotalCents = Math.round(Number(invoice.amount) * 100);
  const newAmountCents = Math.round(Number(amount) * 100);
  if (alreadyPaidCents + newAmountCents > invoiceTotalCents) {
    const remainingCents = invoiceTotalCents - alreadyPaidCents;
    return actionFail(
      remainingCents <= 0
        ? "This invoice is already paid in full — there is nothing left to log a payment against."
        : `That would bring total payments to ${formatMoney(
            (alreadyPaidCents + newAmountCents) / 100,
          )}, more than the ${formatMoney(invoiceTotalCents / 100)} invoice total. Only ${formatMoney(
            remainingCents / 100,
          )} is left owing.`,
    );
  }

  await prisma.payment.create({
    data: { invoiceId, amount, method: method || null, note: note || null },
  });

  revalidatePath(`/jobs/${jobId}`);
  return actionOk;
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
 * See RetainageRelease in schema.prisma. */
export async function createRetainageRelease(jobId: string, formData: FormData) {
  const { company, ...user } = await requireCompanyContext();
  await assertJobInCompany(jobId, company.id);

  const amount = decimalFromForm(formData, "amount");
  const releasedRaw = String(formData.get("releasedAt") ?? "").trim();
  const releasedAt = releasedRaw ? new Date(releasedRaw) : new Date();
  const note = String(formData.get("note") ?? "").trim();

  await prisma.retainageRelease.create({
    data: { jobId, amount, releasedAt, note: note || null, createdByUserId: user.id },
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

/**
 * The next ContractDocument version number for a job, from a counter row
 * that only ever increments — same shape as `issueInvoiceNumber` above.
 *
 * WHAT THIS REPLACED. `versionNumber` was `MAX(versionNumber) + 1` off the
 * surviving rows for the job, read outside any transaction — issue #106
 * finding 5. Delete version 2 and upload again and the new upload is ALSO
 * "Version 2", so two different legal documents end up sharing a version
 * label on a document a GC may treat as the version of record. Two
 * concurrent uploads for the same job (an amendment landing while someone
 * else is also uploading) could additionally read the same max and
 * collide on `@@unique([jobId, versionNumber])`.
 */
async function issueContractDocumentVersion(tx: Prisma.TransactionClient, jobId: string) {
  const counter = await tx.contractDocumentVersionCounter.upsert({
    where: { jobId },
    create: { jobId, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
    select: { lastNumber: true },
  });
  return counter.lastNumber;
}

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

  // Uploading to blob storage is a network call and stays OUTSIDE the
  // transaction below, same reasoning as everywhere else this app mixes
  // a blob write with a DB write: a long-running external call has no
  // business holding a database transaction open.
  const buffer = await file.arrayBuffer().then(Buffer.from);
  const blob = await putDocument(`contracts/${jobId}/${file.name}`, buffer, file.type);

  await prisma.$transaction(async (tx) => {
    await tx.contractDocument.create({
      data: {
        jobId,
        versionNumber: await issueContractDocumentVersion(tx, jobId),
        fileUrl: blob.url,
        fileName: file.name,
        note: note || null,
        uploadedByUserId: user.id,
      },
    });
  });

  revalidatePath(`/jobs/${jobId}`);
}

/**
 * Issue #106 finding 3: deletes the underlying blob along with the row.
 * The row going but the file staying was the whole defect — `del` was
 * never imported from `@vercel/blob` anywhere in this repo, so the PDF
 * (or the off-platform-execution evidence file) stayed reachable at its
 * public URL forever after "deleting" it. See `deleteDocument` for why
 * the blob delete is best-effort rather than able to block this.
 */
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
  await deleteDocument(document.fileUrl);

  revalidatePath(`/jobs/${document.jobId}`);
}
