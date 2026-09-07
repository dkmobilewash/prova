import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/fake-prisma";
import { QuickBooksApiError } from "@prova/integrations";

/**
 * ONE INVOICE SENT TWICE MUST NOT BECOME TWO INVOICES IN SOMEBODY'S BOOKS
 * (#102).
 *
 * `pushInvoiceToQuickBooks` wrapped the create, the read-back and the write
 * of the QuickBooksEntityLink in a SINGLE try. QuickBooks assigns the id on
 * the create; the link row is the only place Prova ever records it. So any
 * throw between the two — a revoked token on the read-back, a Neon pool
 * timeout on the upsert — left QuickBooks holding a real invoice whose id
 * exists nowhere in this system, and the catch logged it as
 * `FAILED · "was not accepted"`, which is a false statement about a
 * document that was accepted.
 *
 * The person then reads "QuickBooks refused" on a button that still says
 * "Send to QuickBooks", clicks it, and the next push finds no link and
 * builds a CREATE. Two invoices, one job. Neither `@@unique` on
 * QuickBooksEntityLink can catch it: the second create gets a NEW qboId, so
 * both constraints are satisfied by the duplicate.
 *
 * WHY THIS IS NOT COVERED BY #19. It is not a double-click.
 * PushInvoiceToQuickBooks.tsx already disables the button while the action
 * is in flight, and that changes nothing here — the duplicate is produced
 * by the action truthfully-looking-but-falsely reporting a refusal, and by
 * the server-side repeat guard being structurally unreachable (it is inside
 * `if (link)`, and the whole defect is that no link exists). No client-side
 * change can fix it.
 *
 * WHY THIS IS A FakeDb TEST AND NOT A `.dbtest.ts`. Every assertion below
 * is about the ORDER of writes and about the payload handed to QuickBooks —
 * precisely what lib/fake-prisma.ts exists for, and what the schema cannot
 * enforce anyway (see the @@unique note above). It also means these run in
 * the ordinary suite, so they gate every push; the .dbtest.ts family needs a
 * Postgres that CI does not have.
 */

let db = new FakeDb();
const context = { company: { id: "co_1" }, id: "user_1", role: "OWNER" as string };

vi.mock("@/lib/auth", () => ({
  requireCompanyContext: async () => context,
}));

const revalidated: string[] = [];
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => {
    revalidated.push(path);
  },
}));

vi.mock("@prova/db", () => ({
  Prisma: {},
  get prisma() {
    return db.client();
  },
}));

/**
 * The network layer becomes a script.
 *
 * `QuickBooksApiError` stays REAL — `documentPresence` and the catch
 * branches narrow on `instanceof`, so a fake error class would make every
 * one of them take the wrong branch and the tests would be about the mock.
 *
 * `findItemByName` and `createServiceItem` are mocked too, and that is not
 * optional: `resolveIncomeItemId` is a local function in the action module,
 * so stubbing it is impossible from out here. Leave its two dependencies
 * real and the push dies in the item-resolution catch — BEFORE
 * `upsertInvoice` is ever reached — and a test asserting only
 * `result.ok === false` goes green having never entered the code it is
 * about. Hence `expect(pushed).toHaveLength(1)` in the first test.
 */
interface QboScript {
  /** Payloads handed to `upsertInvoice`, in order. A payload with no `Id`
   * is a CREATE — that is what a duplicate looks like from here. */
  pushed: Record<string, unknown>[];
  reads: string[];
  docNumberLookups: string[];
  upsert: (payload: Record<string, unknown>) => unknown;
  read: (qboId: string) => unknown;
  /** Every invoice QuickBooks holds under this DocNumber. An ARRAY, not a
   * single hit: if this bug has already run in production the books can
   * hold two under one number, and picking one of them silently is another
   * guess about somebody's ledger. */
  findByDocNumber: (docNumber: string) => unknown[];
}

const qbo: QboScript = {
  pushed: [],
  reads: [],
  docNumberLookups: [],
  upsert: () => ({ Id: "1042", SyncToken: "0", TotalAmt: 84500, DocNumber: "INV_1-4" }),
  read: () => ({ Id: "1042", SyncToken: "0", TotalAmt: 84500, DocNumber: "INV_1-4" }),
  findByDocNumber: () => [],
};

