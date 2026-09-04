"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { putDocument } from "@/lib/blob";
import { linkToken } from "@/lib/tokens";
import { requireCompanyContext } from "@/lib/auth";
import { prisma } from "@prova/db";
import { revokeToken, refreshTokens, getCompanyInfo, generateWipNarrative, type QuickBooksCompanyInfo } from "@prova/integrations";
import { calculateLineItemWip, calculateJobWip } from "@/lib/wip";
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

async function nextInvoiceNumber(jobId: string) {
  const last = await prisma.invoice.findFirst({ where: { jobId }, orderBy: { number: "desc" } });
  return (last?.number ?? 0) + 1;
}

/** Bills the client. Only once a job is CONTRACTED or later — you don't
 * invoice an estimate nobody has agreed to yet. */
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

  const number = await nextInvoiceNumber(jobId);
  await prisma.invoice.create({
    data: { jobId, number, description: description || null, amount, dueAt, retainageWithheld },
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

  const number = await nextInvoiceNumber(jobId);
  await prisma.invoice.create({
    data: {
      jobId,
      number,
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
 * an invoice's balance is always amount - SUM(payments.amount). */
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

  await prisma.payment.create({
    data: { invoiceId, amount, method: method || null, note: note || null },
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
export async function generateJobWipNarrative(jobId: string): Promise<string> {
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

  return generateWipNarrative({
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
