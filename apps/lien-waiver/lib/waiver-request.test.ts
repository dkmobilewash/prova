import { describe, expect, it, vi } from "vitest";
import type { addContact, sendEmail as SendEmail, SendResult } from "./email";
import { sendEmail as realSendEmail } from "./email";
import { formatDate, formatMoney } from "./fills";
import { handleNotifyRequest } from "./notify-request";
import { LIMITS, MemoryRateStore } from "./rate-limit";
import { handleWaiverRequest, type WaiverDeps, type WaiverRequestBody } from "./waiver-request";

const FILLS = {
  project: "Mesa Medical",
  checkMaker: "Acme Builders Inc.",
  amount: "48250",
  payee: "Desert Drywall LLC",
  owner: "Mesa Medical Partners LP",
  jobLocation: "1234 E Main St",
  jobDescription: "Framing and drywall",
  customer: "Acme Builders Inc.",
  companyName: "Desert Drywall LLC",
};

const FIRST: WaiverRequestBody = {
  state: "TX",
  form: "CONDITIONAL_PROGRESS",
  fills: FILLS,
  email: "diego@cstream.ai",
  name: "Diego",
  company: "Desert Drywall",
};

function deps(overrides: Partial<WaiverDeps> = {}) {
  const sent: Array<{ to: string; subject: string; attachments?: unknown[] }> = [];
  const contacts: Array<{ email: string; marketingOptIn: boolean }> = [];
  const send = vi.fn(async (message: { to: string; subject: string; attachments?: unknown[] }) => {
    sent.push(message);
    return { status: "sent", id: "x" } as SendResult;
  }) as unknown as typeof SendEmail;
  const subscribe = vi.fn(async (contact: { email: string; marketingOptIn: boolean }) => {
    contacts.push(contact);
    return { status: "sent", id: "c" } as SendResult;
  }) as unknown as typeof addContact;
  const base: WaiverDeps = {
    env: {},
    rate: { store: new MemoryRateStore(), salt: "s" },
    ip: "1.2.3.4",
    published: () => true,
    reviewed: () => false,
    send,
    subscribe,
    ...overrides,
  };
  return { deps: base, sent, contacts };
}

