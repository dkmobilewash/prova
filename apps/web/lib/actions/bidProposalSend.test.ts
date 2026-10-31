import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `sendBidProposal` — C Stream Bid's "Send the proposal to <GC>".
 *
 * Its own harness, like `bidSubmission.test.ts`, and for that file's reason:
 * `action-capability-guards.test.ts` executes this action only as somebody
 * refused at the first line, so nothing there reaches the body. Here the
 * loader (`loadProposalSend`, which has its own database test) is replaced by
 * a view the test states outright, and the database by a recorder, so every
 * guard in the body can be shown to refuse BEFORE a message row exists and the
 * status can be shown to move only on a send that went.
 */

const context = {
  company: { id: "co_1", name: "Cyrus Drywall" },
  id: "user_1",
  role: "OWNER" as string,
  jobFunction: null as string | null,
};

type View = Record<string, unknown>;

let allowed = true;
let env: Record<string, string | undefined> = {};
let view: View;
let loadResult: { ok: true; view: View } | { ok: false; problem: string };
let updated: { where: Record<string, unknown>; data: Record<string, unknown> }[] = [];
/** What the conditional writes find: how many rows still match their `where`. */
let invitationRow: { status: string; bidAmount: string | null } = { status: "INVITED", bidAmount: null };
let updateThrows = false;
let messages: Record<string, unknown>[] = [];
let events: Record<string, unknown>[] = [];
const loadCalls: unknown[] = [];

