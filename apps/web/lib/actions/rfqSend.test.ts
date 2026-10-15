import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * SENDING A REQUEST FOR QUOTE.
 *
 * ── WRITTEN FIRST THIS TIME, BECAUSE THE LAST ONE WAS NOT ──
 *
 * `submitBidPackage` shipped its first draft with every guard in place and none
 * proven: seven mutations of its body came back green, including marking a bid
 * SUBMITTED after a FAILED send. They were green because
 * `action-capability-guards.test.ts` executes the action as a principal refused
 * at the first line, and as one who gets through to fail at the next — so
 * nothing ever reached the body while the guards looked covered.
 *
 * This action has the same shape, so it gets the same treatment up front.
 *
 * Its own harness for `bidSubmission.test.ts`'s reason: `FakeDb` cannot express
 * the nested include this action reads (a quote, its vendor, and its bid's spec
 * sections and addenda).
 */

const PDF = Buffer.from("%PDF-1.7 a spec section");

const context = {
  company: { id: "co_1", name: "Cyrus Drywall" },
  id: "user_1",
  role: "OWNER" as string,
  jobFunction: null as string | null,
};

let allowed = true;
let quote: Record<string, unknown> | null;
let quoteUpdates: { where: unknown; data: Record<string, unknown> }[] = [];

const sendEmail = vi.fn();
const documentUrlProblem = vi.fn(() => null as string | null);
const outboundEmailAllowance = vi.fn(async () => ({ ok: true }) as { ok: boolean; error?: string });
const setupProblem = vi.fn(() => null as string | null);

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/permissions", () => ({ can: () => allowed }));
vi.mock("@/lib/blob", () => ({ deleteDocument: async () => {} }));

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
    bidQuote: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        quote && (where.companyId === undefined || where.companyId === quote.companyId) ? quote : null,
      update: async (args: { where: unknown; data: Record<string, unknown> }) => {
        quoteUpdates.push(args);
        return {};
      },
    },
    outboundMessage: {
      create: async ({ data }: { data: Record<string, unknown> }) => ({ id: "msg_1", ...data }),
      update: async () => ({}),
    },
    outboundMessageEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => ({ id: "ev_1", ...data }),
      update: async () => ({}),
      delete: async () => ({}),
    },
    $transaction: async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]),
  },
}));

const { sendQuoteRequest } = await import("./messages");

const SPEC_URL = "https://store.public.blob.vercel-storage.com/bid-spec-sections/co_1/s.pdf";
const ADDENDUM_URL = "https://store.public.blob.vercel-storage.com/bid-addenda/co_1/a.pdf";

beforeEach(() => {
  allowed = true;
  quoteUpdates = [];
  vi.clearAllMocks();
  documentUrlProblem.mockReturnValue(null);
  setupProblem.mockReturnValue(null);
  outboundEmailAllowance.mockResolvedValue({ ok: true });
  sendEmail.mockResolvedValue({ ok: true, providerMessageId: "prov_1", from: "office@cyrus.test" });
  quote = {
    id: "q_1",
    companyId: "co_1",
    packageLabel: "Metal stud framing",
    vendorName: "Alpha Supply",
    requestedOn: null,
    vendor: { id: "v_1", name: "Alpha Supply", contactName: "Jo Patel", email: "jo@alpha.test" },
    bidInvitation: {
      id: "bid_1",
      projectName: "West Herr Jaguar",
      specSections: [{ id: "s_1", sectionNumber: "09 21 16", fileUrl: SPEC_URL, fileName: "09-21-16.pdf" }],
      addenda: [{ id: "a_1", reference: "Addendum 2", fileUrl: ADDENDUM_URL, fileName: "add-2.pdf" }],
    },
  };
  globalThis.fetch = (async () =>
    new Response(PDF, { status: 200, headers: { "content-type": "application/pdf" } })) as typeof fetch;
});

function form(docIds: string[] = ["s_1"], over: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set("subject", "Metal stud framing — quote request for West Herr Jaguar");
  fd.set("body", "Please quote.");
  for (const id of docIds) fd.append("documentId", id);
  for (const [k, v] of Object.entries(over)) {
    if (v === "") fd.delete(k);
    else fd.set(k, v);
  }
  return fd;
}

const send = (docIds?: string[], over?: Record<string, string>) =>
  sendQuoteRequest("q_1", form(docIds, over));

