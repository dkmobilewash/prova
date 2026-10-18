import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it, vi } from "vitest";
import { checkChangeOrder, EMPTY_DRAFT, freshDraft } from "./change-order";
import { sendEmail, type addContact, type sendEmail as SendEmail, type SendResult } from "./email";
import { LIMITS, MemoryRateStore } from "./rate-limit";
import { renderTicketPdf, TM_FOOTER } from "./tm-ticket-pdf";
import { handleTicketRequest, type TicketDeps, type TicketRequestBody } from "./tm-ticket-request";
import {
  addTicketsToChangeOrder,
  checkSignature,
  checkTicket,
  EMPTY_TICKET,
  freshTicket,
  issueTicketNumber,
  parseHours,
  parseQuantity,
  restoreTicket,
  TICKET_PATTERN,
  TM_STEPS,
  tmStepErrors,
  toHandoff,
  type TicketDraft,
} from "./tm-ticket";

/** A stroke with some ink in it, inside the 600 x 200 box. */
const SIGNED = "M10 150 L60 40 L110 150 L160 40 M200 100 L320 100";

/** A ticket a drywall foreman would actually write. */
const TICKET: TicketDraft = {
  ...EMPTY_TICKET,
  number: "TM-1NQ8K3P-7QX",
  companyName: "Desert Drywall LLC",
  project: "Mesa Medical Office Building",
  gc: "Acme Builders Inc.",
  date: "2026-10-18",
  summary: "Patch and re-tape corridor walls after plumbing reroute",
  details: "Level 2 corridor, grid C-D. Super asked at 10am.",
  crew: [
    { name: "Luis Ortega", hours: "8" },
    { name: "Sam Reyes", hours: "7.5" },
  ],
  material: [{ description: "Joint compound", quantity: "3", unit: "bucket" }],
  equipment: [{ description: "Scissor lift", quantity: "4", unit: "" }],
  superName: "Dana Whitfield",
  superTitle: "Superintendent",
  superEmail: "dana@acme.example",
  signature: SIGNED,
};

describe("hours and quantities", () => {
  it.each([
    ["8", 800n],
    ["7.5", 750n],
    [".25", 25n],
    ["0.5", 50n],
    [" 12 ", 1200n],
    ["1,200", 120000n],
  ])("reads %j", (raw, hundredths) => expect(parseQuantity(raw)).toBe(hundredths));

  it.each(["", ".", "$8", "-1", "8.125", "eight", "1e3", "8 hrs"])("refuses %j rather than guessing", (raw) => {
    expect(parseQuantity(raw)).toBeNull();
  });

  it("holds a person's hours between a quarter hour and 24", () => {
    expect(parseHours("24")).toBe(2400n);
    expect(parseHours("0.25")).toBe(25n);
    expect(parseHours("0")).toBeNull();
    expect(parseHours("24.25")).toBeNull();
    expect(parseHours("$8")).toBeNull();
  });
});

