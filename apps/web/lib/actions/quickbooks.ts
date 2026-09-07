"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { accountPurpose } from "@/lib/quickbooks-constants";
import { mayMeanDocumentIsGone } from "@/lib/quickbooks-sync";
import { documentPresence } from "@/lib/quickbooks-presence";
import {
  QuickBooksApiError,
  createCustomer,
  createServiceItem,
  findCustomerByName,
  findItemByName,
  findInvoicesByDocNumber,
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
  docNumberFor,
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
  // The same string on every attempt at this invoice, and different for
  // every other one — which is what lets it stand in for an id we may have
  // lost. `buildInvoicePayload` puts this exact value on the wire.
  const payloadDocNumber = docNumberFor(toPush);

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

  /* ---------------------------------------------------------------- *
   * WHAT DOES QUICKBOOKS ALREADY HOLD?
   *
   * Answered BEFORE anything is written, because a create is the only
   * call in this file that can put a second document in somebody's books
   * and `existing` is the single thing that decides whether we make one.
   * Three ways in, and each has its own way of being wrong:
   *
   *   link with a sync token  — the ordinary re-send. Update it.
   *   link WITHOUT one        — we know the id but cannot address it.
   *                             Read the token back; never create.
   *   no link at all          — either a genuine first push, or a push
   *                             whose id we lost. The DocNumber tells
   *                             them apart.
   * ---------------------------------------------------------------- */
  let existing: { qboId: string; syncToken: string } | undefined;

  if (link && link.qboSyncToken !== null) {
    existing = { qboId: link.qboId, syncToken: link.qboSyncToken };
  } else if (link) {
    /*
     * A link carrying an id but no SyncToken. QuickBooks' create response
     * types SyncToken as optional, so this state is reachable, and
     * `buildInvoicePayload` only emits an update when the token is
     * non-null — so left alone this builds a CREATE against an invoice we
     * KNOW QuickBooks is holding. The same duplicate, one step later.
     *
     * Recovered by READING, not by refusing. Refusing outright would be a
     * dead end no click could ever leave: the only code that clears an
     * invoice link lives in the write catch below, so a push that returns
     * before attempting the write can never reach it, and the invoice
     * would be unpushable forever by anyone. That is the shape of the
     * bricked-invoicing incident this codebase already paid for once.
     * A read is free to retry (quickbooks-retry.ts treats every transient
     * status as retryable for a GET) and cannot create anything.
     */
    const recovery: { doc: { Id: string; SyncToken?: string } | null } = { doc: null };
    const presence = await documentPresence(async () => {
      const doc = await getInvoice(token.realmId, token.accessToken, link.qboId);
      recovery.doc = doc;
      return doc;
    });

    if (presence === "PRESENT" && recovery.doc?.SyncToken != null) {
      existing = { qboId: recovery.doc.Id, syncToken: recovery.doc.SyncToken };
    } else if (presence === "GONE") {
      // A definite answer, and the only one allowed to clear a link. The
      // NEXT push creates; this one does not, so nobody gets a second
      // invoice out of a failure handler.
      await prisma.quickBooksEntityLink.deleteMany({
        where: { companyId: company.id, entityType: "Invoice", entityId: invoice.id },
      });
      await log({
        companyId: company.id,
        userId: user.id,
        entityType: "Invoice",
        entityId: invoice.id,
        idempotencyKey,
        outcome: "FAILED",
        summary: `Invoice ${invoice.number} on ${invoice.job.name} was not sent.`,
        detail: `We held QuickBooks invoice ${link.qboId} without its sync token; checking directly found it is no longer there. Clearing the link.`,
        qboId: link.qboId,
      });
      revalidatePath(`/jobs/${invoice.jobId}`);
      return actionFail(
        `The QuickBooks invoice this was linked to no longer exists — we checked, and it is gone. ` +
          `The link has been cleared, so sending again will create a new invoice in QuickBooks.`,
      );
    } else {
      // PRESENT but token-less, or UNKNOWN. Either way we cannot address
      // the document for an update and we will not create alongside it.
      // The link is left INTACT so the next click retries this same read.
      await log({
        companyId: company.id,
        userId: user.id,
        entityType: "Invoice",
        entityId: invoice.id,
        idempotencyKey,
        outcome: "SKIPPED",
        summary: `Invoice ${invoice.number} on ${invoice.job.name} was not re-sent.`,
        detail: `We hold QuickBooks invoice ${link.qboId} but not its sync token, and could not read it back to recover one. Creating would have duplicated the invoice.`,
        qboId: link.qboId,
      });
      return actionFail(
        `This invoice is already in QuickBooks as invoice ${link.qboId}, and we couldn't reach it just now ` +
          `to update it. Nothing was sent and nothing was changed — try again in a moment.`,
      );
    }
  } else {
    /*
     * NO LINK. That is not proof QuickBooks holds nothing.
     *
     * The link row is written by us after QuickBooks has already created
     * the document, and there are failures between those two moments that
     * no reordering can remove: `accountingRequest` re-POSTs a write after
     * a transport rejection, and undici rejects on ECONNRESET or a socket
     * hang-up AFTER the request bytes have gone out — so the retry can
     * create a second invoice inside one `upsertInvoice` call. A killed
     * serverless function does the same thing more simply. In both cases
     * QuickBooks holds an invoice whose id reached nobody.
     *
     * So the natural key is asked first. `docNumberFor` is deterministic
     * from this invoice's id and number, and it is already what every push
     * sends, so a document created by a lost attempt carries exactly the
     * string we look up here.
     *
     * A failed lookup BLOCKS rather than falling through to a create. That
     * is the whole point: creating on the strength of a question we could
     * not get an answer to is the guess this is here to stop.
     */
    let alreadyThere: { Id: string; SyncToken?: string }[];
    try {
      alreadyThere = await findInvoicesByDocNumber(
        token.realmId,
        token.accessToken,
        payloadDocNumber,
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
        detail: `Could not check whether QuickBooks already holds document ${payloadDocNumber}, so nothing was created: ${detail}`,
      });
      return actionFail(
        `We couldn't check whether this invoice is already in QuickBooks, so nothing was sent: ${detail}`,
      );
    }

    if (alreadyThere.length > 1) {
      const ids = alreadyThere.map((found) => found.Id).join(", ");
      await log({
        companyId: company.id,
        userId: user.id,
        entityType: "Invoice",
        entityId: invoice.id,
        idempotencyKey,
        outcome: "SKIPPED",
        summary: `Invoice ${invoice.number} on ${invoice.job.name} was not sent.`,
        detail: `QuickBooks already holds more than one invoice numbered ${payloadDocNumber}: ${ids}. Refusing rather than choosing one.`,
      });
      return actionFail(
        `QuickBooks already holds more than one invoice numbered ${payloadDocNumber} (${ids}). ` +
          `That means this invoice has been sent twice before. Open QuickBooks, delete the ones that ` +
          `should not be there, then send again — we will not pick one for you.`,
      );
    }

    const found = alreadyThere[0];
    if (found && found.SyncToken != null) {
      existing = { qboId: found.Id, syncToken: found.SyncToken };
    } else if (found) {
      await log({
        companyId: company.id,
        userId: user.id,
        entityType: "Invoice",
        entityId: invoice.id,
        idempotencyKey,
        outcome: "SKIPPED",
        summary: `Invoice ${invoice.number} on ${invoice.job.name} was not sent.`,
        detail: `QuickBooks already holds invoice ${found.Id} numbered ${payloadDocNumber}, but returned no sync token for it.`,
        qboId: found.Id,
      });
      return actionFail(
        `QuickBooks already holds this invoice as invoice ${found.Id}, but wouldn't tell us enough to ` +
          `update it. Check it there; nothing was sent.`,
      );
    }
  }

  const payload = buildInvoicePayload(toPush, { incomeItemId, existing });

  /* ---------------------------------------------------------------- *
   * PHASE A — the write, alone.
   *
   * Nothing else shares this try, because everything else in it used to
   * be able to turn a create that LANDED into a logged refusal. See the
   * link write below.
   * ---------------------------------------------------------------- */
  let written;
  try {
    written = await upsertInvoice(token.realmId, token.accessToken, payload);
  } catch (error) {
    // WHAT REACHING HERE DOES AND DOES NOT PROVE.
    //
    // A REFUSED status proves nothing was created: writes are retried only
    // on 429 and 503, which mean Intuit rejected the request before doing
    // any work (quickbooks-retry.ts), and every other status is surfaced
    // rather than repeated. For those, "was not accepted" below is true.
    //
    // A TRANSPORT failure proves no such thing, and the retry file's own
    // doc comment claims otherwise — it says a `fetch` rejection means the
    // request "never completed a round trip". That is not what a rejection
    // means. undici rejects on ECONNRESET, a socket hang-up or a headers
    // timeout AFTER the request bytes have been sent, which is
    // indistinguishable from QuickBooks creating the invoice and the
    // response being lost. So this catch can be reached with a document
    // already in somebody's books, and neither this handler nor any
    // reordering of the phases below can tell.
    //
    // That gap is why the next push asks findInvoicesByDocNumber before
    // creating anything, rather than trusting the absence of a link. It is
    // covered THERE, not here. Do not add a comment to this block claiming
    // nothing was created.
    const detail =
      error instanceof QuickBooksApiError ? error.detail : "Couldn't reach QuickBooks.";

    // DID SOMEBODY DELETE THE QUICKBOOKS INVOICE WE WERE UPDATING?
    //
    // We ask QuickBooks. We used to answer it by matching Intuit's prose
    // for "Object Not Found", and a string match was never going to be
    // sound here.
    //
    // NOT because a sandbox run proved the wording wrong. An earlier
    // version of this comment said exactly that — that invoice 1 on
    // ZZQB-TEST had been deleted and answered `Stale Object Error` — and it
    // was false: QuickBooks 146 was never deleted, because a payment was
    // applied to it and QuickBooks refuses that. The stale refusal was an
    // ordinary concurrent-edit refusal. The story was built on an
    // unverified assumption and written up as evidence; the correction is
    // in CHANGELOG.
    //
    // The real reason is duller and better: NOBODY HAS EVER DELETED A
    // QUICKBOOKS INVOICE AND CLICKED RE-SEND, so the fault a deletion
    // produces is unknown to this project. A read-back does not need to
    // know. That is the whole argument — it is correct under every answer,
    // including the one we have not seen.
    //
    // So the string only decides whether to spend one read-only GET, and
    // the GET decides. That is worth the round trip precisely because
    // clearing a link is the one recovery here that can produce a DUPLICATE
    // invoice: the next push builds a CREATE. A guess in that direction is
    // a second invoice in somebody's books; a guess the other way is a
    // confusing message. Only `GONE` — a definite answer, not a failure to
    // get one — clears anything.
    //
    // Still nothing is CREATED here. The person clicks again, knowing what
    // they are making. See the retry rules.
    const linkedQboId = link ? link.qboId : null;
    const presence =
      linkedQboId && mayMeanDocumentIsGone(detail)
        ? await documentPresence(() =>
            getInvoice(token.realmId, token.accessToken, linkedQboId),
          )
        // null, NOT "PRESENT": nothing was checked. They are different
        // facts, and the messages below say which one they are standing on
        // — claiming a check that never happened is the same species of
        // lie as a green tick for a commit nobody built.
        : null;

    // The row says what was concluded, not just what Intuit said.
    //
    // Without this, a refusal row and the message on screen could disagree
    // and there was no way to tell which click each belonged to — which is
    // exactly what happened while testing this: a `Stale Object Error` row
    // sitting next to a "no longer exists" message, and an hour spent
    // working out whether they came from the same click. A row that
    // explains itself is cheaper than that hour.
    await log({
      companyId: company.id,
      userId: user.id,
      entityType: "Invoice",
      entityId: invoice.id,
      idempotencyKey,
      outcome: "FAILED",
      summary: `Invoice ${invoice.number} on ${invoice.job.name} was not accepted.`,
      detail:
        presence === "GONE"
          ? `${detail} — Checked QuickBooks directly: invoice ${linkedQboId} is no longer there. Clearing the link, so sending again creates a new invoice.`
          : presence === "UNKNOWN"
            ? `${detail} — Could not check whether QuickBooks still has invoice ${linkedQboId}, so the link was left alone.`
            : detail,
    });

    if (presence === "GONE" && link) {
      await prisma.quickBooksEntityLink.deleteMany({
        where: { companyId: company.id, entityType: "Invoice", entityId: invoice.id },
      });
      revalidatePath(`/jobs/${invoice.jobId}`);
      return actionFail(
        "The QuickBooks invoice this was linked to no longer exists — we checked, and it is gone. " +
          "The link has been cleared, so sending again will create a new invoice in QuickBooks rather " +
          "than failing. Check QuickBooks first if you are not sure it was deleted on purpose.",
      );
    }

    // A stale SyncToken with the document still in place means someone
    // edited this invoice inside QuickBooks. Saying so is the point — the
    // alternative is overwriting their edit, which is exactly how the two
    // systems drift. Reaching here means the probe found it PRESENT, or
    // could not tell; either way the link stays.
    if (error instanceof QuickBooksApiError && /stale|sync token/i.test(error.detail)) {
      return actionFail(
        presence === "PRESENT"
          ? "This invoice was changed inside QuickBooks since we last sent it — we checked, and it is still there. Open it there and decide which version is right before pushing again."
          : "This invoice was changed inside QuickBooks since we last sent it. Open it there and decide which version is right before pushing again.",
      );
    }

    return actionFail(`QuickBooks refused: ${detail}`);
  }

  /* ---------------------------------------------------------------- *
   * PHASE B — record the id, before anything else can throw.
   *
   * FROM HERE ON QUICKBOOKS HOLDS THIS DOCUMENT. This row is the only
   * thing in Prova that will ever make the next push an UPDATE instead of
   * a second CREATE, so it is written before the read-back, before
   * verification, and before any other statement that can fail. Nothing
   * may be awaited between the write above and this line.
   *
   * That ordering IS the bug fix. This upsert used to sit after
   * `getInvoice`, inside the same try as the create — so a revoked token
   * on the read-back, or a Neon pool timeout here, left QuickBooks holding
   * a real invoice whose id existed nowhere, logged as "was not accepted",
   * under a button that still read "Send to QuickBooks".
   *
   * `written.Id`, not `readBack.Id`, and that is not a lapse in the
   * read-back-is-truth rule this file is built on. `verifyPushedInvoice`
   * checks the CONTENT QuickBooks stored against what we sent — amounts,
   * document number, line count — because QuickBooks can store something
   * different from the instruction. The id is not content we sent: it is
   * QuickBooks' own answer to "where did you put it", there is no second
   * source for it, and reading it back would be circular anyway since the
   * read is addressed BY that id.
   * ---------------------------------------------------------------- */
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
      qboId: written.Id,
      qboSyncToken: written.SyncToken ?? null,
      lastPushedAt: new Date(),
    },
    update: {
      qboId: written.Id,
      qboSyncToken: written.SyncToken ?? null,
      lastPushedAt: new Date(),
    },
    // lastVerifiedAt is deliberately untouched: a create leaves it null,
    // and an update leaves any earlier verification standing. Nulling it
    // here would erase the evidence of a genuine past verification every
    // time somebody re-sends. Phase C is what sets it.
  });

  /* ---------------------------------------------------------------- *
   * PHASE C — read it back, in its own try.
   *
   * A failure here is no longer a refusal, because the document exists.
   * It is a VERIFY_MISMATCH: reached QuickBooks, could not be confirmed.
   * ---------------------------------------------------------------- */
  let verification;
  let readBack;
  try {
    readBack = await getInvoice(token.realmId, token.accessToken, written.Id);
    verification = verifyPushedInvoice(payload, readBack);
    await prisma.quickBooksEntityLink.update({
      where: {
        companyId_entityType_entityId: {
          companyId: company.id,
          entityType: "Invoice",
          entityId: invoice.id,
        },
      },
      data: {
        qboSyncToken: readBack.SyncToken ?? written.SyncToken ?? null,
        lastVerifiedAt: verification.ok ? new Date() : null,
      },
    });
  } catch (error) {
    // NOTE THE MISSING-DOCUMENT PROBE IS NOT REPEATED HERE, AND MUST NOT
    // BE. The write above returned an id, so QuickBooks demonstrably holds
    // this document; a read failure whose text happens to match "Object
    // Not Found" is not evidence of absence, it is evidence we could not
    // read. Clearing the link on it would make the next push a CREATE and
    // re-arm the exact duplicate this whole restructuring removes.
    const detail =
      error instanceof QuickBooksApiError ? error.detail : "Couldn't read the invoice back.";
    await log({
      companyId: company.id,
      userId: user.id,
      entityType: "Invoice",
      entityId: invoice.id,
      idempotencyKey,
      outcome: "VERIFY_MISMATCH",
      summary: `Invoice ${invoice.number} on ${invoice.job.name} reached QuickBooks as invoice ${written.Id} but could not be verified.`,
      detail,
      qboId: written.Id,
    });
    revalidatePath(`/jobs/${invoice.jobId}`);
    revalidatePath("/settings");
    return actionFail(
      `Sent to QuickBooks as invoice ${written.Id}, but we couldn't confirm what landed: ${detail} ` +
        `Check it in QuickBooks before sending again — we have recorded its id, so a re-send updates ` +
        `that invoice rather than making a second one.`,
    );
  }

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

    // Same question as the invoice push, asked the same way and for the
    // same reason: has the QuickBooks payment we are updating been deleted
    // there? Answered by reading it back, never by matching Intuit's
    // wording — see the long note at the invoice call site for what that
    // wording actually turned out to be.
    //
    // This path gains more from the change than the invoice one did. There
    // was no stale-token branch here at all, so a deleted payment reporting
    // `Stale Object Error` fell straight through to the generic refusal and
    // the link was never cleared: the push failed identically forever with
    // a message about a concurrent editor who did not exist.
    const linkedQboId = link ? link.qboId : null;
    const presence =
      linkedQboId && mayMeanDocumentIsGone(detail)
        ? await documentPresence(() =>
            getPayment(token.realmId, token.accessToken, linkedQboId),
          )
        // null, NOT "PRESENT": nothing was checked. They are different
        // facts, and the messages below say which one they are standing on
        // — claiming a check that never happened is the same species of
        // lie as a green tick for a commit nobody built.
        : null;

    await log({
      companyId: company.id,
      userId: user.id,
      entityType: "Payment",
      entityId: payment.id,
      idempotencyKey,
      outcome: "FAILED",
      summary: `Payment on invoice ${payment.invoice.number} was not sent.`,
      detail:
        presence === "GONE"
          ? `${detail} — Checked QuickBooks directly: payment ${linkedQboId} is no longer there. Clearing the link, so sending again creates a new payment.`
          : presence === "UNKNOWN"
            ? `${detail} — Could not check whether QuickBooks still has payment ${linkedQboId}, so the link was left alone.`
            : detail,
    });

    // Clearing the link lets the next push CREATE instead — and it is the
    // NEXT push, not this one, for the reason written out at the invoice
    // call site: a create is the only call that can duplicate, and doing it
    // inside a failure handler is how a second payment lands in somebody's
    // books.
    if (presence === "GONE" && link) {
      await prisma.quickBooksEntityLink.deleteMany({
        where: { companyId: company.id, entityType: "Payment", entityId: payment.id },
      });
      revalidatePath(`/jobs/${payment.invoice.jobId}`);
      return actionFail(
        "The QuickBooks payment this was linked to no longer exists — we checked, and it is gone. " +
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
