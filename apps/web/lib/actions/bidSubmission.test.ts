import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * SUBMITTING A BID PACKAGE TO A GENERAL CONTRACTOR.
 *
 * ── WHY THIS FILE EXISTS, AND IT IS A MUTATION RESULT RATHER THAN A HUNCH ──
 *
 * `submitBidPackage` shipped its first draft with every guard in place and
 * NONE of them proven. A mutation run over the suite that existed then came
 * back green on seven separate changes to this action's body, including the
 * three that matter most:
 *
 *   - marking the bid SUBMITTED when the send had FAILED;
 *   - never deleting the uploaded package, leaving a public-readable PDF of a
 *     company's pricing in the store;
 *   - skipping `documentUrlProblem`, so any URL could be fetched and mailed.
 *
 * `action-capability-guards.test.ts` executes the action, which is why those
 * reads looked covered — but it executes it as a principal who is refused at
 * the first line, and as one who gets through to fail at the next. Nothing
 * reached the body. That is the "written, documented, and never called" shape
 * wearing a guard's clothes.
 *
 * ── ITS OWN HARNESS, NOT `messages.test.ts`'s ──
 *
 * `FakeDb.findFirst` takes a `where` and its `withIncludes` understands one
 * relation. This action reads a bid with its contact and that contact's
 * people, so it needs a fake that can answer that shape. Extending the shared
 * one for a single caller would make every other suite depend on it.
 */

const PDF = Buffer.from("%PDF-1.7 a real-enough package");

const context = {
  company: { id: "co_1", name: "Cyrus Drywall" },
  id: "user_1",
  role: "OWNER" as string,
  jobFunction: null as string | null,
};

let allowed = true;
let bid: Record<string, unknown> | null;
let updated: { where: unknown; data: Record<string, unknown> }[] = [];
let messages: Record<string, unknown>[] = [];
let events: Record<string, unknown>[] = [];

const sendEmail = vi.fn();
const deleteDocument = vi.fn(async () => {});
const documentUrlProblem = vi.fn(() => null as string | null);
const outboundEmailAllowance = vi.fn(async () => ({ ok: true }) as { ok: boolean; error?: string });
const setupProblem = vi.fn(() => null as string | null);

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/permissions", () => ({ can: () => allowed }));
vi.mock("@/lib/blob", () => ({ deleteDocument: (...a: unknown[]) => deleteDocument(...(a as [])) }));

vi.mock("@/lib/outbound-email-limit", () => ({
  outboundEmailAllowance: (...a: unknown[]) => outboundEmailAllowance(...(a as [])),
}));

vi.mock("@prova/integrations", () => ({
  emailSetupProblem: () => setupProblem(),
  looksLikeEmail: (v: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v),
  readEmailConfig: () => ({ provider: "resend", apiKey: "k", from: "office@cyrus.test", webhookSecret: null }),
  sendEmail: (...a: unknown[]) => sendEmail(...a),
}));

vi.mock("@/lib/document-uploads", async (importOriginal) => {
  const real = (await importOriginal()) as Record<string, unknown>;
  return { ...real, documentUrlProblem: (...a: unknown[]) => documentUrlProblem(...(a as [])) };
});

vi.mock("@prova/db", () => ({
  prisma: {
    bidInvitation: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        bid && (where.companyId === undefined || where.companyId === bid.companyId) ? bid : null,
      update: async (args: { where: unknown; data: Record<string, unknown> }) => {
        updated.push(args);
        return {};
      },
    },
    outboundMessage: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `msg_${messages.length + 1}`, ...data };
        messages.push(row);
        return row;
      },
      update: async () => ({}),
    },
    outboundMessageEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `ev_${events.length + 1}`, ...data };
        events.push(row);
        return row;
      },
      update: async () => ({}),
      delete: async () => ({}),
    },
    $transaction: async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]),
  },
}));

const { submitBidPackage } = await import("./messages");

