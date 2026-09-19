import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/fake-prisma";

/**
 * The two guards on sending, and why they needed their own file.
 *
 * `sendOutboundEmail` had neither a capability check nor any ceiling, so
 * any signed-in member of any company could send unlimited arbitrary email
 * from our shared sending domain. `/pilot` made that a live abuse surface
 * rather than a theoretical one.
 *
 * NO EXISTING CENSUS COVERS THIS, which is the reason these tests exist
 * rather than a line in one. `action-capability-guards.test.ts` only
 * requires a guard on actions reachable from a GUARDED page, and
 * `/messages` has no entry in `ROUTE_CAPABILITY` — so that suite is
 * silent about this action and stayed green throughout the hole. Remove
 * either guard and nothing else in the repo goes red.
 *
 * The ceiling itself is tested in lib/outbound-email.test.ts, against the
 * queries it actually issues. Here it is mocked on purpose: these cases
 * are about whether the action ASKS, and whether a refusal stops the
 * write — not about how the counting works.
 */

let db = new FakeDb().defaults("outboundMessage", { providerMessageId: null });

/** Mutable so each case can be a different person. `can()` is the real
 * one: a fake permission answer would prove only that the fake agrees
 * with itself. */
let context = {
  company: { id: "co_1" },
  id: "user_1",
  name: "Dee",
  email: "dee@sub.example",
  role: "OWNER" as string,
  jobFunction: null as string | null,
};

const sendEmail = vi.fn();
const emailAllowance = vi.fn();

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@prova/db", () => ({
  get prisma() {
    return db.client();
  },
}));
vi.mock("@prova/integrations", () => ({
  looksLikeEmail: (value: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value),
  readEmailConfig: () => ({ provider: "resend", apiKey: "t", from: "office@sub.example", webhookSecret: null }),
  sendEmail: (...args: unknown[]) => sendEmail(...args),
}));
vi.mock("@/lib/outbound-email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/outbound-email")>()),
  emailAllowance: (...args: unknown[]) => emailAllowance(...args),
}));
vi.mock("@/lib/help-config", () => ({
  helpChannelFromEnv: () => ({ kind: "send", to: "support@cstream.ai" }),
}));

const { sendOutboundEmail, sendSupportEmail } = await import("./messages");

function composed(toAddress = "pm@gc.example") {
  const fd = new FormData();
  fd.set("toAddress", toAddress);
  fd.set("subject", "Backcharge dispute");
  fd.set("body", "The deduction on pay app 4 is not ours.");
  return fd;
}

/** The only thing that matters about a refusal: nothing left the building
 * and nothing was written down as though it had. */
function nothingHappened() {
  expect(sendEmail).not.toHaveBeenCalled();
  expect(db.rows("outboundMessage")).toHaveLength(0);
  expect(db.rows("outboundMessageEvent")).toHaveLength(0);
}

beforeEach(() => {
  vi.clearAllMocks();
  db = new FakeDb().defaults("outboundMessage", { providerMessageId: null });
  context = { ...context, role: "OWNER", jobFunction: null };
  emailAllowance.mockResolvedValue({ ok: true });
  sendEmail.mockResolvedValue({ ok: true, providerMessageId: "prov_1", from: "office@sub.example" });
});

describe("sendOutboundEmail is gated on MANAGE_JOBS", () => {
  it("refuses a member whose job function does not include it, before writing anything", async () => {
    // ACCOUNTING is one of exactly two job functions without MANAGE_JOBS.
    context = { ...context, role: "MEMBER", jobFunction: "ACCOUNTING" };

    const result = await sendOutboundEmail(composed());

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("job function");
    nothingHappened();
    // Refused before the ceiling was even consulted: a person who may not
    // send at all should not be spending anybody's allowance to find out.
    expect(emailAllowance).not.toHaveBeenCalled();
  });

  it("refuses PAYROLL_COMPLIANCE too", async () => {
    context = { ...context, role: "MEMBER", jobFunction: "PAYROLL_COMPLIANCE" };
    expect((await sendOutboundEmail(composed())).ok).toBe(false);
    nothingHappened();
  });

  it("lets an owner through", async () => {
    expect((await sendOutboundEmail(composed())).ok).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("takes nothing from a member with no job function set", async () => {
    // The whole point of `capabilitiesFor` rule 2: shipping this must not
    // quietly remove sending from every existing MEMBER.
    context = { ...context, role: "MEMBER", jobFunction: null };
    expect((await sendOutboundEmail(composed())).ok).toBe(true);
  });

  it("lets a foreman through", async () => {
    context = { ...context, role: "MEMBER", jobFunction: "FIELD" };
    expect((await sendOutboundEmail(composed())).ok).toBe(true);
  });
});

describe("sendOutboundEmail answers to the ceiling", () => {
  it("asks about this company and this person", async () => {
    await sendOutboundEmail(composed());
    expect(emailAllowance).toHaveBeenCalledWith("co_1", "user_1");
  });

  it("returns the refusal and writes nothing when the ceiling says no", async () => {
    emailAllowance.mockResolvedValue({ ok: false, error: "You've sent 20 emails in the last hour" });

    const result = await sendOutboundEmail(composed());

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("20 emails");
    // The ceiling has to refuse BEFORE the row is written, or every
    // refusal still counts against the next one and the limit ratchets
    // itself shut.
    nothingHappened();
  });
});

describe("sendSupportEmail stays open to everyone, and can only reach us", () => {
  it("works for a job function that may not use the composer", async () => {
    context = { ...context, role: "MEMBER", jobFunction: "ACCOUNTING" };

    const fd = new FormData();
    fd.set("subject", "Help");
    fd.set("body", "I can't find the pay app.");

    expect((await sendSupportEmail(fd)).ok).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("is not bounded by the sending ceiling", async () => {
    // Someone who has run out of ordinary sends must still be able to
    // tell us that. If this ever consults the allowance, the support
    // channel closes exactly when it is most needed.
    emailAllowance.mockResolvedValue({ ok: false, error: "limit" });

    const fd = new FormData();
    fd.set("subject", "Help");
    fd.set("body", "Everything is refusing to send.");

    expect((await sendSupportEmail(fd)).ok).toBe(true);
    expect(emailAllowance).not.toHaveBeenCalled();
  });

  it("ignores a posted toAddress and sends to the configured support address", async () => {
    // THE SECURITY PROPERTY. This is an exported Server Action, so it
    // answers whoever posts to it — including someone posting their own
    // recipient to borrow the exemption above. If this ever honours the
    // posted address, the gate and the ceiling are both bypassable by
    // calling the other endpoint.
    const fd = composed("victim@example.test");
    fd.set("body", "spam");

    expect((await sendSupportEmail(fd)).ok).toBe(true);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "support@cstream.ai" }));
    expect(db.rows("outboundMessage")[0].toAddress).toBe("support@cstream.ai");
  });

  it("marks the row as a help request, which is what exempts it from the counts", async () => {
    const fd = new FormData();
    fd.set("subject", "Help");
    fd.set("body", "A question.");

    await sendSupportEmail(fd);
    expect(db.rows("outboundMessage")[0].relatedType).toBe("HELP_REQUEST");
  });
});