describe("the ticket number", () => {
  const NOW = Date.UTC(2026, 9, 18, 21, 30, 0);

  it("has the documented shape, in an alphabet with no I, L, O or U", () => {
    const { number } = issueTicketNumber(0, NOW, () => 0.5);
    expect(number).toMatch(TICKET_PATTERN);
    expect(number).not.toMatch(/[ILOU]/);
  });

  it("encodes the issuing second, so it can be read back", () => {
    const { number, second } = issueTicketNumber(0, NOW, () => 0);
    expect(second).toBe(NOW / 1000);
    const time = number.split("-")[1];
    const decoded = [...time].reduce((n, c) => n * 32 + "0123456789ABCDEFGHJKMNPQRSTVWXYZ".indexOf(c), 0);
    expect(decoded).toBe(second);
  });

  it("never repeats in one browser: same second, a clock gone backwards, a thousand in a row", () => {
    const seen = new Set<string>();
    let last = 0;
    // Every issue at the SAME instant, and half of them with the clock an hour behind.
    for (let i = 0; i < 1000; i += 1) {
      const { number, second } = issueTicketNumber(last, i % 2 ? NOW - 3_600_000 : NOW, () => 0);
      expect(second).toBeGreaterThan(last);
      expect(seen.has(number)).toBe(false);
      seen.add(number);
      last = second;
    }
    expect(seen.size).toBe(1000);
  });

  it("is told apart across browsers only by the random part -- the stated limit", () => {
    // Two phones, same second, no shared memory: equal draws collide, and the code says so.
    expect(issueTicketNumber(0, NOW, () => 0.1).number).toBe(issueTicketNumber(0, NOW, () => 0.1).number);
    expect(issueTicketNumber(0, NOW, () => 0.1).number).not.toBe(issueTicketNumber(0, NOW, () => 0.9).number);
  });

  it("the API refuses anything else as a number", () => {
    for (const bad of ["", "TM-1", "tm-1nq8k3p-7qx", "TM-1NQ8K3P-7QI", "INV-1NQ8K3P-7QX", "TM-1NQ8K3P-7QX "]) {
      expect(checkTicket({ ...TICKET, number: bad }).errors.number).toBeDefined();
    }
  });
});

describe("the signature", () => {
  it("accepts a drawn path inside the box", () => expect(checkSignature(SIGNED)).toBe(SIGNED));

  it.each([
    ["empty", ""],
    ["a tap", "M10 10"],
    ["too little ink", "M10 10 L20 20 L30 30"],
    ["outside the box", "M10 10 L700 20 L30 30 L40 40"],
    ["a curve command", "M10 10 C20 20 30 30 40 40 L1 1 L2 2 L3 3"],
    ["script", "M10 10 L20 20 L30 30 L40 40<script>"],
    ["a number", 42],
  ])("refuses %s", (_label, raw) => expect(checkSignature(raw)).toBeNull());

  it("refuses a path too long to be a signature", () => {
    expect(checkSignature(`M1 1${" L2 2 L3 3".repeat(3000)}`)).toBeNull();
  });
});

describe("checking a ticket", () => {
  it("reads a real ticket: hours added, units defaulted, dates as printed", () => {
    const { ticket, errors } = checkTicket(TICKET);
    expect(errors).toEqual({});
    expect(ticket).toMatchObject({
      date: "10/18/2026",
      crew: [
        { name: "Luis Ortega", hours: "8" },
        { name: "Sam Reyes", hours: "7.5" },
      ],
      totalHours: "15.5",
      material: [{ description: "Joint compound", quantity: "3", unit: "bucket" }],
      equipment: [{ description: "Scissor lift", quantity: "4", unit: "hr" }],
    });
  });

  it("has nothing to price: no money field exists on a checked ticket", () => {
    const { ticket } = checkTicket(TICKET);
    expect(JSON.stringify(ticket)).not.toMatch(/price|rate|amount|cents|\$/i);
  });

  it("needs a crew, each person's hours, the super's name, title, email and signature", () => {
    const { ticket, errors } = checkTicket({ ...TICKET, crew: [], superName: "", superTitle: "", superEmail: "dana@", signature: "" });
    expect(ticket).toBeNull();
    expect(Object.keys(errors).sort()).toEqual(["crew", "signature", "superEmail", "superName", "superTitle"]);
    expect(checkTicket({ ...TICKET, crew: [{ name: "Luis", hours: "" }] }).errors).toEqual({ "crew.0.hours": expect.any(String) });
  });

  it("drops a blank material line and refuses a half-filled one", () => {
    expect(checkTicket({ ...TICKET, material: [{ description: "", quantity: "", unit: "" }] }).ticket!.material).toEqual([]);
    expect(Object.keys(checkTicket({ ...TICKET, material: [{ description: "Studs", quantity: "", unit: "" }] }).errors)).toEqual(["material.0.quantity"]);
  });

  it("survives a hostile body without throwing", () => {
    const hostile = { crew: "x", material: [null, 5, { quantity: {} }], signature: { d: 1 }, superEmail: 7 } as unknown as TicketDraft;
    expect(() => checkTicket(hostile)).not.toThrow();
    expect(checkTicket(hostile).ticket).toBeNull();
  });

  it("restores only known, well-formed fields from browser memory", () => {
    const restored = restoreTicket({ summary: "S", crew: [{ name: "A", hours: 8 }], evil: "x", gc: 5 });
    expect(restored.summary).toBe("S");
    expect(restored.gc).toBe("");
    expect(restored.crew).toEqual([{ name: "A", hours: "" }]);
    expect("evil" in restored).toBe(false);
  });

  it("a new ticket keeps only the company, today and its new number", () => {
    expect(freshTicket("Desert Drywall LLC", "2026-10-19", "TM-1NQ8K3Q-AAA")).toEqual({
      ...EMPTY_TICKET,
      companyName: "Desert Drywall LLC",
      date: "2026-10-19",
      number: "TM-1NQ8K3Q-AAA",
    });
  });
});