const URL_IN_STORE = "https://store.public.blob.vercel-storage.com/bid-packages/co_1/p.pdf";

beforeEach(() => {
  allowed = true;
  updated = [];
  messages = [];
  events = [];
  vi.clearAllMocks();
  documentUrlProblem.mockReturnValue(null);
  setupProblem.mockReturnValue(null);
  outboundEmailAllowance.mockResolvedValue({ ok: true });
  sendEmail.mockResolvedValue({ ok: true, providerMessageId: "prov_1", from: "office@cyrus.test" });
  bid = {
    id: "bid_1",
    companyId: "co_1",
    contactId: "gc_1",
    status: "INVITED",
    contact: {
      id: "gc_1",
      name: "Turner Construction",
      email: "bids@turner.com",
      people: [{ name: "Dana Reyes", email: "dana@turner.com" }],
    },
  };
  globalThis.fetch = (async () =>
    new Response(PDF, { status: 200, headers: { "content-type": "application/pdf" } })) as typeof fetch;
});

function form(over: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set("confirmSend", "on");
  fd.set("subject", "West Herr Jaguar — bid from Cyrus Drywall");
  fd.set("body", "Our bid is attached.");
  fd.set("fileName", "west-herr-bid-package.pdf");
  for (const [k, v] of Object.entries(over)) {
    if (v === "") fd.delete(k);
    else fd.set(k, v);
  }
  return fd;
}

const submit = (over?: Record<string, string>) => submitBidPackage("bid_1", URL_IN_STORE, form(over));

describe("it sends the package and records what went out", () => {
  it("attaches the bytes under the name the package was built with", async () => {
    expect(await submit()).toEqual({ ok: true });

    const sentWith = sendEmail.mock.calls[0]![0] as Record<string, unknown>;
    expect(sentWith.attachments).toEqual([
      { filename: "west-herr-bid-package.pdf", content: PDF },
    ]);
    expect(sentWith.to).toBe("dana@turner.com");
  });

  it("links the message to the bid, which needs no migration to do", async () => {
    await submit();
    expect(messages[0]).toMatchObject({ relatedType: "BID_INVITATION", relatedId: "bid_1" });
  });

  it("claims the handover BEFORE the provider is called", async () => {
    // #111's ordering, inherited by calling `deliverEmail` rather than
    // re-implementing it. A send recorded after the fact is one that can be
    // deleted as though it never happened.
    let eventsWhenSent = -1;
    sendEmail.mockImplementation(async () => {
      eventsWhenSent = events.length;
      return { ok: true, providerMessageId: "prov_1", from: "office@cyrus.test" };
    });
    await submit();
    expect(eventsWhenSent).toBe(1);
    expect(events[0]).toMatchObject({ type: "QUEUED" });
  });

  it("marks the bid SUBMITTED", async () => {
    await submit();
    expect(updated).toHaveLength(1);
    expect(updated[0]!.data).toEqual({ status: "SUBMITTED" });
  });
});

describe("THE BID IS NOT MARKED SENT WHEN IT WAS NOT SENT", () => {
  // The most expensive mutation this file was written for. An estimator
  // reading "Submitted" on a bid the GC never received, on bid day, is the
  // whole failure.
  it("leaves the status alone when the provider refuses", async () => {
    sendEmail.mockResolvedValue({ ok: false, error: "Domain not verified", configured: true });
    const result = await submit();
    expect(result).toMatchObject({ ok: false });
    expect(updated).toEqual([]);
  });

  it("leaves the status alone when the rate cap refuses", async () => {
    outboundEmailAllowance.mockResolvedValue({ ok: false, error: "Too many emails today" });
    expect(await submit()).toMatchObject({ ok: false, error: "Too many emails today" });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(updated).toEqual([]);
  });
});

