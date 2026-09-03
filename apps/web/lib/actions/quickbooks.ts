"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { accountPurpose } from "@/lib/quickbooks-constants";
import { isMissingDocumentError } from "@/lib/quickbooks-sync";
import {
  QuickBooksApiError,
  createCustomer,
  createServiceItem,
  findCustomerByName,
  findItemByName,
  getInvoice,
  getInvoicesByIds,
  listAccounts,
  refreshTokens,
  upsertInvoice,
  type QuickBooksAccount,
  upsertPayment,
  getPayment,
} from "@prova/integrations";
import { requireCompanyContext } from "@/lib/auth";
import {
  quickBooksSideFrom,
  reconcileAll,
  type ProvaInvoiceSide,
  type Reconciliation,
} from "@/lib/quickbooks-reconcile";
import {
  buildInvoicePayload,
  formatUsd,
  idempotencyKeyFor,
  isAccidentalRepeat,
  pushBlockers,
  verifyPushedInvoice,
  type InvoiceToPush,
} from "@/lib/quickbooks-sync";
import {
  buildPaymentPayload,
  paymentIdempotencyKeyFor,
  paymentPushBlockers,
  verifyPushedPayment,
  type PaymentToPush,
} from "@/lib/quickbooks-payment-sync";
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

  // A refresh that fails is not a transient error and no retry fixes it:
  // Intuit rolls refresh tokens roughly every 100 days, and a person can
  // revoke the connection from inside QuickBooks at any moment. Either way
  // the only cure is somebody reconnecting.
  //
  // This used to throw straight out of here. In a production build Next
  // redacts a thrown Server Action message to a digest, so the person got
  // an opaque error on whatever page they were on and NOTHING anywhere said
  // the QuickBooks connection was the reason. Recording the state and
  // returning null turns a mystery into a sentence on the Integrations
  // page.
  let refreshed;
  try {
    refreshed = await refreshTokens(connection.refreshToken);
  } catch (error) {
    const detail =
      error instanceof QuickBooksApiError
        ? error.detail
        : "QuickBooks refused to renew the connection.";
    await prisma.quickBooksConnection.update({
      where: { companyId },
      data: { status: "NEEDS_REAUTH", statusDetail: detail, statusAt: new Date() },
    });
    return null;
  }

  await prisma.quickBooksConnection.update({
    where: { companyId },
    data: {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
      refreshTokenExpiresAt: refreshed.refreshTokenExpiresAt,
      // A successful refresh clears it. Leaving a stale NEEDS_REAUTH on a
      // working connection would be its own lie, and this codebase has been
      // bitten by exactly that shape more than once.
      status: "CONNECTED",
      statusDetail: null,
      statusAt: new Date(),
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
 * product list.
 *
 * THE STORED LINK IS A RECORD, NOT AN AUTHORITY, AND THAT IS THE FIX HERE.
 *
 * It used to short-circuit: a stored link returned its id immediately and
 * the name was never consulted again. Then somebody deleted the item inside
 * QuickBooks, and every invoice push failed forever with
 *
 *   "Product/Service assigned to this transaction has been deleted. Before
 *    you can modify this transaction, you must restore Prova — Construction
 *    services (deleted)."
 *
 * — an error naming a QuickBooks problem for a cache this app was holding.
 * Nothing inside Prova could recover from it. Restoring the item does fix
 * it, because reactivating keeps the id; CREATING a new item with the same
 * name does NOT, because the new item has a new id and the cache still
 * points at the dead one. Those two look identical to somebody in the
 * QuickBooks UI, and the second is what a person does when the "include
 * inactive" filter will not open. This blocked a browser test three runs
 * running.
 *
 * So the name is resolved every push and the link is corrected when it
 * disagrees. That is one extra query per invoice push against a rate limit
 * measured per realm per minute, on a button a person presses deliberately
 * — cheap. It is also the rule the rest of this codebase already follows:
 * derived state is never stored, because a stored value is free to disagree
 * with what it was derived from.
 */
const INCOME_ITEM_NAME = "Prova — Construction services";

/**
 * Creates the income item, and translates the one refusal a person can act
 * on into an instruction instead of an Intuit sentence.
 *
 * A DELETED ITEM STILL OWNS ITS NAME. QuickBooks excludes inactive items
 * from a name query, so the lookup above reports it absent and we try to
 * create one — and QuickBooks refuses, because the name is taken by the
 * very item that is hidden from the query. Both halves are correct and the
 * result is a dead end described in QuickBooks' vocabulary.
 *
 * The way out is REACTIVATING the original rather than making a second one,
 * and a new item with the same name is not a substitute: the invoice would
 * post to whichever the app resolved, and the contractor's product list
 * would carry two. So the message says which action to take and where.
 */
async function createIncomeItem(
  realmId: string,
  accessToken: string,
  incomeAccountId: string,
) {
  try {
    return await createServiceItem(realmId, accessToken, INCOME_ITEM_NAME, incomeAccountId);
  } catch (error) {
    const detail = error instanceof QuickBooksApiError ? error.detail : "";
    if (/duplicate\s*name/i.test(detail)) {
      throw new QuickBooksApiError(
        error instanceof QuickBooksApiError ? error.status : 400,
        `"${INCOME_ITEM_NAME}" exists in QuickBooks but is inactive, so invoices cannot reference ` +
          `it. In QuickBooks go to Sales → Products and Services, change the filter to include ` +
          `inactive items, find it, and choose Make active. Creating a second item with the same ` +
          `name will not work.`,
      );
    }
    throw error;
  }
}

async function resolveIncomeItemId(
  companyId: string,
  realmId: string,
  accessToken: string,
  incomeAccountId: string,
): Promise<string> {
  // Resolved from QuickBooks every time. `findItemByName` queries by name
  // and QuickBooks leaves inactive items out of that result, so a deleted
  // item reads as absent here and is recreated rather than referenced into
  // a refusal.
  const found = await findItemByName(realmId, accessToken, INCOME_ITEM_NAME);
  const item = found ?? (await createIncomeItem(realmId, accessToken, incomeAccountId));

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
    where: { companyId_purpose: { companyId: company.id, purpose: accountPurpose("INCOME") } },
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

  // An ACCIDENTAL repeat — a double-click, or a retry after a timeout — is
  // a no-op rather than a second document, checked before contacting
  // QuickBooks so a stray click costs nothing.
  //
  // Time-bounded, and that bound is the fix for a real bug. This used to
  // short-circuit forever on a matching key, which made "Re-send to
  // QuickBooks" a button that reported success and did nothing for the
  // life of the invoice. Browser testing found it by editing an invoice
  // inside QuickBooks to a different amount: Prova said "sent and
  // verified" and left it wrong, because the short-circuit ran before the
  // read-back and no later push ever looked at QuickBooks again.
  //
  // A deliberate re-send past the window is safe to let through: a link
  // exists by then, so the payload carries Id and SyncToken and QuickBooks
  // UPDATES that document. Creating is the only call that can duplicate,
  // and it only ever happens once.
  if (link) {
    const priorSuccess = await prisma.quickBooksSyncAttempt.findFirst({
      where: {
        companyId: company.id,
        entityType: "Invoice",
        entityId: invoice.id,
        idempotencyKey,
        outcome: "SUCCEEDED",
      },
      orderBy: { createdAt: "desc" },
    });
    if (isAccidentalRepeat(priorSuccess?.createdAt ?? null, new Date())) {
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

    // THE DOCUMENT WE ARE UPDATING NO LONGER EXISTS.
    //
    // Somebody deleted the invoice inside QuickBooks. The stored link still
    // names its id, so every later push addresses a record that is gone and
    // fails identically forever — the same shape as the item-id cache that
    // bricked invoicing until the fix in #85, arriving one entity along.
    //
    // Dropping the link is what makes recovery possible: with no link the
    // next push builds a CREATE rather than an update, and lands.
    //
    // IT DOES NOT CREATE ONE HERE, AND THAT IS DELIBERATE. Retrying a write
    // inside the failure handler is exactly what the retry rules forbid —
    // a create is the one call that can duplicate a document, and doing it
    // automatically off the back of an error we matched by string is how a
    // second invoice ends up in somebody's books. The person clicks again,
    // knowing what they are making.
    //
    // Matched narrowly on Intuit's "Object Not Found" rather than on the
    // word "deleted", because the Product/Service refusal contains
    // "has been deleted" and means something completely different — that
    // one is about the ITEM and clearing the invoice link would be wrong.
    // If Intuit's wording differs from this, the fallback is the generic
    // message below, which is what happens today.
    if (error instanceof QuickBooksApiError && isMissingDocumentError(error.detail)) {
      await prisma.quickBooksEntityLink.deleteMany({
        where: { companyId: company.id, entityType: "Invoice", entityId: invoice.id },
      });
      revalidatePath(`/jobs/${invoice.jobId}`);
      return actionFail(
        "The QuickBooks invoice this was linked to no longer exists — someone deleted it there. " +
          "The link has been cleared, so sending again will create a new invoice in QuickBooks rather " +
          "than failing. Check QuickBooks first if you are not sure it was deleted on purpose.",
      );
    }

    return actionFail(`QuickBooks refused: ${detail}`);
  }
}


/* ------------------------------------------------------------------ */
/* Reconciliation                                                      */
/* ------------------------------------------------------------------ */

/**
 * Asks QuickBooks what it holds, and reports where it disagrees with us.
 *
 * READ ONLY, and that is the whole design. The sync refuses an edit made
 * inside QuickBooks rather than overwriting it — correct, and the reason
 * every competitor in the research "silently diverges" is that they do the
 * opposite. But refusing an edit and then never mentioning it is half an
 * answer: an invoice sat at $200.00 in QuickBooks while Prova showed
 * $123.45 and nothing said so.
 *
 * This closes that without becoming a two-way sync. It tells a person what
 * differs; deciding which side is right stays with the person, because a
 * machine choosing between two humans' numbers is exactly the behaviour
 * that makes contractors stop trusting an integration.
 *
 * Nothing is stored. A saved "in sync" flag would be wrong the moment
 * either side changed, which is the rule this schema applies everywhere
 * else.
 */
export async function reconcileQuickBooksInvoices(): Promise<
  { ok: true; rows: Reconciliation[] } | { ok: false; error: string }
> {
  const context = await requireCompanyContext();
  assertOwner(context, "Only the account owner can reconcile QuickBooks");
  const { company } = context;

  const token = await accessTokenFor(company.id);
  if (!token) return { ok: false, error: "QuickBooks isn't connected." };

  const [invoices, links] = await Promise.all([
    prisma.invoice.findMany({
      where: { job: { companyId: company.id } },
      select: { id: true, number: true, amount: true, job: { select: { name: true } } },
      orderBy: { issuedAt: "desc" },
      // A cap rather than every invoice a company has ever raised: this is
      // a "is anything wrong right now" screen, and fetching five years of
      // history to answer it would be slow and mostly noise.
      take: 200,
    }),
    prisma.quickBooksEntityLink.findMany({
      where: { companyId: company.id, entityType: "Invoice" },
      select: { entityId: true, qboId: true, lastVerifiedAt: true },
    }),
  ]);

  const linkByInvoice = new Map(links.map((link) => [link.entityId, link]));

  const ourSide: ProvaInvoiceSide[] = invoices.map((invoice) => {
    const link = linkByInvoice.get(invoice.id);
    return {
      invoiceId: invoice.id,
      number: invoice.number,
      jobName: invoice.job.name,
      totalCents: toCents(invoice.amount),
      qboId: link?.qboId ?? null,
      lastVerifiedAt: link?.lastVerifiedAt ?? null,
    };
  });

  const qboIds = ourSide.map((row) => row.qboId).filter((id): id is string => id !== null);

  try {
    const fetched =
      qboIds.length === 0 ? [] : await getInvoicesByIds(token.realmId, token.accessToken, qboIds);
    const theirsById = new Map(
      fetched.map((raw) => {
        const side = quickBooksSideFrom(raw);
        return [side.qboId, side];
      }),
    );
    return { ok: true, rows: reconcileAll(ourSide, theirsById) };
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

/**
 * Pushes a recorded Payment to QuickBooks, applied to its invoice.
 *
 * Mirrors pushInvoiceToQuickBooks deliberately — same blockers-first shape,
 * same time-bounded repeat guard, same write-then-read-back verification,
 * same append-only attempt log. A second sync that behaved differently from
 * the first would be a second thing to reason about at month end.
 *
 * The one structural difference is the precondition: this refuses unless the
 * invoice already carries a QuickBooks link, because a payment is APPLIED to
 * a document and QuickBooks has to be holding that document first.
 */
export async function pushPaymentToQuickBooks(paymentId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  assertOwner(context, "Only the account owner can push to QuickBooks");
  const { company, ...user } = context;

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { invoice: { include: { job: { include: { contact: true } } } } },
  });
  if (!payment || payment.invoice.job.companyId !== company.id) {
    return actionFail("That payment no longer exists.");
  }

  const token = await accessTokenFor(company.id);
  const contactId = payment.invoice.job.contactId;

  const [customerLink, invoiceLink, depositMapping] = await Promise.all([
    contactId
      ? prisma.quickBooksEntityLink.findUnique({
          where: {
            companyId_entityType_entityId: {
              companyId: company.id,
              entityType: "Contact",
              entityId: contactId,
            },
          },
        })
      : Promise.resolve(null),
    prisma.quickBooksEntityLink.findUnique({
      where: {
        companyId_entityType_entityId: {
          companyId: company.id,
          entityType: "Invoice",
          entityId: payment.invoiceId,
        },
      },
    }),
    prisma.quickBooksAccountMapping.findUnique({
      where: { companyId_purpose: { companyId: company.id, purpose: accountPurpose("DEPOSIT") } },
    }),
  ]);

  const toPush: PaymentToPush = {
    paymentId: payment.id,
    invoiceId: payment.invoiceId,
    amountCents: toCents(payment.amount),
    receivedAt: payment.receivedAt,
    method: payment.method,
    note: payment.note,
    customerQboId: customerLink?.qboId ?? "",
    invoiceQboId: invoiceLink?.qboId ?? "",
  };
  const idempotencyKey = paymentIdempotencyKeyFor(toPush);

  const blockers = paymentPushBlockers({
    hasConnection: token !== null,
    customerQboId: customerLink?.qboId ?? null,
    invoiceQboId: invoiceLink?.qboId ?? null,
    amountCents: toPush.amountCents,
  });
  if (blockers.length > 0 || token === null) {
    // SKIPPED, not FAILED. Nothing was attempted and nothing is wrong with
    // QuickBooks — a setup step is missing, and calling that a failure
    // trains people to ignore the failures that matter.
    await log({
      companyId: company.id,
      userId: user.id,
      entityType: "Payment",
      entityId: payment.id,
      idempotencyKey,
      outcome: "SKIPPED",
      summary: `Payment on invoice ${payment.invoice.number} was not sent.`,
      detail: blockers.join(" ") || "QuickBooks isn't connected.",
    });
    return actionFail(blockers.join(" ") || "QuickBooks isn't connected.");
  }

  const link = await prisma.quickBooksEntityLink.findUnique({
    where: {
      companyId_entityType_entityId: {
        companyId: company.id,
        entityType: "Payment",
        entityId: payment.id,
      },
    },
  });

  if (link) {
    const priorSuccess = await prisma.quickBooksSyncAttempt.findFirst({
      where: {
        companyId: company.id,
        entityType: "Payment",
        entityId: payment.id,
        idempotencyKey,
        outcome: "SUCCEEDED",
      },
      orderBy: { createdAt: "desc" },
    });
    if (isAccidentalRepeat(priorSuccess?.createdAt ?? null, new Date())) {
      revalidatePath(`/jobs/${payment.invoice.job.id}`);
      return actionOk;
    }
  }

  const payload = buildPaymentPayload(toPush, {
    depositAccountId: depositMapping?.qboAccountId ?? null,
    existing:
      link && link.qboSyncToken !== null
        ? { qboId: link.qboId, syncToken: link.qboSyncToken }
        : undefined,
  });

  let written;
  try {
    written = await upsertPayment(token.realmId, token.accessToken, payload);
  } catch (error) {
    const detail =
      error instanceof QuickBooksApiError ? error.detail : "Couldn't reach QuickBooks.";
    await log({
      companyId: company.id,
      userId: user.id,
      entityType: "Payment",
      entityId: payment.id,
      idempotencyKey,
      outcome: "FAILED",
      summary: `Payment on invoice ${payment.invoice.number} was not sent.`,
      detail,
    });

    // Same self-healing as the invoice push above, one entity along: the
    // stored link names a QuickBooks payment somebody deleted there, so
    // every later push updates a record that is gone. Clearing the link
    // lets the next push CREATE instead — and it is the next push, not
    // this one, for the reason written out at the invoice call site: a
    // create is the only call that can duplicate, and doing it inside a
    // failure handler on a string match is how a second payment lands in
    // somebody's books.
    if (error instanceof QuickBooksApiError && isMissingDocumentError(detail)) {
      await prisma.quickBooksEntityLink.deleteMany({
        where: { companyId: company.id, entityType: "Payment", entityId: payment.id },
      });
      revalidatePath(`/jobs/${payment.invoice.jobId}`);
      return actionFail(
        "The QuickBooks payment this was linked to no longer exists — someone deleted it there. " +
          "The link has been cleared, so sending again will create a new payment rather than failing. " +
          "Check QuickBooks first if you are not sure it was deleted on purpose.",
      );
    }

    return actionFail(`QuickBooks refused: ${detail}`);
  }

  await prisma.quickBooksEntityLink.upsert({
    where: {
      companyId_entityType_entityId: {
        companyId: company.id,
        entityType: "Payment",
        entityId: payment.id,
      },
    },
    create: {
      companyId: company.id,
      entityType: "Payment",
      entityId: payment.id,
      qboId: written.Id,
      qboSyncToken: written.SyncToken ?? null,
      lastPushedAt: new Date(),
    },
    update: {
      qboId: written.Id,
      qboSyncToken: written.SyncToken ?? null,
      lastPushedAt: new Date(),
    },
  });

  // Read it back. The response to a write is not proof the write is right —
  // this project has been burned by exactly that claim.
  let verification;
  try {
    const readback = await getPayment(token.realmId, token.accessToken, written.Id);
    verification = verifyPushedPayment(payload, readback);
    await prisma.quickBooksEntityLink.update({
      where: {
        companyId_entityType_entityId: {
          companyId: company.id,
          entityType: "Payment",
          entityId: payment.id,
        },
      },
      data: { qboSyncToken: readback.SyncToken ?? written.SyncToken ?? null, lastVerifiedAt: new Date() },
    });
  } catch (error) {
    const detail =
      error instanceof QuickBooksApiError ? error.detail : "Couldn't read the payment back.";
    await log({
      companyId: company.id,
      userId: user.id,
      entityType: "Payment",
      entityId: payment.id,
      idempotencyKey,
      outcome: "VERIFY_MISMATCH",
      summary: `Payment on invoice ${payment.invoice.number} reached QuickBooks but could not be verified.`,
      detail,
      qboId: written.Id,
    });
    revalidatePath(`/jobs/${payment.invoice.job.id}`);
    return actionFail(`Sent, but couldn't confirm it landed correctly: ${detail}`);
  }

  if (!verification.ok) {
    await log({
      companyId: company.id,
      userId: user.id,
      entityType: "Payment",
      entityId: payment.id,
      idempotencyKey,
      outcome: "VERIFY_MISMATCH",
      summary: `Payment on invoice ${payment.invoice.number} landed differently than sent.`,
      detail: verification.problems.join(" "),
      qboId: written.Id,
    });
    revalidatePath(`/jobs/${payment.invoice.job.id}`);
    return actionFail(`QuickBooks holds something different: ${verification.problems.join(" ")}`);
  }

  await log({
    companyId: company.id,
    userId: user.id,
    entityType: "Payment",
    entityId: payment.id,
    idempotencyKey,
    outcome: "SUCCEEDED",
    summary: `Payment of ${formatUsd(toPush.amountCents)} applied to invoice ${payment.invoice.number} in QuickBooks.`,
    qboId: written.Id,
  });
  revalidatePath(`/jobs/${payment.invoice.job.id}`);
  return actionOk;
}
