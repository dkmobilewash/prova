"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import {
  QuickBooksApiError,
  createCustomer,
  createServiceItem,
  findCustomerByName,
  findItemByName,
  getInvoice,
  listAccounts,
  refreshTokens,
  upsertInvoice,
  type QuickBooksAccount,
} from "@prova/integrations";
import { requireCompanyContext } from "@/lib/auth";
import {
  buildInvoicePayload,
  idempotencyKeyFor,
  pushBlockers,
  verifyPushedInvoice,
  type InvoiceToPush,
} from "@/lib/quickbooks-sync";
import { type ActionResult, actionFail, actionOk, assertOwner } from "./shared";

/**
 * Pushing accounting data to QuickBooks.
 *
 * One direction, on purpose. The research this product is built against
 * found accounting sync to be the most-corroborated failure in contractor
 * software, and the shape is always the same: a platform advertises
 * two-way sync, the two systems quietly stop agreeing, and the contractor
 * finds out from their bookkeeper. Claiming less and doing it correctly is
 * the whole differentiator.
 *
 * Three rules hold everywhere in this file:
 *
 *   1. A push is a create only when no link exists, and an update only
 *      when one does. QuickBooksEntityLink is the record of which.
 *   2. Every write is followed by reading the record back and comparing.
 *      The response to a write is not proof the write was right.
 *   3. Every attempt is logged, including the refusals — a sync you cannot
 *      audit is one nobody can trust when the numbers disagree.
 */

/** Money in this app is Decimal; QuickBooks talks in floats. Cents is the
 * only representation that survives both. */
function toCents(value: unknown): number {
  return Math.round(Number(value) * 100);
}

async function accessTokenFor(companyId: string) {
  const connection = await prisma.quickBooksConnection.findUnique({ where: { companyId } });
  if (!connection) return null;

  if (connection.accessTokenExpiresAt.getTime() - Date.now() >= 60_000) {
    return { accessToken: connection.accessToken, realmId: connection.realmId };
  }

  const refreshed = await refreshTokens(connection.refreshToken);
  await prisma.quickBooksConnection.update({
    where: { companyId },
    data: {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
      refreshTokenExpiresAt: refreshed.refreshTokenExpiresAt,
    },
  });
  return { accessToken: refreshed.accessToken, realmId: connection.realmId };
}

async function log(input: {
  companyId: string;
  userId: string | null;
  entityType: string;
  entityId: string;
  idempotencyKey: string;
  outcome: "SUCCEEDED" | "FAILED" | "VERIFY_MISMATCH" | "SKIPPED";
  summary: string;
  detail?: string | null;
  qboId?: string | null;
}) {
  await prisma.quickBooksSyncAttempt.create({
    data: {
      companyId: input.companyId,
      entityType: input.entityType,
      entityId: input.entityId,
      idempotencyKey: input.idempotencyKey,
      outcome: input.outcome,
      summary: input.summary,
      detail: input.detail ?? null,
      qboId: input.qboId ?? null,
      attemptedByUserId: input.userId,
    },
  });
}

/* ------------------------------------------------------------------ */
/* Chart of accounts                                                   */
/* ------------------------------------------------------------------ */

/** The company's accounts, for the mapping UI. Read-only, so it is safe to
 * call before anything has ever been pushed. */
export async function loadQuickBooksAccounts(): Promise<
  { ok: true; accounts: QuickBooksAccount[] } | { ok: false; error: string }
> {
  const context = await requireCompanyContext();
  assertOwner(context, "Only the account owner can configure QuickBooks");
  const { company } = context;

  const token = await accessTokenFor(company.id);
  if (!token) return { ok: false, error: "QuickBooks isn't connected." };

  try {
    return { ok: true, accounts: await listAccounts(token.realmId, token.accessToken) };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof QuickBooksApiError
          ? `QuickBooks refused the request: ${error.detail}`
          : "Couldn't reach QuickBooks.",
    };
  }
}

/** Records which QuickBooks account a kind of money posts to. Deliberately
 * chosen by a person: guessing corrupts books in a way discovered at tax
 * time. */