describe("THE UPLOADED PACKAGE IS DELETED ON EVERY PATH", () => {
  // It holds a company's pricing and the store is public-read. `quoteRead.ts`
  // paid for this lesson with five early returns that each stranded a file.
  it("after a successful send", async () => {
    await submit();
    expect(deleteDocument).toHaveBeenCalledWith(URL_IN_STORE);
  });

  it("after a refused send", async () => {
    sendEmail.mockResolvedValue({ ok: false, error: "nope", configured: true });
    await submit();
    expect(deleteDocument).toHaveBeenCalledWith(URL_IN_STORE);
  });

  it("after the rate cap refuses", async () => {
    outboundEmailAllowance.mockResolvedValue({ ok: false, error: "capped" });
    await submit();
    expect(deleteDocument).toHaveBeenCalledWith(URL_IN_STORE);
  });

  it("after the store will not give the bytes back", async () => {
    globalThis.fetch = (async () => new Response("", { status: 404 })) as typeof fetch;
    expect(await submit()).toMatchObject({ ok: false });
    expect(deleteDocument).toHaveBeenCalledWith(URL_IN_STORE);
  });

  it("but NOT before the setup check, which refuses without touching it", async () => {
    // An install that cannot send at all should not delete somebody's package
    // in order to tell them so.
    setupProblem.mockReturnValue("Email sending isn't set up yet.");
    expect(await submit()).toMatchObject({ ok: false, error: "Email sending isn't set up yet." });
    expect(deleteDocument).not.toHaveBeenCalled();
  });
});

describe("what it refuses, and the order it refuses in", () => {
  it("refuses without MANAGE_ESTIMATING, before anything is read", async () => {
    allowed = false;
    expect(await submit()).toMatchObject({ ok: false });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(deleteDocument).not.toHaveBeenCalled();
  });

  it("REFUSES ANOTHER COMPANY'S BID", async () => {
    // The id in the argument is a claim; the companyId in the where is the
    // check. One blob store and one database serve every tenant.
    bid = { ...bid!, companyId: "co_2" };
    expect(await submit()).toMatchObject({ ok: false, error: "Bid not found" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("CHECKS THE URL IS OURS AND THIS COMPANY'S, and obeys the answer", async () => {
    documentUrlProblem.mockReturnValue("That file did not come from this app's storage.");
    expect(await submit()).toMatchObject({
      ok: false,
      error: "That file did not come from this app's storage.",
    });
    expect(sendEmail).not.toHaveBeenCalled();
    // And asked the right question — the purpose and the owner are what make
    // the check mean anything.
    expect(documentUrlProblem).toHaveBeenCalledWith(URL_IN_STORE, "bid-package", "co_1", process.env);
  });

  it("REQUIRES THE NAMED-INTENT CONFIRM", async () => {
    expect(await submit({ confirmSend: "" })).toMatchObject({ ok: false });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("REFUSES AN ADDRESS THAT IS NOT ON THE GC'S RECORD", async () => {
    const result = await submit({ toAddress: "someone@elsewhere.test" });
    expect(result).toMatchObject({ ok: false });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("accepts an address that IS on the record, including a second person", async () => {
    expect(await submit({ toAddress: "bids@turner.com" })).toEqual({ ok: true });
    expect((sendEmail.mock.calls[0]![0] as Record<string, unknown>).to).toBe("bids@turner.com");
  });

  it("refuses when the GC has no address at all", async () => {
    bid = { ...bid!, contact: { id: "gc_1", name: "Turner Construction", email: null, people: [] } };
    expect(await submit()).toMatchObject({ ok: false });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("refuses something the store serves that is not a PDF", async () => {
    globalThis.fetch = (async () =>
      new Response("hello", { status: 200, headers: { "content-type": "text/plain" } })) as typeof fetch;
    expect(await submit()).toMatchObject({ ok: false });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("refuses an empty package", async () => {
    globalThis.fetch = (async () =>
      new Response(Buffer.alloc(0), {
        status: 200,
        headers: { "content-type": "application/pdf" },
      })) as typeof fetch;
    expect(await submit()).toMatchObject({ ok: false });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