const sendEmail = vi.fn();
const runAgent = vi.fn();
const outboundEmailAllowance = vi.fn(async () => ({ ok: true }) as { ok: boolean; error?: string });

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/permissions", () => ({ can: (_c: unknown, capability: string) => allowed && capability === "MANAGE_ESTIMATING" }));
vi.mock("@/lib/viewerToday", () => ({ viewerTimeZone: async () => "UTC" }));
vi.mock("@/lib/agents/onEvent", () => ({ runAgentAfterResponse: (...a: unknown[]) => runAgent(...a) }));
vi.mock("@/lib/outbound-email-limit", () => ({
  outboundEmailAllowance: (...a: unknown[]) => outboundEmailAllowance(...(a as [])),
}));
vi.mock("@/lib/estimating/proposal-send-query", () => ({
  loadProposalSend: async (input: unknown) => {
    loadCalls.push(input);
    return loadResult;
  },
}));
vi.mock("@/lib/estimating/proposal-send", async (importOriginal) => {
  const real = (await importOriginal()) as Record<string, unknown>;
  return { ...real, deploymentSendRefusal: () => (real.deploymentSendRefusal as (e: unknown) => string | null)(env) };
});
vi.mock("@prova/integrations", () => ({
  emailSetupProblem: () => null,
  looksLikeEmail: (v: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v),
  readEmailConfig: () => ({ provider: "resend", apiKey: "k", from: "office@cyrus.test", webhookSecret: null }),
  sendEmail: (...a: unknown[]) => sendEmail(...a),
}));
vi.mock("@prova/db", () => ({
  prisma: {
    bidInvitation: {
      // A real-enough updateMany: it writes only when the row still matches.
      updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (updateThrows) throw new Error("connection reset");
        const matches = Object.entries(args.where).every(([key, value]) =>
          key === "id" || key === "companyId" ? true : (invitationRow as Record<string, unknown>)[key] === value,
        );
        if (!matches) return { count: 0 };
        updated.push(args);
        Object.assign(invitationRow, args.data);
        return { count: 1 };
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

const { sendBidProposal } = await import("./messages");
const { proposalFingerprint } = await import("@/lib/estimating/proposal-send");

beforeEach(() => {
  allowed = true;
  env = { VERCEL_ENV: "production" };
  updated = [];
  invitationRow = { status: "INVITED", bidAmount: null };
  updateThrows = false;
  messages = [];
  events = [];
  loadCalls.length = 0;
  vi.clearAllMocks();
  outboundEmailAllowance.mockResolvedValue({ ok: true });
  sendEmail.mockResolvedValue({ ok: true, providerMessageId: "prov_1", from: "office@cyrus.test" });
  view = {
    jobId: "job_1",
    invitationId: "inv_1",
    contactId: "gc_1",
    status: "INVITED",
    bidAmountIsBlank: true,
    gcName: "Turner Construction",
    projectName: "Riverside Medical",
    companyName: "Cyrus Drywall",
    mode: "lump",
    lineCount: 3,
    totalCents: 350_000,
    recipients: [
      { address: "dana@turner.com", name: "Dana Reyes" },
      { address: "bids@turner.com", name: "Turner Construction" },
    ],
    blocker: null,
    subject: "Proposal — Riverside Medical — Cyrus Drywall",
    coverNote: "Hello",
    documentText: "PROPOSAL — Riverside Medical\nLump sum for the work described in this proposal: $3,500.00",
    history: [],
  };
  loadResult = { ok: true, view };
});

function form(over: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set("mode", "lump");
  fd.set("priceCents", "350000");
  fd.set("documentFingerprint", proposalFingerprint(String(view.documentText)));
  fd.set("toAddress", "dana@turner.com");
  fd.set("subject", "Proposal — Riverside Medical — Cyrus Drywall");
  fd.set("body", "Hello Turner, our proposal is below.");
  fd.set("confirmSend", "yes");
  for (const [k, v] of Object.entries(over)) {
    if (v === "") fd.delete(k);
    else fd.set(k, v);
  }
  return fd;
}

const send = (over?: Record<string, string>) => sendBidProposal("job_1", "inv_1", form(over));

function nothingWritten() {
  expect(messages).toEqual([]);
  expect(sendEmail).not.toHaveBeenCalled();
  expect(updated).toEqual([]);
}

describe("it sends the proposal and records the copy that went", () => {
  it("emails the chosen address with the note, a divider and the server's document", async () => {
    expect(await send()).toEqual({ ok: true });
    const sentWith = sendEmail.mock.calls[0]![0] as { to: string; toName: string; subject: string; text: string; attachments?: unknown };
    expect(sentWith.to).toBe("dana@turner.com");
    expect(sentWith.toName).toBe("Dana Reyes");
    expect(sentWith.subject).toBe("Proposal — Riverside Medical — Cyrus Drywall");
    expect(sentWith.text.startsWith("Hello Turner, our proposal is below.")).toBe(true);
    expect(sentWith.text).toContain("Lump sum for the work described in this proposal: $3,500.00");
    expect(sentWith.attachments).toBeUndefined();
  });

  it("records the WHOLE body against the invitation and the job", async () => {
    await send();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ relatedType: "BID_INVITATION", relatedId: "inv_1", jobId: "job_1", toAddress: "dana@turner.com" });
    expect(messages[0]!.body).toContain("PROPOSAL — Riverside Medical");
    expect(events[0]).toMatchObject({ type: "QUEUED" });
  });

  it("never takes the document from the form", async () => {
    await send({ documentText: "PROPOSAL — $1.00", body: "Note" });
    const text = (sendEmail.mock.calls[0]![0] as { text: string }).text;
    expect(text).not.toContain("$1.00");
    expect(text).toContain("$3,500.00");
  });

  it("reads the mode off the form for the loader", async () => {
    await send({ mode: "itemized" });
    expect(loadCalls[0]).toMatchObject({ mode: "itemized", jobId: "job_1", invitationId: "inv_1", companyId: "co_1" });
  });

  it("marks an INVITED bid SUBMITTED, fills a blank bid amount with the price sent, and runs the estimate check", async () => {
    expect(await send()).toEqual({ ok: true });
    expect(updated).toEqual([
      { where: { id: "inv_1", companyId: "co_1", status: "INVITED" }, data: { status: "SUBMITTED" } },
      { where: { id: "inv_1", companyId: "co_1", bidAmount: null }, data: { bidAmount: "3500.00" } },
    ]);
    expect(runAgent).toHaveBeenCalledWith({ companyId: "co_1", agent: "ESTIMATE_CHECK", bidInvitationId: "inv_1" });
  });

  it("leaves a SUBMITTED bid's status and an entered bid amount alone on a re-send", async () => {
    view.status = "SUBMITTED";
    view.bidAmountIsBlank = false;
    invitationRow = { status: "SUBMITTED", bidAmount: "3400.00" };
    expect(await send()).toEqual({ ok: true });
    expect(updated).toEqual([]);
    expect(runAgent).not.toHaveBeenCalled();
    expect(messages).toHaveLength(1);
  });

  it("never overwrites a WON or DECLINED set by somebody else while the page was open", async () => {
    // The page read INVITED; by the time the email has gone, the row says otherwise.
    for (const status of ["WON", "DECLINED", "LOST"]) {
      updated = [];
      runAgent.mockClear();
      invitationRow = { status, bidAmount: null };
      expect(await send()).toEqual({ ok: true });
      expect(invitationRow.status).toBe(status);
      expect(updated.some((one) => "status" in one.data)).toBe(false);
      expect(runAgent).not.toHaveBeenCalled();
    }
  });

  it("does not overwrite an amount typed in while the page was open", async () => {
    invitationRow = { status: "INVITED", bidAmount: "3333.00" };
    await send();
    expect(invitationRow.bidAmount).toBe("3333.00");
  });

  it("defaults to the first recorded address when none is chosen", async () => {
    await send({ toAddress: "" });
    expect((sendEmail.mock.calls[0]![0] as { to: string }).to).toBe("dana@turner.com");
  });
});

describe("ONCE THE EMAIL HAS GONE, THE ANSWER IS SENT", () => {
  it("a bid-log write that throws after delivery is a success with a note, not an error", async () => {
    updateThrows = true;
    const result = await send();
    expect(result).toEqual({
      ok: true,
      note: "Sent. The bid log couldn't be updated — mark it Submitted by hand. Don't send it again.",
    });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(messages).toHaveLength(1);
    expect(runAgent).not.toHaveBeenCalled();
  });
});

describe("THE BID IS NOT MARKED SENT WHEN IT WAS NOT SENT", () => {
  it("leaves the status alone when the provider refuses", async () => {
    sendEmail.mockResolvedValue({ ok: false, error: "Domain not verified", configured: true });
    expect(await send()).toMatchObject({ ok: false, error: "Domain not verified" });
    expect(updated).toEqual([]);
    expect(runAgent).not.toHaveBeenCalled();
    // The failure is still on the record.
    expect(events.map((event) => event.type)).toContain("FAILED");
  });

  it("refuses at the rate cap before writing anything", async () => {
    outboundEmailAllowance.mockResolvedValue({ ok: false, error: "Too many emails today" });
    expect(await send()).toEqual({ ok: false, error: "Too many emails today" });
    nothingWritten();
  });
});

describe("every refusal comes before a message row exists", () => {
  it("refuses without MANAGE_ESTIMATING before reading anything", async () => {
    allowed = false;
    expect(await send()).toEqual({ ok: false, error: "Estimating isn't part of your job function." });
    expect(loadCalls).toEqual([]);
    nothingWritten();
  });

  it.each([{ VERCEL_ENV: "preview" }, { VERCEL_ENV: "development" }, {}])(
    "refuses off production (%o) before reading anything",
    async (deployment) => {
      env = deployment;
      const result = await send();
      expect(result).toMatchObject({ ok: false });
      expect((result as { error: string }).error).toContain("nothing is sent from here");
      expect(loadCalls).toEqual([]);
      nothingWritten();
    },
  );

  it("refuses an invitation the loader cannot find", async () => {
    loadResult = { ok: false, problem: "That GC's bid isn't on this estimate any more. Reload the page." };
    expect(await send()).toEqual({ ok: false, error: "That GC's bid isn't on this estimate any more. Reload the page." });
    nothingWritten();
  });

  it("refuses with the blocker's own sentence", async () => {
    view.blocker = "This bid is marked won, so there is no proposal to send for it.";
    expect(await send()).toEqual({ ok: false, error: "This bid is marked won, so there is no proposal to send for it." });
    nothingWritten();
  });

  it("refuses when ANY of the document moved, even with the total unchanged", async () => {
    // The page showed one alternate price; the bid form now says another.
    const shown = proposalFingerprint(String(view.documentText));
    view.documentText = `${view.documentText}\nALTERNATES\nAlt 1: Add $900.00`;
    expect(await send({ documentFingerprint: shown })).toEqual({
      ok: false,
      error: "This proposal changed since the page was opened — a price, a line or a clause is different now. Reload the page and read it again before sending.",
    });
    nothingWritten();
  });

  it.each(["", "abc", "0".repeat(64)])("refuses a missing or forged fingerprint %j", async (fingerprint) => {
    expect(await send({ documentFingerprint: fingerprint })).toMatchObject({ ok: false, error: expect.stringContaining("changed since") });
    nothingWritten();
  });

  it("refuses when the price moved since the page was drawn", async () => {
    expect(await send({ priceCents: "349999" })).toMatchObject({ ok: false, error: expect.stringContaining("price on this proposal changed") });
    nothingWritten();
  });

  it("refuses an address that is not on the GC's contact", async () => {
    expect(await send({ toAddress: "someone@else.com" })).toMatchObject({ ok: false, error: expect.stringContaining("isn't on this GC's contact") });
    nothingWritten();
  });

  it("refuses without the second press", async () => {
    expect(await send({ confirmSend: "" })).toEqual({ ok: false, error: 'Press "Yes, send it" to confirm it is going to Turner Construction.' });
    expect(await send({ confirmSend: "on" })).toMatchObject({ ok: false });
    nothingWritten();
  });

  it("refuses an empty note or subject", async () => {
    expect(await send({ body: "" })).toEqual({ ok: false, error: "Message is required" });
    expect(await send({ subject: "" })).toEqual({ ok: false, error: "Subject is required" });
    nothingWritten();
  });
});