export async function saveQuickBooksAccountMapping(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  assertOwner(context, "Only the account owner can configure QuickBooks");
  const { company } = context;

  const purpose = String(formData.get("purpose") ?? "").trim();
  const qboAccountId = String(formData.get("qboAccountId") ?? "").trim();
  const qboAccountName = String(formData.get("qboAccountName") ?? "").trim();

  if (!purpose) return actionFail("Which kind of money is this for?");
  if (!qboAccountId || !qboAccountName) return actionFail("Choose a QuickBooks account.");

  await prisma.quickBooksAccountMapping.upsert({
    where: { companyId_purpose: { companyId: company.id, purpose } },
    create: { companyId: company.id, purpose, qboAccountId, qboAccountName },
    update: { qboAccountId, qboAccountName },
  });

  revalidatePath("/settings");
  return actionOk;
}

export async function clearQuickBooksAccountMapping(purpose: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  assertOwner(context, "Only the account owner can configure QuickBooks");
  const { company } = context;

  await prisma.quickBooksAccountMapping.deleteMany({ where: { companyId: company.id, purpose } });
  revalidatePath("/settings");
  return actionOk;
}

/* ------------------------------------------------------------------ */
/* Customers                                                           */
/* ------------------------------------------------------------------ */

/**
 * Links a GC to a QuickBooks customer, reusing one that already exists
 * under the same name before creating a new one.
 *
 * Matching by name first matters: a bookkeeper almost certainly already has
 * this GC in QuickBooks with history attached, and creating a second
 * "Turner Construction" splits that history in a way that is tedious to
 * merge and easy not to notice.
 */
export async function linkContactToQuickBooks(contactId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  assertOwner(context, "Only the account owner can link QuickBooks customers");
  const { company, ...user } = context;

  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact || contact.companyId !== company.id) return actionFail("That contact no longer exists.");

  const token = await accessTokenFor(company.id);
  if (!token) return actionFail("QuickBooks isn't connected.");

  const existing = await prisma.quickBooksEntityLink.findUnique({
    where: {
      companyId_entityType_entityId: {
        companyId: company.id,
        entityType: "Contact",
        entityId: contactId,
      },
    },
  });
  if (existing) return actionOk;

  try {
    const found =
      (await findCustomerByName(token.realmId, token.accessToken, contact.name)) ??
      (await createCustomer(token.realmId, token.accessToken, contact.name));

    await prisma.quickBooksEntityLink.create({
      data: {
        companyId: company.id,
        entityType: "Contact",
        entityId: contactId,
        qboId: found.id,
        lastPushedAt: new Date(),
        lastVerifiedAt: new Date(),
      },
    });

    await log({
      companyId: company.id,
      userId: user.id,
      entityType: "Contact",
      entityId: contactId,
      idempotencyKey: `contact:${contactId}`,
      outcome: "SUCCEEDED",
      summary: `Linked ${contact.name} to QuickBooks customer ${found.id}.`,
      qboId: found.id,
    });

    revalidatePath("/contacts");
    return actionOk;
  } catch (error) {
    const detail =
      error instanceof QuickBooksApiError ? error.detail : "Couldn't reach QuickBooks.";
    await log({
      companyId: company.id,
      userId: user.id,
      entityType: "Contact",
      entityId: contactId,
      idempotencyKey: `contact:${contactId}`,
      outcome: "FAILED",
      summary: `Could not link ${contact.name}.`,
      detail,
    });
    return actionFail(`QuickBooks refused: ${detail}`);
  }
}


/**
 * The QuickBooks Product/Service item every invoice line is booked against.
 *
 * QuickBooks invoice lines reference an ITEM, not an account — the item is
 * what posts to the account. Getting this wrong is what made every push
 * fail with "Required parameter Line.SalesItemLineDetail is missing": the
 * builder had an optional item id, nothing supplied it, and an empty
 * SalesItemLineDetail reads to Intuit as absent.
 *
 * Found by name before being created, and the name is stable, so a second
 * run reuses the first run's item rather than littering the contractor's
 * product list. The link is stored so later pushes skip the lookup
 * entirely.
 */
const INCOME_ITEM_NAME = "Prova — Construction services";