describe("the step-by-step screens", () => {
  it("walks the screens in order, one question each, sign before send", () => {
    expect(TM_STEPS.map((step) => step.id)).toEqual(["company", "project", "date", "work", "crew", "hours", "material", "equipment", "review", "sign", "send"]);
  });

  const bad: Array<Partial<TicketDraft>> = [
    EMPTY_TICKET,
    { ...TICKET, crew: [{ name: "", hours: "x" }], summary: "x".repeat(200), details: "x".repeat(3000), date: "nope" },
    { ...TICKET, material: [{ description: "", quantity: "-1", unit: "x".repeat(20) }], equipment: Array.from({ length: 30 }, () => ({ description: "a", quantity: "1", unit: "" })) },
    { ...TICKET, superEmail: "", crew: Array.from({ length: 40 }, () => ({ name: "a", hours: "1" })), material: Array.from({ length: 30 }, () => ({ description: "a", quantity: "1", unit: "" })) },
  ];
  const keys = [...new Set(bad.flatMap((draft) => Object.keys(checkTicket(draft).errors)))];

  it("produces errors to check (the set is not empty)", () => expect(keys.length).toBeGreaterThanOrEqual(18));

  it.each(keys)("error %s belongs to exactly one screen", (key) => {
    const owners = TM_STEPS.filter((step) => tmStepErrors(step.id, { [key]: "x" }).length > 0).map((step) => step.id);
    expect(owners).toHaveLength(1);
  });

  it("a name is the crew screen's, that person's hours the hours screen's", () => {
    expect(tmStepErrors("crew", { "crew.3.name": "x", "crew.3.hours": "x" })).toEqual(["crew.3.name"]);
    expect(tmStepErrors("hours", { "crew.3.name": "x", "crew.3.hours": "x" })).toEqual(["crew.3.hours"]);
  });
});