describe("it sends the supplier the pages they need", () => {
  it("attaches the chosen documents under their own names", async () => {
    expect(await send(["s_1", "a_1"])).toEqual({ ok: true });
    const sent = sendEmail.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent.attachments).toEqual([
      { filename: "09-21-16.pdf", content: PDF },
      { filename: "add-2.pdf", content: PDF },
    ]);
  });

  it("goes to the vendor's own address, named", async () => {
    await send();
    const sent = sendEmail.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent.to).toBe("jo@alpha.test");
    expect(sent.toName).toBe("Jo Patel");
  });

  it("CHECKS EACH DOCUMENT AGAINST ITS OWN PURPOSE", async () => {
    // A spec section checked as an addendum is checked against the wrong
    // folder, and the whole value of `documentUrlProblem` is that the file sits
    // under THAT purpose's prefix for THIS company.
    await send(["s_1", "a_1"]);
    expect(documentUrlProblem).toHaveBeenNthCalledWith(1, SPEC_URL, "bid-spec-section", "co_1", process.env);
    expect(documentUrlProblem).toHaveBeenNthCalledWith(2, ADDENDUM_URL, "bid-addendum", "co_1", process.env);
  });

  it("sends with nothing attached when nothing was chosen", async () => {
    // Legitimate: a supplier who already has the drawings just needs asking.
    expect(await send([])).toEqual({ ok: true });
    expect((sendEmail.mock.calls[0]![0] as Record<string, unknown>).attachments).toEqual([]);
  });

  it("links the message to the quote row", async () => {
    await send();
    const created = sendEmail.mock.calls.length;
    expect(created).toBe(1);
  });
});

describe("when the request was first made", () => {
  it("STAMPS `requestedOn` ON A SEND, because that is when it happened", async () => {
    // Every other date on this model is entered, because it records something
    // that happened elsewhere. This one happened in this process a line ago.
    await send();
    expect(quoteUpdates).toHaveLength(1);
    expect(quoteUpdates[0]!.data.requestedOn).toBeInstanceOf(Date);
  });

  it("DOES NOT REWRITE IT when the request was already recorded", async () => {
    // Re-sending must not move the date `requestState` reads "overdue" off.
    quote = { ...quote!, requestedOn: new Date("2026-10-01") };
    await send();
    expect(quoteUpdates).toEqual([]);
  });

  it("does not stamp it when the send failed", async () => {
    sendEmail.mockResolvedValue({ ok: false, error: "refused", configured: true });
    expect(await send()).toMatchObject({ ok: false });
    expect(quoteUpdates).toEqual([]);
  });
});

describe("what it refuses", () => {
  it("refuses without MANAGE_ESTIMATING", async () => {
    allowed = false;
    expect(await send()).toMatchObject({ ok: false });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("refuses another company's quote row", async () => {
    quote = { ...quote!, companyId: "co_2" };
    expect(await send()).toMatchObject({ ok: false });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("REFUSES A DOCUMENT THAT IS NOT ON THIS BID", async () => {
    // The form says WHICH to attach. It does not say where they are, and an id
    // from somewhere else must not resolve to a file.
    expect(await send(["s_1", "somebody_elses_doc"])).toMatchObject({ ok: false });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("refuses when the URL check fails, naming which document", async () => {
    documentUrlProblem.mockReturnValue("That file did not come from this app's storage.");
    const result = await send();
    expect(result).toMatchObject({ ok: false });
    expect(!result.ok && result.error).toContain("09 21 16");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("refuses when the vendor has no address, and says where to fix it", async () => {
    quote = { ...quote!, vendor: { id: "v_1", name: "Alpha Supply", contactName: null, email: null } };
    const result = await send();
    expect(!result.ok && result.error).toMatch(/Vendors page/i);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("refuses a quote that names no recorded vendor at all", async () => {
    quote = { ...quote!, vendor: null };
    expect(await send()).toMatchObject({ ok: false });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("refuses before the network when sending is not set up", async () => {
    setupProblem.mockReturnValue("Email sending isn't set up yet.");
    expect(await send()).toMatchObject({ ok: false, error: "Email sending isn't set up yet." });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("obeys the rate cap", async () => {
    outboundEmailAllowance.mockResolvedValue({ ok: false, error: "Too many emails today" });
    expect(await send()).toMatchObject({ ok: false, error: "Too many emails today" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("REFUSES A SET THAT CANNOT FIT ONE EMAIL", async () => {
    // Each file passed its own upload ceiling, maybe months apart. Four
    // legitimate documents are still one impossible message.
    const huge = Buffer.alloc(30 * 1024 * 1024);
    huge.set(Buffer.from("%PDF-"));
    globalThis.fetch = (async () =>
      new Response(huge, { status: 200, headers: { "content-type": "application/pdf" } })) as typeof fetch;
    const result = await send(["s_1", "a_1"]);
    expect(result).toMatchObject({ ok: false });
    expect(!result.ok && result.error).toMatch(/MB/);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("refuses a stored file the store will not give back", async () => {
    globalThis.fetch = (async () => new Response("", { status: 404 })) as typeof fetch;
    const result = await send();
    expect(result).toMatchObject({ ok: false });
    expect(!result.ok && result.error).toContain("09 21 16");
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