async function resolveIncomeItemId(
  companyId: string,
  realmId: string,
  accessToken: string,
  incomeAccountId: string,
): Promise<string> {
  const link = await prisma.quickBooksEntityLink.findFirst({
    where: { companyId, entityType: "Item", entityId: INCOME_ITEM_NAME },
  });
  if (link) return link.qboId;

  const item =
    (await findItemByName(realmId, accessToken, INCOME_ITEM_NAME)) ??
    (await createServiceItem(realmId, accessToken, INCOME_ITEM_NAME, incomeAccountId));

  await prisma.quickBooksEntityLink.upsert({
    where: {
      companyId_entityType_entityId: {
        companyId,
        entityType: "Item",
        entityId: INCOME_ITEM_NAME,
      },
    },
    create: {
      companyId,
      entityType: "Item",
      entityId: INCOME_ITEM_NAME,
      qboId: item.id,
      lastPushedAt: new Date(),
      lastVerifiedAt: new Date(),
    },
    update: { qboId: item.id },
  });

  return item.id;
}

/* ------------------------------------------------------------------ */
/* Invoices                                                            */
/* ------------------------------------------------------------------ */

/**
 * Pushes one invoice, then reads it back to confirm what landed.
 *
 * The read-back is not belt-and-braces. "Batches transfer with wrong
 * amounts" and "double customer charges" are the two most-repeated
 * complaints in the entire research set, and both are invisible to a
 * caller that trusts the write response. A mismatch is recorded as its own
 * outcome — not a success with a caveat — because a sync that reports
 * success while holding the wrong number is the failure being designed
 * against.
 */
