import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/fake-prisma";

/**
 * The evidence hole in `sendOutboundEmail` (#111, severity DATA-LOST).
 *
 * The provider was called first and the record of the handover written
 * afterwards, in a separate transaction. Everything between those two
 * points is a window where the email HAS GONE to a real person and the
 * database says otherwise — no `providerMessageId`, no events at all. The
 * log then reads "No word back yet", and `reachedProvider` — the guard on
 * deletion, whose own comment says removing such a row would "destroy the
 * evidence that they received it" — sees nothing and lets it be deleted.
 *
 * These are ordering tests, so they assert on the order of writes and on
 * what survives a write that throws. A return value cannot show either.
 *
 * `notification-dispatch.ts` states the principle these tests encode:
 * "THE ORDER IS THE DESIGN ... claimed BEFORE the provider is called ... A
 * crash between sending and recording is then a notice that was sent and
 * recorded". Overstating a send is recoverable — a person checks. Losing
 * one is not.
 */

/** `providerMessageId` is nullable in the schema, and `reachedProvider`
 * tests it against `null` specifically. A fake that left it `undefined`
 * would answer that guard wrongly. */
const newDb = () =>
  new FakeDb().defaults("outboundMessage", { providerMessageId: null });

let db = newDb();
const context = {
  company: { id: "co_1" },
  id: "user_1",
  role: "OWNER" as string,
  jobFunction: null as string | null,
};

const sendEmail = vi.fn();

/** Defaults to "allowed" (set in beforeEach, below) so the #111 ordering
 * tests above, and every other test that isn't specifically about the
 * cap, are unaffected by it. Tests of the cap itself override this per
 * case. Left untyped, like `sendEmail` above: a typed initial
 * implementation fixes the mock's inferred return type to that one shape,
 * and `mockResolvedValue` for the refusal shape elsewhere in this file
 * would then fail to typecheck. */
const outboundEmailAllowance = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireCompanyContext: async () => context,
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

vi.mock("@prova/db", () => ({
  get prisma() {
    return db.client();
  },
}));

vi.mock("@prova/integrations", () => ({
  looksLikeEmail: (value: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value),
  readEmailConfig: () => ({
    provider: "resend",
    apiKey: "test",
    from: "office@example.test",
    webhookSecret: null,
  }),
  sendEmail: (...args: unknown[]) => sendEmail(...args),
}));

// A separate, focused test file (outbound-email-limit.test.ts) covers the
// cap's own counting and fail-closed behaviour against a mocked
// prisma.outboundMessage.count, the same way lib/ask/usage.test.ts covers
// askAllowance. Mocked out here so these tests are about sendOutboundEmail's
// OWN wiring — that it asks, and that it obeys the answer — not about
// re-deriving the count.
vi.mock("@/lib/outbound-email-limit", () => ({
  outboundEmailAllowance: (...args: unknown[]) => outboundEmailAllowance(...args),
}));

const { deleteOutboundMessage, sendOutboundEmail, sendHelpRequestEmail } = await import("./messages");

function composed() {
  const fd = new FormData();
  fd.set("toAddress", "pm@gc.example");
  fd.set("subject", "Backcharge dispute");
  fd.set("body", "The deduction on pay app 4 is not ours.");
  return fd;
}

function messageRow() {
  const rows = db.rows("outboundMessage");
  expect(rows).toHaveLength(1);
  return rows[0];
}

function eventTypes() {
  return db.rows("outboundMessageEvent").map((event) => event.type);
}

/** The delete guard's answer, obtained by asking it rather than by
 * re-deriving it here. Two opinions about whether a message is evidence is
 * how the guard and the log come to disagree. */
async function deletionRefused() {
  const result = await deleteOutboundMessage(String(messageRow().id));
  return result.ok === false;
}

beforeEach(() => {
  vi.clearAllMocks();
  db = newDb();
  context.role = "OWNER";
  context.jobFunction = null;
  outboundEmailAllowance.mockResolvedValue({ ok: true });
});