vi.mock("@prova/integrations", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    upsertInvoice: async (_realm: string, _token: string, payload: Record<string, unknown>) => {
      qbo.pushed.push(payload);
      return qbo.upsert(payload);
    },
    getInvoice: async (_realm: string, _token: string, qboId: string) => {
      qbo.reads.push(qboId);
      return qbo.read(qboId);
    },
    findInvoicesByDocNumber: async (_realm: string, _token: string, docNumber: string) => {
      qbo.docNumberLookups.push(docNumber);
      return qbo.findByDocNumber(docNumber);
    },
    findItemByName: async () => ({ id: "ITEM-1", name: "Prova — Construction services" }),
    createServiceItem: async () => {
      throw new Error("the income item already exists; this must not be called");
    },
    refreshTokens: async () => {
      throw new Error("the token is fresh; this must not be called");
    },
  };
});

const { pushInvoiceToQuickBooks } = await import("./quickbooks");

const INVOICE_ID = "inv_1";
/** `docNumberFor` is deterministic from the invoice id and number, so it is
 * the same string on every attempt — which is what makes it usable as a
 * natural key. */
const DOC_NUMBER = "INV_1-4";

function seedFixture() {
  db.seed("company", { id: "co_1", name: "ZZ Drywall" });
  db.seed("quickBooksConnection", {
    id: "conn_1",
    companyId: "co_1",
    realmId: "realm_1",
    accessToken: "access",
    refreshToken: "refresh",
    // An hour out, so `accessTokenFor` returns without refreshing.
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    status: "CONNECTED",
  });
  db.seed("quickBooksAccountMapping", {
    id: "map_1",
    companyId: "co_1",
    purpose: "INCOME",
    qboAccountId: "ACCT-1",
    qboAccountName: "Construction income",
  });
  db.seed("quickBooksEntityLink", {
    id: "link_contact",
    companyId: "co_1",
    entityType: "Contact",
    entityId: "contact_1",
    qboId: "CUST-1",
    qboSyncToken: "0",
  });
  db.seed("invoice", {
    id: INVOICE_ID,
    number: 4,
    jobId: "job_1",
    amount: "84500.00",
    retainageWithheld: null,
    description: "Pay application 4",
    issuedAt: new Date("2026-09-01T00:00:00.000Z"),
    dueAt: new Date("2026-10-01T00:00:00.000Z"),
    job: {
      id: "job_1",
      companyId: "co_1",
      name: "Riverside Medical — L3 Drywall",
      contactId: "contact_1",
    },
    lineItems: [
      {
        lineItemId: "li_1",
        thisPeriodBilled: "84500.00",
        materialsStoredValue: "0",
        lineItem: { description: "Level 3 drywall — 3rd floor" },
      },
    ],
  });
}

function invoiceLink() {
  return db
    .rows("quickBooksEntityLink")
    .find((row) => row.entityType === "Invoice" && row.entityId === INVOICE_ID);
}

function attempts() {
  return db.rows("quickBooksSyncAttempt").filter((row) => row.entityId === INVOICE_ID);
}

/** A read-back that fails the way a revoked connection fails: 401 is not in
 * TRANSIENT, so it throws on the first attempt rather than being retried. */
function revokedOnRead() {
  qbo.read = () => {
    throw new QuickBooksApiError(401, "AuthenticationFailed");
  };
}

beforeEach(() => {
  db = new FakeDb();
  revalidated.length = 0;
  qbo.pushed.length = 0;
  qbo.reads.length = 0;
  qbo.docNumberLookups.length = 0;
  qbo.upsert = () => ({ Id: "1042", SyncToken: "0", TotalAmt: 84500, DocNumber: DOC_NUMBER });
  qbo.read = () => ({ Id: "1042", SyncToken: "0", TotalAmt: 84500, DocNumber: DOC_NUMBER });
  qbo.findByDocNumber = () => [];
  seedFixture();
});