export async function pushInvoiceToQuickBooks(invoiceId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  assertOwner(context, "Only the account owner can push to QuickBooks");
  const { company, ...user } = context;

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      job: { include: { contact: true } },
      lineItems: { include: { lineItem: true } },
    },
  });
  if (!invoice || invoice.job.companyId !== company.id) {
    return actionFail("That invoice no longer exists.");
  }

  const customerLink = invoice.job.contactId
    ? await prisma.quickBooksEntityLink.findUnique({
        where: {
          companyId_entityType_entityId: {
            companyId: company.id,
            entityType: "Contact",
            entityId: invoice.job.contactId,
          },
        },
      })
    : null;

  const token = await accessTokenFor(company.id);

  // The chart-of-accounts mapping stopped being decorative here: it is what
  // the Product/Service item posts to, and without it there is nothing to
  // book a line against.
  const incomeMapping = await prisma.quickBooksAccountMapping.findUnique({
    where: { companyId_purpose: { companyId: company.id, purpose: "INCOME" } },
  });

  const toPush: InvoiceToPush = {
    invoiceId: invoice.id,
    number: invoice.number,
    jobName: invoice.job.name,
    customerQboId: customerLink?.qboId ?? "",
    issuedOn: invoice.issuedAt.toISOString().slice(0, 10),
    dueOn: invoice.dueAt ? invoice.dueAt.toISOString().slice(0, 10) : null,
    memo: invoice.description,
    totalCents: toCents(invoice.amount),
    retainageWithheldCents: invoice.retainageWithheld ? toCents(invoice.retainageWithheld) : 0,
    lines: invoice.lineItems.map((line) => ({
      lineItemId: line.lineItemId,
      description: line.lineItem.description,
      billedCents: toCents(line.thisPeriodBilled),
      materialsStoredCents: toCents(line.materialsStoredValue),
    })),
  };

  const idempotencyKey = idempotencyKeyFor(toPush);

  const blockers = pushBlockers({
    hasConnection: token !== null,
    customerQboId: customerLink?.qboId ?? null,
    incomeAccountId: incomeMapping?.qboAccountId ?? null,
    totalCents: toPush.totalCents,
  });
  if (blockers.length > 0 || !token || !incomeMapping) {
    await log({
      companyId: company.id,
      userId: user.id,
      entityType: "Invoice",
      entityId: invoice.id,
      idempotencyKey,
      outcome: "SKIPPED",
      summary: `Invoice ${invoice.number} on ${invoice.job.name} was not sent.`,
      detail: blockers.join(" "),
    });
    return actionFail(blockers.join(" "));
  }

  const link = await prisma.quickBooksEntityLink.findUnique({
    where: {
      companyId_entityType_entityId: {
        companyId: company.id,
        entityType: "Invoice",
        entityId: invoice.id,
      },
    },
  });

  // A retry of an identical push that already succeeded is a no-op rather
  // than a second document. This is the double-post defence, and it is
  // checked BEFORE contacting QuickBooks so a duplicate click costs
  // nothing.
  if (link) {
    const priorSuccess = await prisma.quickBooksSyncAttempt.findFirst({
      where: {
        companyId: company.id,
        entityType: "Invoice",
        entityId: invoice.id,
        idempotencyKey,
        outcome: "SUCCEEDED",
      },
    });
    if (priorSuccess) {
      revalidatePath(`/jobs/${invoice.jobId}`);
      return actionOk;
    }
  }

  let incomeItemId: string;
  try {
    incomeItemId = await resolveIncomeItemId(
      company.id,
      token.realmId,
      token.accessToken,
      incomeMapping.qboAccountId,
    );
  } catch (error) {
    const detail =
      error instanceof QuickBooksApiError ? error.detail : "Couldn't reach QuickBooks.";
    await log({
      companyId: company.id,
      userId: user.id,
      entityType: "Invoice",
      entityId: invoice.id,
      idempotencyKey,
      outcome: "FAILED",
      summary: `Invoice ${invoice.number} on ${invoice.job.name} was not sent.`,
      detail: `Could not resolve the QuickBooks service item: ${detail}`,
    });
    return actionFail(`QuickBooks refused: ${detail}`);
  }

  const payload = buildInvoicePayload(toPush, {
    incomeItemId,
    existing:
      link && link.qboSyncToken !== null
        ? { qboId: link.qboId, syncToken: link.qboSyncToken }
        : undefined,
  });

  try {
    const written = await upsertInvoice(token.realmId, token.accessToken, payload);
    const readBack = await getInvoice(token.realmId, token.accessToken, written.Id);
    const verification = verifyPushedInvoice(payload, readBack);

    await prisma.quickBooksEntityLink.upsert({
      where: {
        companyId_entityType_entityId: {
          companyId: company.id,
          entityType: "Invoice",
          entityId: invoice.id,
        },
      },
      create: {
        companyId: company.id,
        entityType: "Invoice",
        entityId: invoice.id,
        qboId: readBack.Id,
        qboSyncToken: readBack.SyncToken ?? null,
        lastPushedAt: new Date(),
        lastVerifiedAt: verification.ok ? new Date() : null,
      },
      update: {
        qboId: readBack.Id,
        qboSyncToken: readBack.SyncToken ?? null,
        lastPushedAt: new Date(),
        lastVerifiedAt: verification.ok ? new Date() : null,
      },
    });

    await log({
      companyId: company.id,
      userId: user.id,
      entityType: "Invoice",
      entityId: invoice.id,
      idempotencyKey,
      outcome: verification.ok ? "SUCCEEDED" : "VERIFY_MISMATCH",
      summary: `Invoice ${invoice.number} on ${invoice.job.name} sent as QuickBooks invoice ${readBack.Id}.`,
      detail: verification.ok ? null : verification.problems.join(" "),
      qboId: readBack.Id,
    });

    revalidatePath(`/jobs/${invoice.jobId}`);
    revalidatePath("/settings");

    if (!verification.ok) {
      return actionFail(
        `Sent, but QuickBooks holds something different: ${verification.problems.join(" ")} Check QuickBooks before sending again.`,
      );
    }
    return actionOk;
  } catch (error) {
    const detail =
      error instanceof QuickBooksApiError ? error.detail : "Couldn't reach QuickBooks.";
    await log({
      companyId: company.id,
      userId: user.id,
      entityType: "Invoice",
      entityId: invoice.id,
      idempotencyKey,
      outcome: "FAILED",
      summary: `Invoice ${invoice.number} on ${invoice.job.name} was not accepted.`,
      detail,
    });
    // A stale SyncToken means someone edited this invoice inside
    // QuickBooks. Saying so is the point — the alternative is overwriting
    // their edit, which is exactly how the two systems drift.
    if (error instanceof QuickBooksApiError && /stale|sync token/i.test(error.detail)) {
      return actionFail(
        "This invoice was changed inside QuickBooks since we last sent it. Open it there and decide which version is right before pushing again.",
      );
    }
    return actionFail(`QuickBooks refused: ${detail}`);
  }
}