describe("Turn these tickets into a change order", () => {
  const sent = toHandoff(checkTicket(TICKET).ticket!);

  it("carries no signature and no email address", () => {
    expect(JSON.stringify(sent)).not.toContain(SIGNED);
    expect(JSON.stringify(sent)).not.toContain("dana@acme.example");
  });

  it("adds hours and quantities as lines with NO price, and lists the ticket as backup", () => {
    const draft = addTicketsToChangeOrder(freshDraft("Desert Drywall LLC", "2026-10-18"), [sent]);
    expect(draft.labor).toEqual([
      { description: "Luis Ortega (T&M TM-1NQ8K3P-7QX, 10/18/2026)", quantity: "8", unit: "hr", unitPrice: "" },
      { description: "Sam Reyes (T&M TM-1NQ8K3P-7QX, 10/18/2026)", quantity: "7.5", unit: "hr", unitPrice: "" },
    ]);
    expect(draft.material).toEqual([{ description: "Joint compound (T&M TM-1NQ8K3P-7QX, 10/18/2026)", quantity: "3", unit: "bucket", unitPrice: "" }]);
    expect(draft.equipment).toEqual([{ description: "Scissor lift (T&M TM-1NQ8K3P-7QX, 10/18/2026)", quantity: "4", unit: "hr", unitPrice: "" }]);
    expect(draft.project).toBe("Mesa Medical Office Building");
    expect(draft.gc).toBe("Acme Builders Inc.");
    // Found by the browser walk: a browser that never made a change order had no company to start from.
    expect(addTicketsToChangeOrder(EMPTY_DRAFT, [sent]).companyName).toBe("Desert Drywall LLC");
    expect(draft.backup).toBe("T&M ticket TM-1NQ8K3P-7QX, 10/18/2026, signed by Dana Whitfield");
    // The change order refuses every handed-off line until the sub types a rate.
    expect(Object.keys(checkChangeOrder(draft).errors).filter((key) => key.endsWith("unitPrice"))).toHaveLength(4);
  });

  it("adds to a request in progress and replaces nothing typed there", () => {
    const typed = { ...EMPTY_DRAFT, project: "Mine", gc: "My GC", backup: "RFI 9", labor: [{ description: "Typed", quantity: "1", unit: "hr", unitPrice: "90" }] };
    const draft = addTicketsToChangeOrder(typed, [sent, sent]);
    expect(draft.project).toBe("Mine");
    expect(draft.gc).toBe("My GC");
    expect(draft.labor).toHaveLength(5);
    expect(draft.labor[0]).toEqual(typed.labor[0]);
    expect(draft.backup.split("\n")).toHaveLength(3);
  });

  it("ignores garbage from browser memory", () => {
    expect(addTicketsToChangeOrder(EMPTY_DRAFT, "x")).toBe(EMPTY_DRAFT);
    expect(addTicketsToChangeOrder(EMPTY_DRAFT, [null, 5, { crew: [] }])).toBe(EMPTY_DRAFT);
  });
});

const FIRST: TicketRequestBody = { ticket: TICKET, email: "luis@desert.example", name: "Luis Ortega", company: "Desert Drywall" };

type Message = { to: string; cc?: string; subject: string; text: string; attachments?: Array<{ filename: string; content: Uint8Array }> };

function deps(overrides: Partial<TicketDeps> = {}) {
  const sent: Message[] = [];
  const contacts: Array<{ email: string }> = [];
  const send = vi.fn(async (message: Message) => {
    sent.push(message);
    return { status: "sent", id: "x" } as SendResult;
  }) as unknown as typeof SendEmail;
  const subscribe = vi.fn(async (contact: { email: string }) => {
    contacts.push(contact);
    return { status: "sent", id: "c" } as SendResult;
  }) as unknown as typeof addContact;
  const base: TicketDeps = { env: {}, rate: { store: new MemoryRateStore(), salt: "s" }, ip: "1.2.3.4", send, subscribe, ...overrides };
  return { deps: base, sent, contacts };
}

const STANDARD_FONTS = join(dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json")), "standard_fonts") + "/";

async function readPdf(bytes: Uint8Array): Promise<{ text: string; strokes: number }> {
  const doc = await getDocument({ data: bytes, useSystemFonts: false, isEvalSupported: false, standardFontDataUrl: STANDARD_FONTS }).promise;
  const parts: string[] = [];
  let strokes = 0;
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    for (const item of (await page.getTextContent()).items) if ("str" in item) parts.push(item.str);
    strokes += (await page.getOperatorList()).fnArray.filter((op) => op === OPS.stroke).length;
  }
  return { text: parts.join(" ").replace(/\s+/g, " "), strokes };
}