describe("a create that landed is recorded even when everything after it fails", () => {
  it("records the QuickBooks id when the read-back fails", async () => {
    revokedOnRead();

    const first = await pushInvoiceToQuickBooks(INVOICE_ID);
    expect(first.ok).toBe(false);

    // Without this the test can go green having never reached the push —
    // the item-resolution catch returns the same shape.
    expect(qbo.pushed).toHaveLength(1);

    const link = invoiceLink();
    expect(link?.qboId).toBe("1042");
    // Recorded as pushed, NOT as verified. Those are different facts and the
    // UI renders the difference.
    expect(link?.lastVerifiedAt ?? null).toBeNull();
  });

  it("re-sending after a failed read-back UPDATES, it does not create a second invoice", async () => {
    revokedOnRead();
    await pushInvoiceToQuickBooks(INVOICE_ID);

    qbo.pushed.length = 0;
    qbo.read = () => ({ Id: "1042", SyncToken: "1", TotalAmt: 84500, DocNumber: DOC_NUMBER });

    const second = await pushInvoiceToQuickBooks(INVOICE_ID);
    expect(second.ok).toBe(true);

    // The whole bug in one assertion: a payload with no `Id` is a second
    // document in the customer's Accounts Receivable.
    expect(qbo.pushed).toHaveLength(1);
    expect(qbo.pushed[0].Id).toBe("1042");
    expect(qbo.pushed[0].SyncToken).toBe("0");
  });

  it("does not log a landed create as a refusal", async () => {
    revokedOnRead();
    await pushInvoiceToQuickBooks(INVOICE_ID);

    const last = attempts().at(-1)!;
    expect(last.outcome).toBe("VERIFY_MISMATCH");
    expect(last.qboId).toBe("1042");
    // "was not accepted" about an invoice QuickBooks accepted is the
    // sentence that makes somebody click again.
    expect(String(last.summary)).not.toMatch(/was not accepted/);
  });
});

describe("a link with no sync token is recovered, never bricked", () => {
  it("reads the sync token back and UPDATES rather than creating", async () => {
    // The state Phase B can leave behind: QuickBooks' create response is
    // typed with SyncToken optional, so a response without one stores a
    // qboId and a null token. `buildInvoicePayload` only emits an update
    // when the token is non-null, so without a recovery this becomes the
    // same duplicate one step later.
    db.seed("quickBooksEntityLink", {
      id: "link_invoice",
      companyId: "co_1",
      entityType: "Invoice",
      entityId: INVOICE_ID,
      qboId: "1042",
      qboSyncToken: null,
      lastPushedAt: new Date(),
      lastVerifiedAt: null,
    });
    qbo.read = () => ({ Id: "1042", SyncToken: "3", TotalAmt: 84500, DocNumber: DOC_NUMBER });

    const result = await pushInvoiceToQuickBooks(INVOICE_ID);

    expect(result.ok).toBe(true);
    expect(qbo.pushed).toHaveLength(1);
    expect(qbo.pushed[0].Id).toBe("1042");
    expect(qbo.pushed[0].SyncToken).toBe("3");
  });

  it("refuses without creating when the sync token cannot be recovered", async () => {
    db.seed("quickBooksEntityLink", {
      id: "link_invoice",
      companyId: "co_1",
      entityType: "Invoice",
      entityId: INVOICE_ID,
      qboId: "1042",
      qboSyncToken: null,
      lastPushedAt: new Date(),
      lastVerifiedAt: null,
    });
    qbo.read = () => {
      throw new QuickBooksApiError(503, "ServiceUnavailable");
    };

    const result = await pushInvoiceToQuickBooks(INVOICE_ID);

    expect(result.ok).toBe(false);
    // Nothing created — but the link SURVIVES, so a later click can try the
    // recovery read again. A refusal that cannot be retried is a brick.
    expect(qbo.pushed).toHaveLength(0);
    expect(invoiceLink()?.qboId).toBe("1042");
  });
});

