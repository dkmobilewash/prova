import { describe, expect, it, vi } from "vitest";
import type { addContact, sendEmail, SendResult } from "./email";
import { allowed } from "./email";
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
  }) as unknown as typeof sendEmail;
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

describe("the download gate", () => {
  it("a first download needs an email and a name", async () => {
    const { deps: d } = deps();
    expect(await handleWaiverRequest({ ...FIRST, email: "" }, d)).toMatchObject({ kind: "error", status: 400 });
    expect(await handleWaiverRequest({ ...FIRST, email: "not-an-email" }, d)).toMatchObject({ kind: "error", status: 400 });
    expect(await handleWaiverRequest({ ...FIRST, name: " " }, d)).toMatchObject({ kind: "error", status: 400 });
  });

  it("a first download emails the PDF, tells Diego, and adds the contact unsubscribed", async () => {
    const { deps: d, sent, contacts } = deps();
    const result = await handleWaiverRequest(FIRST, d);
    expect(result).toMatchObject({ kind: "pdf", emailStatus: "sent" });
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

  it("a returning browser downloads with no email and sends nothing", async () => {
    const { deps: d, sent } = deps();
    const result = await handleWaiverRequest({ ...FIRST, email: "", name: "", returning: true }, d);
    expect(result).toMatchObject({ kind: "pdf", emailStatus: "not-requested" });
    expect(sent).toEqual([]);
  });

  it("a returning browser can still ask for a copy, and that is not a second lead", async () => {
    const { deps: d, sent, contacts } = deps();
    await handleWaiverRequest({ ...FIRST, returning: true, emailCopy: true }, d);
    expect(sent).toHaveLength(1);
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
      send: (async () => ({ status: "not-configured" })) as unknown as typeof sendEmail,
    });
    expect(await handleWaiverRequest(FIRST, d)).toMatchObject({ status: 503 });
  });

  it("still hands over the PDF when the email provider is down", async () => {
    const { deps: d } = deps({ send: (async () => ({ status: "failed", error: "500" })) as unknown as typeof sendEmail });
    expect(await handleWaiverRequest(FIRST, d)).toMatchObject({ kind: "pdf", emailStatus: "failed" });
  });

  it("tells the person when their address is rejected", async () => {
    const { deps: d } = deps({ send: (async () => ({ status: "rejected", error: "x" })) as unknown as typeof sendEmail });
    expect(await handleWaiverRequest(FIRST, d)).toMatchObject({ status: 400, error: expect.stringMatching(/rejected/) });
  });
});

describe("rate limits", () => {
  it("caps PDFs per IP per hour", async () => {
    const { deps: d } = deps();
    const body = { ...FIRST, returning: true, email: "", name: "" };
    for (let i = 0; i < LIMITS.pdfPerIpPerHour; i += 1) expect((await handleWaiverRequest(body, d)).kind).toBe("pdf");
    expect(await handleWaiverRequest(body, d)).toMatchObject({ status: 429 });
    // A different address is not affected.
    expect((await handleWaiverRequest(body, { ...d, ip: "5.6.7.8" })).kind).toBe("pdf");
  });

  it("caps emails to one address per day, across IPs", async () => {
    const { deps: d } = deps();
    for (let i = 0; i < LIMITS.emailsPerAddressPerDay; i += 1) {
      expect((await handleWaiverRequest(FIRST, { ...d, ip: `10.0.0.${i}` })).kind).toBe("pdf");
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

describe("preview email allowlist", () => {
  it("emails only the allowlist outside production", () => {
    expect(allowed("diego@cstream.ai", {})).toBe(true);
    expect(allowed("Diego@CStream.ai ", {})).toBe(true);
    expect(allowed("sub@example.com", {})).toBe(false);
    expect(allowed("sub@example.com", { VERCEL_ENV: "preview" })).toBe(false);
    expect(allowed("sub@example.com", { EMAIL_ALLOWLIST: "a@b.co, sub@example.com" })).toBe(true);
    expect(allowed("sub@example.com", { VERCEL_ENV: "production" })).toBe(true);
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
        }) as unknown as typeof sendEmail,
        subscribe: (async () => ({ status: "sent", id: "c" })) as unknown as typeof addContact,
      },
    );
    expect(result.status).toBe(200);
    expect(sent).toEqual(["diego@cstream.ai"]);
  });
});