describe("sendOutboundEmail records the handover before the provider is called", () => {
  it("writes the message and its handover event before sendEmail runs", async () => {
    let writesAtSend: string[] = [];
    sendEmail.mockImplementation(async () => {
      writesAtSend = [...db.writes];
      return { ok: true, providerMessageId: "prov_1", from: "office@example.test" };
    });

    const result = await sendOutboundEmail(composed());
    expect(result).toEqual({ ok: true });

    // The row AND the event, both already written by the time the provider
    // is reached. Not "the row" — a row with no events is exactly what the
    // delete guard reads as never-sent.
    expect(writesAtSend).toContain("outboundMessage.create");
    expect(writesAtSend).toContain("outboundMessageEvent.create");
  });

  it("keeps the evidence when the write that follows the send fails", async () => {
    sendEmail.mockImplementation(async () => {
      // Everything after this point is a database the process may lose.
      db.failNext = "outboundMessage.update";
      return { ok: true, providerMessageId: "prov_1", from: "office@example.test" };
    });

    const result = await sendOutboundEmail(composed());

    // The mail has gone. Whatever we tell the user, we must not tell them
    // it failed — that is how a GC gets two copies.
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.error).toMatch(/sent/i);
    }

    // The row survives with an event that is not FAILED, which is what
    // `reachedProvider` reads.
    expect(eventTypes()).toEqual(["QUEUED"]);
    expect(await deletionRefused()).toBe(true);
    expect(db.rows("outboundMessage")).toHaveLength(1);
  });

  it("still lets a send that never reached the provider be deleted", async () => {
    sendEmail.mockResolvedValue({
      ok: false,
      error: "Network unreachable",
      configured: true,
    });

    const result = await sendOutboundEmail(composed());
    expect(result).toEqual({ ok: false, error: "Network unreachable" });

    // The handover was written speculatively and must be taken back: there
    // is no copy anywhere, so this row is not evidence of anything and the
    // owner may remove it. A leftover QUEUED here would make every failed
    // send permanent — the fix for the hole above, over-applied.
    expect(eventTypes()).toEqual(["FAILED"]);
    expect(await deletionRefused()).toBe(false);
    expect(db.rows("outboundMessage")).toHaveLength(0);
  });

  it("keeps a send the provider accepted without returning an id", async () => {
    sendEmail.mockResolvedValue({
      ok: false,
      error: "Provider returned no id",
      configured: true,
      mayHaveSent: true,
    });

    const result = await sendOutboundEmail(composed());
    expect(result.ok).toBe(false);

    // It reached the provider, so it is QUEUED and it stays.
    expect(eventTypes()).toEqual(["QUEUED"]);
    expect(await deletionRefused()).toBe(true);
    expect(String(db.rows("outboundMessageEvent")[0].detail)).toMatch(
      /Provider returned no id/,
    );
  });
});

/**
 * ADDED IN PRE-PUSH VERIFICATION — a gap, not a defect.
 *
 * The hard-failure path swaps QUEUED for FAILED inside `$transaction`, and
 * its comment says why: "no interleaving can leave this message with
 * neither — losing the claim without recording the failure is the same
 * hole again, pointing the other way." Nothing exercised that. Replacing
 * the transaction with two sequential writes passed the whole suite.
 *
 * It is also the only thing that makes `fake-prisma`'s rollback load-
 * bearing. Before this test, `restore()` could be made a no-op, `op()`
 * could be made eager, and the transaction loop could be swapped for
 * `Promise.all`, and all nine tests still passed — sixty lines of the fake
 * asserting nothing, in a file whose header calls those exact properties
 * the reason the tests are not vacuous.
 */
describe("the FAILED swap is atomic", () => {
  it("keeps the QUEUED claim when the FAILED event cannot be written", async () => {
    sendEmail.mockImplementation(async () => {
      // Arm the failure for the second write inside the transaction. The
      // delete has already been applied by then, which is the whole point:
      // if it is not rolled back this message ends up with no events at
      // all, and `reachedProvider` reads that as never-sent.
      db.failNext = "outboundMessageEvent.create";
      return { ok: false, error: "Network unreachable", configured: true };
    });

    await expect(sendOutboundEmail(composed())).rejects.toThrow(/simulated database failure/);

    // Neither half of the swap happened. The claim is still standing, so
    // the record cannot be deleted by mistake while its true fate is
    // unknown.
    expect(eventTypes()).toEqual(["QUEUED"]);
    expect(await deletionRefused()).toBe(true);
  });
});

/**
 * #352: `sendOutboundEmail` had no capability gate and no rate cap, so any
 * member of any company could send unlimited email from the shared
 * cstream.ai domain. This is the split's guard half — `sendHelpRequestEmail`
 * below is the "stays open" half.
 *
 * The guard must run before anything is read or written, the same rule
 * `action-capability-guards.test.ts` enforces for every other capability
 * check in this codebase: a refusal that arrives after a query has already
 * run is a guard that only looks like one.
 */
describe("sendOutboundEmail is gated on MANAGE_JOBS", () => {
  it("refuses a member without MANAGE_JOBS before touching the database", async () => {
    context.role = "MEMBER";
    // ACCOUNTING holds VIEW_JOB_COSTS/MANAGE_BILLING but not MANAGE_JOBS —
    // lib/permissions.ts's BY_FUNCTION table.
    context.jobFunction = "ACCOUNTING";

    const result = await sendOutboundEmail(composed());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Jobs capability/);

    // Refused before the rate cap was even consulted, and before any row
    // exists — the guard is the very first thing this action does.
    expect(outboundEmailAllowance).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(db.rows("outboundMessage")).toHaveLength(0);
  });

  it("lets a member who DOES hold MANAGE_JOBS through to send", async () => {
    context.role = "MEMBER";
    // PROJECT_MANAGER holds MANAGE_JOBS — lib/permissions.ts's BY_FUNCTION
    // table — and is not the account owner, which is the real-world case
    // this gate has to get right: most people sending a GC email are not
    // the owner.
    context.jobFunction = "PROJECT_MANAGER";
    sendEmail.mockResolvedValue({ ok: true, providerMessageId: "prov_1", from: "office@example.test" });

    const result = await sendOutboundEmail(composed());
    expect(result).toEqual({ ok: true });
    expect(db.rows("outboundMessage")).toHaveLength(1);
  });

  it("lets an OWNER through regardless of job function — the rule that stops this feature locking somebody out of their own company", async () => {
    context.role = "OWNER";
    context.jobFunction = "FIELD"; // holds no MANAGE_JOBS on its own
    sendEmail.mockResolvedValue({ ok: true, providerMessageId: "prov_1", from: "office@example.test" });

    const result = await sendOutboundEmail(composed());
    expect(result).toEqual({ ok: true });
  });
});