describe("POST /api/tm-ticket", () => {
  it("emails ONE message to the foreman and the super at once, then tells Diego about the foreman only", async () => {
    const { deps: d, sent, contacts } = deps();
    expect(await handleTicketRequest(FIRST, d)).toEqual({ kind: "sent", to: "luis@desert.example", notConfigured: false });
    expect(sent.map((m) => [m.to, m.cc])).toEqual([
      ["luis@desert.example", "dana@acme.example"],
      ["diego@cstream.ai", undefined],
    ]);
    expect(sent[0].subject).toBe("T&M ticket TM-1NQ8K3P-7QX: Patch and re-tape corridor walls after plumbing reroute (Mesa Medical Office Building, 10/18/2026)");
    expect(sent[0].attachments?.[0].filename).toBe("tm-ticket-tm-1nq8k3p-7qx.pdf");
    expect(sent[0].text).toContain("Crew hours: 15.5.");
    // The footer is true for BOTH readers: neither "you asked" nor a marketing line.
    expect(sent[0].text).toContain("your address was entered on this document");
    expect(sent[0].text).not.toMatch(/you asked for this PDF/i);
    expect(contacts.map((c) => c.email)).toEqual(["luis@desert.example"]);
  });

  it("the lead says what kind of document, never the super, the GC, the job or the hours", async () => {
    const { deps: d, sent } = deps();
    await handleTicketRequest(FIRST, d);
    const lead = JSON.stringify(sent[1]);
    for (const secret of ["dana@acme.example", "Dana Whitfield", "Acme Builders", "Mesa Medical", "15.5", "Luis Ortega (", "TM-1NQ8K3P"]) {
      expect(lead).not.toContain(secret);
    }
    expect(sent[1].text).toContain("Tool: T&M ticket");
  });

  it("validates both addresses: the foreman's, and the super's inside the ticket", async () => {
    const { deps: d, sent } = deps();
    expect(await handleTicketRequest({ ...FIRST, email: "luis@" }, d)).toMatchObject({ kind: "error", status: 400, error: expect.stringMatching(/valid email/) });
    const noSuper = await handleTicketRequest({ ...FIRST, ticket: { ...TICKET, superEmail: "dana@acme" } }, d);
    expect(noSuper).toMatchObject({ kind: "error", status: 400, fieldErrors: { superEmail: expect.any(String) } });
    expect(sent).toEqual([]);
  });

  it("refuses an unsigned ticket, a missing number and the honeypot without sending", async () => {
    const { deps: d, sent } = deps();
    expect(await handleTicketRequest({ ...FIRST, ticket: { ...TICKET, signature: "" } }, d)).toMatchObject({ status: 400, fieldErrors: { signature: expect.any(String) } });
    expect(await handleTicketRequest({ ...FIRST, ticket: { ...TICKET, number: "" } }, d)).toMatchObject({ status: 400, fieldErrors: { number: expect.any(String) } });
    expect(await handleTicketRequest({ ...FIRST, website: "x" }, d)).toMatchObject({ status: 400 });
    expect(await handleTicketRequest({ ...FIRST, ticket: undefined }, d)).toMatchObject({ status: 400 });
    expect(sent).toEqual([]);
  });

  it("holds the SUPER'S address to the daily cap too: a cc is not a way round it", async () => {
    const { deps: d, sent } = deps();
    // Different foremen, the same super, all day.
    for (let i = 0; i < LIMITS.emailsPerAddressPerDay; i += 1) {
      expect(await handleTicketRequest({ ...FIRST, email: `foreman${i}@desert.example` }, d)).toMatchObject({ kind: "sent" });
    }
    const before = sent.length;
    expect(await handleTicketRequest({ ...FIRST, email: "another@desert.example" }, d)).toMatchObject({ kind: "error", status: 429 });
    expect(sent.length).toBe(before);
  });

  it("the same address twice is one recipient, counted once", async () => {
    const { deps: d, sent } = deps();
    await handleTicketRequest({ ...FIRST, ticket: { ...TICKET, superEmail: "LUIS@desert.example" } }, d);
    expect(sent[0].cc).toBeUndefined();
  });

  it("a rejected address names both as suspects", async () => {
    const send = vi.fn(async () => ({ status: "rejected", error: "nope" }) as SendResult) as unknown as typeof SendEmail;
    const { deps: d } = deps({ send });
    expect(await handleTicketRequest(FIRST, d)).toMatchObject({ status: 400, error: "One of the two email addresses was rejected. Check both and try again." });
  });

  it("pauses rather than sending with no rate store", async () => {
    const { deps: d, sent } = deps({ rate: null });
    expect(await handleTicketRequest(FIRST, d)).toMatchObject({ status: 503 });
    expect(sent).toEqual([]);
  });
});

