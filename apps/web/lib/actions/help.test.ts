import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `requestHelp`'s own wiring — the half of #352 that must NOT gain a
 * capability check. Every member gets to ask for help; what makes that
 * safe is that this file hands the send to `sendHelpRequestEmail`
 * (messages.ts), which has no recipient parameter at all, so nothing
 * `requestHelp` builds here can redirect where the mail goes. That
 * property is tested directly in messages.test.ts against the real
 * function; this file is about `requestHelp` assembling the right
 * message and staying scoped to the caller's own company and job.
 */

const context = {
  company: { id: "co_1", name: "Acme Drywall" },
  id: "user_1",
  name: "Jamie Foreman",
  email: "jamie@acmedrywall.example",
  role: "MEMBER" as string,
  jobFunction: "ACCOUNTING" as string | null,
};

// Left untyped, like the initial-implementation-free mocks in
// messages.test.ts: a typed initial implementation fixes the mock's
// inferred type to that one shape, and a later `mockReturnValue`/
// `mockResolvedValue` of a DIFFERENT shape (the "unavailable" channel, a
// failed send) then fails to typecheck. Defaults are set in beforeEach
// instead.
const sendHelpRequestEmail = vi.fn();
const helpChannelFromEnv = vi.fn();

const job = { id: "job_1", name: "Riverside Remodel" };
const findFirst = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireCompanyContext: async () => context,
}));

vi.mock("@prova/db", () => ({
  prisma: { job: { findFirst: (...args: unknown[]) => findFirst(...args) } },
}));

vi.mock("@/lib/help-config", () => ({
  helpChannelFromEnv: () => helpChannelFromEnv(),
}));

vi.mock("./messages", () => ({
  sendHelpRequestEmail: (...args: unknown[]) => sendHelpRequestEmail(...args),
}));

const { requestHelp } = await import("./help");

function formOf(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  context.role = "MEMBER";
  context.jobFunction = "ACCOUNTING";
  sendHelpRequestEmail.mockResolvedValue({ ok: true });
  helpChannelFromEnv.mockReturnValue({ kind: "send", to: "support@cstream.ai" });
  findFirst.mockResolvedValue(job);
});

describe("requestHelp has no capability gate", () => {
  it("sends for a member holding no MANAGE_JOBS-adjacent capability — ACCOUNTING", async () => {
    // ACCOUNTING holds no MANAGE_JOBS (lib/permissions.ts). This is the
    // exact member #352's fix on the outward path must not lock out of
    // the support channel.
    const result = await requestHelp(formOf({ message: "How do I close out a job?" }));
    expect(result).toEqual({ ok: true });
    expect(sendHelpRequestEmail).toHaveBeenCalledTimes(1);
  });

  it("sends for a member with no job function set at all", async () => {
    context.jobFunction = null;
    const result = await requestHelp(formOf({ message: "Where do I add a vendor?" }));
    expect(result).toEqual({ ok: true });
  });
});

describe("requestHelp calls sendHelpRequestEmail with no way to redirect it", () => {
  it("passes companyId, sentByUserId, and the built subject/body — and nothing shaped like a recipient", async () => {
    await requestHelp(formOf({ message: "How do I add a punch list item?", pagePath: "/jobs/job_1/punch-lists" }));

    expect(sendHelpRequestEmail).toHaveBeenCalledTimes(1);
    const [params] = sendHelpRequestEmail.mock.calls[0] as [Record<string, unknown>];
    expect(params.companyId).toBe("co_1");
    expect(params.sentByUserId).toBe("user_1");
    expect(params.jobId).toBe("job_1");
    expect(String(params.subject)).toContain("Acme Drywall");
    expect(String(params.body)).toContain("How do I add a punch list item?");

    // The whole point of the split: there is no key here a caller could
    // have used to name a recipient, because sendHelpRequestEmail's own
    // signature has none.
    expect(Object.keys(params).sort()).toEqual(["body", "companyId", "jobId", "sentByUserId", "subject"]);
  });

  it("looks up the named job scoped to the caller's own company", async () => {
    await requestHelp(formOf({ message: "Question", pagePath: "/jobs/job_1/rfis" }));
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: "job_1", companyId: "co_1" },
      select: { id: true, name: true },
    });
  });

  it("attaches no job when the page path names none", async () => {
    await requestHelp(formOf({ message: "General question" }));
    expect(findFirst).not.toHaveBeenCalled();
    const [params] = sendHelpRequestEmail.mock.calls[0] as [Record<string, unknown>];
    expect(params.jobId).toBeNull();
  });
});

describe("requestHelp's own refusals", () => {
  it("refuses before sending when the install has no way to send at all", async () => {
    helpChannelFromEnv.mockReturnValue({ kind: "unavailable", reason: "This install has no support address." });
    const result = await requestHelp(formOf({ message: "Help!" }));
    expect(result).toEqual({ ok: false, error: "This install has no support address." });
    expect(sendHelpRequestEmail).not.toHaveBeenCalled();
  });

  it("refuses an empty question before sending", async () => {
    const result = await requestHelp(formOf({ message: "   " }));
    expect(result.ok).toBe(false);
    expect(sendHelpRequestEmail).not.toHaveBeenCalled();
  });

  it("wraps a send failure with the direct-email fallback, naming the support address", async () => {
    sendHelpRequestEmail.mockResolvedValue({ ok: false, error: "Network unreachable" });
    const result = await requestHelp(formOf({ message: "Help!" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Network unreachable");
      expect(result.error).toContain("support@cstream.ai");
    }
  });
});