describe("sendOutboundEmail obeys the daily rate cap", () => {
  it("refuses once the cap is hit, naming what to do, and sends nothing", async () => {
    outboundEmailAllowance.mockResolvedValue({
      ok: false,
      error: "Your company has sent 100 emails in the last day, which is today's limit — it frees up as the day rolls on.",
    });

    const result = await sendOutboundEmail(composed());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/today's limit/);
      expect(result.error).toMatch(/frees up/);
    }

    // The cap is checked before the provider is ever reached and before a
    // row is written — a refused send must leave no row, the same as a
    // rejected recipient or a missing subject.
    expect(sendEmail).not.toHaveBeenCalled();
    expect(db.rows("outboundMessage")).toHaveLength(0);
  });

  it("passes the sender's own company to the allowance check", async () => {
    sendEmail.mockResolvedValue({ ok: true, providerMessageId: "prov_1", from: "office@example.test" });
    await sendOutboundEmail(composed());
    expect(outboundEmailAllowance).toHaveBeenCalledWith("co_1");
  });

  it("still sends when the cap allows it", async () => {
    outboundEmailAllowance.mockResolvedValue({ ok: true });
    sendEmail.mockResolvedValue({ ok: true, providerMessageId: "prov_1", from: "office@example.test" });

    const result = await sendOutboundEmail(composed());
    expect(result).toEqual({ ok: true });
  });
});

/**
 * The other half of #352: help must stay reachable by everyone, and must
 * be unable to send anywhere but support — enforced here by the fact that
 * `sendHelpRequestEmail` takes no recipient argument at all, not by
 * anything help.ts promises to do with one.
 */
describe("sendHelpRequestEmail", () => {
  const originalSupportEmail = process.env.SUPPORT_EMAIL;

  afterEach(() => {
    if (originalSupportEmail === undefined) delete process.env.SUPPORT_EMAIL;
    else process.env.SUPPORT_EMAIL = originalSupportEmail;
  });

  function helpParams() {
    return {
      companyId: "co_1",
      jobId: null,
      subject: "Help — Acme Drywall",
      body: "How do I close out a job?",
      sentByUserId: "user_1",
    };
  }

  it("sends to the configured support address, not any address the caller could supply", async () => {
    process.env.SUPPORT_EMAIL = "support@cstream.ai";
    sendEmail.mockResolvedValue({ ok: true, providerMessageId: "prov_1", from: "office@example.test" });

    const result = await sendHelpRequestEmail(helpParams());
    expect(result).toEqual({ ok: true });

    const [row] = db.rows("outboundMessage");
    expect(row.toAddress).toBe("support@cstream.ai");
    expect(row.relatedType).toBe("HELP_REQUEST");
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "support@cstream.ai" }));
  });

  it("is not gated by MANAGE_JOBS — every member may ask for help", async () => {
    process.env.SUPPORT_EMAIL = "support@cstream.ai";
    context.role = "MEMBER";
    // ACCOUNTING holds no MANAGE_JOBS. This is the exact member #352's fix
    // must not lock out of the support channel while closing the outward
    // one.
    context.jobFunction = "ACCOUNTING";
    sendEmail.mockResolvedValue({ ok: true, providerMessageId: "prov_1", from: "office@example.test" });

    const result = await sendHelpRequestEmail(helpParams());
    expect(result).toEqual({ ok: true });
  });

  it("is not subject to the outward rate cap", async () => {
    outboundEmailAllowance.mockResolvedValue({ ok: false, error: "at the cap" });
    process.env.SUPPORT_EMAIL = "support@cstream.ai";
    sendEmail.mockResolvedValue({ ok: true, providerMessageId: "prov_1", from: "office@example.test" });

    const result = await sendHelpRequestEmail(helpParams());
    expect(result).toEqual({ ok: true });
    expect(outboundEmailAllowance).not.toHaveBeenCalled();
  });

  it("refuses, without throwing, when no support address is configured", async () => {
    delete process.env.SUPPORT_EMAIL;

    const result = await sendHelpRequestEmail(helpParams());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/support address/);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(db.rows("outboundMessage")).toHaveLength(0);
  });
});