describe("the cc reaches Resend", () => {
  it("as a cc list on the one email, and is absent when there is none", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetcher = (async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ id: "x" }), { status: 200 });
    }) as unknown as typeof fetch;
    const env = { RESEND_API_KEY: "k", LIEN_TOOL_EMAIL_FROM: "f@example.com" };
    await sendEmail({ to: "a@example.com", cc: "b@example.com", subject: "s", text: "t" }, env, fetcher);
    await sendEmail({ to: "a@example.com", subject: "s", text: "t" }, env, fetcher);
    expect(bodies.map((body) => [body.to, body.cc])).toEqual([
      [["a@example.com"], ["b@example.com"]],
      [["a@example.com"], undefined],
    ]);
  });
});

describe("the T&M ticket PDF", () => {
  it("prints every field the foreman and the super entered", async () => {
    const { text } = await readPdf(await renderTicketPdf(checkTicket(TICKET).ticket!, "Luis Ortega"));
    for (const expected of [
      "T&M / EXTRA WORK TICKET NO. TM-1NQ8K3P-7QX",
      "Date of work: 10/18/2026",
      "Company: Desert Drywall LLC",
      "Foreman: Luis Ortega",
      "Company: Acme Builders Inc.",
      "Name: Mesa Medical Office Building",
      "Patch and re-tape corridor walls after plumbing reroute",
      "Level 2 corridor, grid C-D.",
      "Sam Reyes 7.5",
      "Total crew hours: 15.5",
      "Joint compound",
      "bucket",
      "Scissor lift",
      "Name: Dana Whitfield",
      "Title: Superintendent",
      "Email: dana@acme.example",
      TM_FOOTER,
      "Page 1 of 1",
    ]) {
      expect(text).toContain(expected);
    }
  });

  it("draws the signature that was signed, not a blank line", async () => {
    const ticket = checkTicket(TICKET).ticket!;
    const signed = await readPdf(await renderTicketPdf(ticket, "Luis Ortega"));
    const bigger = await readPdf(await renderTicketPdf({ ...ticket, signature: `${SIGNED} M400 20 L420 180 L440 20` }, "Luis Ortega"));
    // One stroked path for the whole signature, beside the page's rules.
    expect(signed.strokes).toBeGreaterThan(0);
    expect(bigger.strokes).toBe(signed.strokes);
    const raw = Buffer.from(await renderTicketPdf(ticket, "Luis Ortega")).length;
    const more = Buffer.from(await renderTicketPdf({ ...ticket, signature: `${SIGNED}${" L300 150 L100 50".repeat(200)}` }, "Luis Ortega")).length;
    expect(more).toBeGreaterThan(raw);
  });

  it("flows a long crew onto a second page with the footer on both", async () => {
    const crew = Array.from({ length: 30 }, (_, i) => ({ name: `Crew member ${i + 1}`, hours: "8" }));
    const { text } = await readPdf(await renderTicketPdf(checkTicket({ ...TICKET, crew }).ticket!, "Luis Ortega"));
    expect(text).toContain("Page 2 of 2");
    expect(text).toContain("Total crew hours: 240");
    expect(text.split(TM_FOOTER)).toHaveLength(3);
  });
});