describe("the email-only gate", () => {
  it("every request needs an email and a name", async () => {
    const { deps: d } = deps();
    expect(await handleWaiverRequest({ ...FIRST, email: "" }, d)).toMatchObject({ kind: "error", status: 400 });
    expect(await handleWaiverRequest({ ...FIRST, email: "not-an-email" }, d)).toMatchObject({ kind: "error", status: 400 });
    expect(await handleWaiverRequest({ ...FIRST, name: " " }, d)).toMatchObject({ kind: "error", status: 400 });
  });

  it("emails the PDF, tells Diego, and adds the contact unsubscribed", async () => {
    const { deps: d, sent, contacts } = deps();
    const result = await handleWaiverRequest(FIRST, d);
    expect(result).toEqual({ kind: "sent", to: "diego@cstream.ai", notConfigured: false });
    expect(sent.map((m) => m.to)).toEqual(["diego@cstream.ai", "diego@cstream.ai"]);
    expect(sent[0].attachments).toHaveLength(1);
    expect(sent[1].subject).toMatch(/^Lien waiver lead/);
    // The marketing box is unticked by default, and that is what is recorded.
    expect(contacts).toEqual([expect.objectContaining({ email: "diego@cstream.ai", marketingOptIn: false })]);
  });

  it("the lead email carries who asked, never what they typed into the waiver", async () => {
    const { deps: d, sent } = deps();
    await handleWaiverRequest(FIRST, d);
    const lead = JSON.stringify(sent[1]);
    for (const secret of ["48,250", "Mesa Medical Partners", "1234 E Main"]) expect(lead).not.toContain(secret);
  });

  it("NEVER returns the PDF itself -- the inbox is the only way out", async () => {
    const { deps: d } = deps();
    const result = await handleWaiverRequest(FIRST, d);
    expect(Object.values(result).some((value) => value instanceof Uint8Array)).toBe(false);
    expect(JSON.stringify(result)).not.toContain("%PDF");
  });

  it("a returning browser still needs an email -- there is no download to skip to", async () => {
    const { deps: d, sent } = deps();
    expect(await handleWaiverRequest({ ...FIRST, email: "", name: "", returning: true }, d)).toMatchObject({ kind: "error", status: 400 });
    expect(sent).toEqual([]);
  });

  it("a returning browser gets its PDF emailed, and that is not a second lead", async () => {
    const { deps: d, sent, contacts } = deps();
    expect(await handleWaiverRequest({ ...FIRST, returning: true }, d)).toMatchObject({ kind: "sent" });
    expect(sent).toHaveLength(1);
    expect(sent[0].attachments).toHaveLength(1);
    expect(contacts).toEqual([]);
  });

  it("refuses the honeypot without saying why", async () => {
    const { deps: d, sent } = deps();
    expect(await handleWaiverRequest({ ...FIRST, website: "http://spam" }, d)).toMatchObject({ status: 400, error: "That request could not be read." });
    expect(sent).toEqual([]);
  });

  it("refuses a state that is not published", async () => {
    const { deps: d } = deps({ published: () => false });
    expect(await handleWaiverRequest(FIRST, d)).toMatchObject({ status: 404 });
  });

  it("names every missing required field", async () => {
    const { deps: d } = deps();
    const result = await handleWaiverRequest({ ...FIRST, fills: { ...FILLS, owner: "", amount: "lots" } }, d);
    expect(result.kind === "error" && Object.keys(result.fieldErrors ?? {}).sort()).toEqual(["amount", "owner"]);
  });

  it("fails closed when production has no rate-limit store", async () => {
    const { deps: d, sent } = deps({ rate: null });
    expect(await handleWaiverRequest(FIRST, d)).toMatchObject({ status: 503 });
    expect(sent).toEqual([]);
  });

  it("fails closed when production cannot send email", async () => {
    const { deps: d } = deps({
      env: { VERCEL_ENV: "production" },
      send: (async () => ({ status: "not-configured" })) as unknown as typeof SendEmail,
    });
    expect(await handleWaiverRequest(FIRST, d)).toMatchObject({ status: 503 });
  });

  it("asks the person to try again when the email provider is down, and sends no lead", async () => {
    const { deps: d, sent, contacts } = deps({
      send: (async (m: { to: string }) => {
        sent.push(m as never);
        return { status: "failed", error: "500" };
      }) as unknown as typeof SendEmail,
    });
    expect(await handleWaiverRequest(FIRST, d)).toMatchObject({ kind: "error", status: 503, error: expect.stringMatching(/try again/) });
    // Only the person's email was attempted; no lead note about a PDF they never got.
    expect(sent).toHaveLength(1);
    expect(contacts).toEqual([]);
  });

  it("lets a preview with no Resend key be clicked through, and says nothing was sent", async () => {
    const { deps: d } = deps({
      send: (async () => ({ status: "not-configured" })) as unknown as typeof SendEmail,
      subscribe: (async () => ({ status: "not-configured" })) as unknown as typeof addContact,
    });
    expect(await handleWaiverRequest(FIRST, d)).toEqual({ kind: "sent", to: "diego@cstream.ai", notConfigured: true });
  });

  it("succeeds and logs it when only the lead note fails", async () => {
    const lines: string[] = [];
    const { deps: d } = deps({
      env: { VERCEL_ENV: "production" },
      // The person's copy goes out; the note to Diego does not.
      send: (async (m: { to: string }) =>
        m.to === "lead@example.com" ? { status: "sent", id: "x" } : { status: "failed", error: "500 boom" }) as unknown as typeof SendEmail,
      log: (line) => lines.push(line),
    });
    const result = await handleWaiverRequest({ ...FIRST, email: "lead@example.com" }, d);
    expect(result).toMatchObject({ kind: "sent" });
    expect(lines).toEqual(["[lien-waiver] the lead note did not go out: failed (500 boom)"]);
    expect(lines.join("\n")).not.toContain("lead@example.com");
  });

  it("turns a send that throws into a logged failure, not an unhandled error", async () => {
    const lines: string[] = [];
    const { deps: d } = deps({
      send: (async () => {
        throw new Error("getaddrinfo ENOTFOUND api.resend.com");
      }) as unknown as typeof SendEmail,
      log: (line) => lines.push(line),
    });
    expect(await handleWaiverRequest(FIRST, d)).toMatchObject({ kind: "error", status: 503 });
    expect(lines[0]).toMatch(/waiver email to the person did not go out: failed \(getaddrinfo ENOTFOUND/);
  });

  it("tells the person when their address is rejected", async () => {
    const { deps: d } = deps({ send: (async () => ({ status: "rejected", error: "x" })) as unknown as typeof SendEmail });
    expect(await handleWaiverRequest(FIRST, d)).toMatchObject({ status: 400, error: expect.stringMatching(/rejected/) });
  });
});

describe("rate limits", () => {
  it("caps PDFs per IP per hour", async () => {
    const { deps: d } = deps();
    // A different email each time, so only the per-IP cap can be what stops it.
    const body = (i: number) => ({ ...FIRST, returning: true, email: `sub${i}@example.com` });
    for (let i = 0; i < LIMITS.pdfPerIpPerHour; i += 1) expect((await handleWaiverRequest(body(i), d)).kind).toBe("sent");
    expect(await handleWaiverRequest(body(99), d)).toMatchObject({ status: 429 });
    // A different connection is not affected.
    expect((await handleWaiverRequest(body(100), { ...d, ip: "5.6.7.8" })).kind).toBe("sent");
  });

  it("caps emails to one address per day, across IPs", async () => {
    const { deps: d } = deps();
    for (let i = 0; i < LIMITS.emailsPerAddressPerDay; i += 1) {
      expect((await handleWaiverRequest(FIRST, { ...d, ip: `10.0.0.${i}` })).kind).toBe("sent");
    }
    expect(await handleWaiverRequest(FIRST, { ...d, ip: "10.0.1.1" })).toMatchObject({ status: 429 });
  });

  it("forgets attempts once the window has passed", async () => {
    let now = 0;
    const store = new MemoryRateStore(() => now);
    for (let i = 0; i < 3; i += 1) await store.hit("k", 1000);
    expect(await store.hit("k", 1000)).toBe(4);
    now = 5000;
    expect(await store.hit("k", 1000)).toBe(1);
  });
});

describe("previews email anyone (no allowlist since 2026-10-12)", () => {
  it("sends to any address outside production, the same as production", async () => {
    const calls: string[] = [];
    const fetcher = (async (_url: string, init: { body: string }) => {
      calls.push((JSON.parse(init.body) as { to: string[] }).to[0]);
      return new Response(JSON.stringify({ id: "e1" }), { status: 200 });
    }) as unknown as typeof fetch;
    const env = { RESEND_API_KEY: "re_test", LIEN_TOOL_EMAIL_FROM: "W <w@mail.cstream.ai>", VERCEL_ENV: "preview" };
    expect(await realSendEmail({ to: "sub@example.com", subject: "s", text: "t" }, env, fetcher)).toEqual({ status: "sent", id: "e1" });
    expect(calls).toEqual(["sub@example.com"]);
  });
});

describe("formatting what was typed", () => {
  it("formats money and refuses what it cannot read", () => {
    expect(formatMoney("48250")).toBe("48,250.00");
    expect(formatMoney("$1,234.5")).toBe("1,234.50");
    expect(formatMoney("0")).toBe("0.00");
    expect(formatMoney("12k")).toBeNull();
    expect(formatMoney("-5")).toBeNull();
  });

  it("formats a picked date without consulting a clock", () => {
    expect(formatDate("2026-09-30")).toBe("09/30/2026");
    expect(formatDate("2026-13-01")).toBeNull();
    expect(formatDate("Sept 30")).toBeNull();
  });
});

describe("notify me (New Mexico)", () => {
  it("records the lead and emails nobody else", async () => {
    const sent: string[] = [];
    const result = await handleNotifyRequest(
      { email: "sub@example.com", name: "Pat", state: "NM" },
      {
        env: {},
        rate: { store: new MemoryRateStore(), salt: "s" },
        ip: "1.1.1.1",
        send: (async (m: { to: string }) => {
          sent.push(m.to);
          return { status: "sent", id: "x" };
        }) as unknown as typeof SendEmail,
        subscribe: (async () => ({ status: "sent", id: "c" })) as unknown as typeof addContact,
      },
    );
    expect(result.status).toBe(200);
    expect(sent).toEqual(["diego@cstream.ai"]);
  });

  const notify = (overrides: { env?: Record<string, string>; send?: unknown; subscribe?: unknown; log?: (line: string) => void }) =>
    handleNotifyRequest(
      { email: "sub@example.com", name: "Pat", state: "NM" },
      {
        env: overrides.env ?? {},
        rate: { store: new MemoryRateStore(), salt: "s" },
        ip: "1.1.1.1",
        send: (overrides.send ?? (async () => ({ status: "sent", id: "x" }))) as typeof SendEmail,
        subscribe: (overrides.subscribe ?? (async () => ({ status: "sent", id: "c" }))) as typeof addContact,
        log: overrides.log,
      },
    );

  it("does not say 'you're on the list' when nothing recorded the address", async () => {
    const lines: string[] = [];
    const result = await notify({
      env: { VERCEL_ENV: "production" },
      send: async () => ({ status: "not-configured" }),
      subscribe: async () => ({ status: "not-configured" }),
      log: (line) => lines.push(line),
    });
    expect(result).toMatchObject({ status: 503, error: expect.stringMatching(/try again/) });
    expect(lines).toContain("[lien-waiver] a notify-me sign-up was refused: no send recorded the lead");
    expect(lines.join("\n")).not.toContain("sub@example.com");
  });

  it("succeeds when one of the two landed, and logs the other", async () => {
    const lines: string[] = [];
    const result = await notify({
      env: { VERCEL_ENV: "production" },
      subscribe: async () => {
        throw new Error("socket hang up");
      },
      log: (line) => lines.push(line),
    });
    expect(result.status).toBe(200);
    expect(lines).toEqual(["[lien-waiver] the notify-me audience sign-up did not go out: failed (socket hang up)"]);
  });

  it("lets a preview with no Resend key be clicked through", async () => {
    const lines: string[] = [];
    const result = await notify({
      env: {},
      send: async () => ({ status: "not-configured" }),
      subscribe: async () => ({ status: "not-configured" }),
      log: (line) => lines.push(line),
    });
    expect(result.status).toBe(200);
    expect(lines).toEqual([]);
  });
});