describe("the link is cleared only on a WRITE that proves the document is gone", () => {
  function seedLinkedInvoice() {
    db.seed("quickBooksEntityLink", {
      id: "link_invoice",
      companyId: "co_1",
      entityType: "Invoice",
      entityId: INVOICE_ID,
      qboId: "999",
      qboSyncToken: "2",
      lastPushedAt: new Date(),
      lastVerifiedAt: new Date(),
    });
  }

  it("clears it when the update is refused and the document really is absent", async () => {
    seedLinkedInvoice();
    qbo.upsert = () => {
      throw new QuickBooksApiError(400, "Object Not Found");
    };
    qbo.read = () => {
      throw new QuickBooksApiError(400, "Object Not Found");
    };

    const result = await pushInvoiceToQuickBooks(INVOICE_ID);

    expect(result.ok).toBe(false);
    expect(invoiceLink()).toBeUndefined();
  });

  it("KEEPS it when the WRITE SUCCEEDED and only the read-back said that", async () => {
    // The hazard the phase split creates. The write returned an id, so the
    // document demonstrably exists. If the missing-document self-heal
    // follows the read-back instead of the write, this deletes the link for
    // a live invoice — and the next push CREATES a second one, which is the
    // very bug the split is fixing, re-armed by the fix.
    seedLinkedInvoice();
    qbo.upsert = () => ({ Id: "999", SyncToken: "3", TotalAmt: 84500, DocNumber: DOC_NUMBER });
    qbo.read = () => {
      throw new QuickBooksApiError(400, "Object Not Found");
    };

    const result = await pushInvoiceToQuickBooks(INVOICE_ID);

    expect(result.ok).toBe(false);
    expect(invoiceLink()?.qboId).toBe("999");
  });
});

describe("an invoice QuickBooks already holds is adopted, not created again", () => {
  it("looks the DocNumber up before creating, and updates what it finds", async () => {
    // The window no reordering can close: `accountingRequest` retries a
    // POST after a transport rejection, and undici rejects AFTER the request
    // bytes are sent — so attempt 1 can create the invoice and attempt 2
    // create a second. Same for a function timeout between the create and
    // the link write. In both, QuickBooks holds a document Prova has no id
    // for, and only a lookup on the natural key finds it.
    qbo.findByDocNumber = () => [{ Id: "1042", SyncToken: "5", DocNumber: DOC_NUMBER }];

    const result = await pushInvoiceToQuickBooks(INVOICE_ID);

    expect(result.ok).toBe(true);
    expect(qbo.docNumberLookups).toEqual([DOC_NUMBER]);
    expect(qbo.pushed).toHaveLength(1);
    expect(qbo.pushed[0].Id).toBe("1042");
    expect(qbo.pushed[0].SyncToken).toBe("5");
  });

  it("refuses rather than guessing when QuickBooks already holds two", async () => {
    // The damage this bug leaves behind, met on a later click. Two invoices
    // under one DocNumber means somebody's A/R is already double-counted;
    // adopting either one silently is a guess about which of them is the
    // real one, and creating a third is worse.
    qbo.findByDocNumber = () => [
      { Id: "1042", SyncToken: "5", DocNumber: DOC_NUMBER },
      { Id: "1043", SyncToken: "0", DocNumber: DOC_NUMBER },
    ];

    const result = await pushInvoiceToQuickBooks(INVOICE_ID);

    expect(result.ok).toBe(false);
    expect(qbo.pushed).toHaveLength(0);
    expect(invoiceLink()).toBeUndefined();
    if (!result.ok) expect(result.error).toMatch(/1042/);
  });

  it("creates NOTHING when it cannot find out what QuickBooks holds", async () => {
    // Falling through to a create here would be the whole bug again, just
    // reached by a different door: creating on the strength of a question
    // we never got an answer to.
    qbo.findByDocNumber = () => {
      throw new QuickBooksApiError(503, "ServiceUnavailable");
    };

    const result = await pushInvoiceToQuickBooks(INVOICE_ID);

    expect(result.ok).toBe(false);
    expect(qbo.pushed).toHaveLength(0);
    expect(invoiceLink()).toBeUndefined();
  });

  it("still creates when QuickBooks genuinely holds nothing under that number", async () => {
    const result = await pushInvoiceToQuickBooks(INVOICE_ID);

    expect(result.ok).toBe(true);
    expect(qbo.docNumberLookups).toEqual([DOC_NUMBER]);
    expect(qbo.pushed).toHaveLength(1);
    expect(qbo.pushed[0].Id).toBeUndefined();
  });
});
