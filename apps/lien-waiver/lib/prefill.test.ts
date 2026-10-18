import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it, vi } from "vitest";
import { addContact, type sendEmail as SendEmail, type SendResult } from "./email";
import { checkFills } from "./fills";
import {
  forwardQuery,
  hasPrefill,
  MAX_ADDRESS_LENGTH,
  MAX_LENGTH,
  parsePrefill,
  PREFILL_FIELDS,
  PREFILL_MAP,
  prefillAnswers,
  sanitizeRef,
  sanitizeText,
  type PrefillField,
} from "./prefill";
import { handlePrefillEvent } from "./prefill-event";
import { LIMITS, MemoryRateStore } from "./rate-limit";
import { fillable, formsFor, slotsAsked } from "./statutes/forms";
import { printedText, segmentForm } from "./statutes/render";
import { STATES, type StateCode } from "./statutes/types";
import { handleWaiverRequest, type WaiverDeps } from "./waiver-request";

const LINK = {
  company: "Test Drywall Inc",
  license: "CSLB 1234567",
  owner: "Mesa Medical Partners LP",
  project: "Mesa Medical Office",
  address: "1234 E Main St, Mesa",
  gc: "Test GC",
};
const query = (extra: Record<string, string> = {}) => new URLSearchParams({ ...LINK, ...extra });

/** Which blank each value must land in, written out per state from the forms
 * (see the dump in the PR), so a wrong table entry fails here by name. */
const EXPECTED: Record<StateCode, Partial<Record<PrefillField, string>>> = {
  AZ: { company: "companyName", gc: "customer", owner: "owner", project: "project", address: "jobDescription" },
  CA: { company: "companyName", gc: "customer", owner: "owner", address: "jobLocation" },
  NV: { company: "companyName", gc: "customer", project: "project", address: "jobLocation" },
  TX: { company: "companyName", gc: "customer", owner: "owner", project: "project", address: "jobLocation" },
};

describe("the mapping table", () => {
  it("is exactly the table the forms call for", () => {
    expect(PREFILL_MAP).toEqual(EXPECTED);
  });

  it("names only blanks that state's forms actually have", () => {
    for (const state of STATES) {
      const asked = new Set(formsFor(state).flatMap((form) => slotsAsked(form).map((field) => field.slot)));
      for (const slot of Object.values(PREFILL_MAP[state])) expect(asked, `${state} ${slot}`).toContain(slot);
    }
  });

  it("maps `license` nowhere, because no state's form has a licence blank", () => {
    for (const state of STATES) {
      expect(PREFILL_MAP[state].license).toBeUndefined();
      for (const form of formsFor(state)) expect(slotsAsked(form).map((field) => field.label).join(" ")).not.toMatch(/licen/i);
    }
  });
});

// Every form in the tool, sixteen of them, asserted so an empty list cannot
// pass everything below by having nothing in it.
const FORMS = STATES.flatMap((state) => formsFor(state).map((form) => [state, form] as const));
it("walks all sixteen forms", () => expect(FORMS).toHaveLength(16));

describe.each(FORMS.map(([state, form]) => [`${state} ${form.form}`, state, form] as const))("%s", (_name, state, form) => {
  const answers = prefillAnswers(state, parsePrefill(query()).values);
  const { fills, errors } = checkFills(form, answers);
  const printed = segmentForm(form)
    .map((paragraph) => printedText(paragraph, fills, fillable))
    .join("\n");
  const asked = new Set(slotsAsked(form).map((field) => field.slot));

  it("puts each value in its blank, and only there", () => {
    for (const [field, slot] of Object.entries(EXPECTED[state]) as Array<[PrefillField, string]>) {
      if (!asked.has(slot as never)) continue;
      expect(fills[slot as keyof typeof fills], `${field} -> ${slot}`).toBe(LINK[field]);
      expect(printed).toContain(LINK[field]);
    }
    // Pre-filled values pass the same checks as typed ones.
    for (const slot of Object.keys(answers)) if (asked.has(slot as never)) expect(errors[slot as keyof typeof errors]).toBeUndefined();
  });

  it("ignores a parameter this form has no blank for", () => {
    expect(printed).not.toContain(LINK.license);
    for (const field of PREFILL_FIELDS) {
      const slot = EXPECTED[state][field];
      if (!slot || !asked.has(slot as never)) expect(printed, field).not.toContain(LINK[field]);
    }
  });

  it("stays editable: a typed value replaces the link's", () => {
    const edited = checkFills(form, { ...answers, companyName: "Somebody Else LLC" });
    expect(edited.fills.companyName).toBe("Somebody Else LLC");
  });
});

describe("reading a link", () => {
  it("selects a valid state, any case, and ignores anything else", () => {
    expect(parsePrefill(new URLSearchParams("state=CA")).state).toBe("CA");
    expect(parsePrefill(new URLSearchParams("state=nv")).state).toBe("NV");
    for (const bad of ["NM", "XX", "California", "", "<script>"]) expect(parsePrefill(new URLSearchParams({ state: bad })).state).toBeNull();
  });

  it("reads the four type codes and nothing else", () => {
    expect(parsePrefill(new URLSearchParams("type=cp")).form).toBe("CONDITIONAL_PROGRESS");
    expect(parsePrefill(new URLSearchParams("type=up")).form).toBe("UNCONDITIONAL_PROGRESS");
    expect(parsePrefill(new URLSearchParams("type=cf")).form).toBe("CONDITIONAL_FINAL");
    expect(parsePrefill(new URLSearchParams("type=UF")).form).toBe("UNCONDITIONAL_FINAL");
    expect(parsePrefill(new URLSearchParams("type=xx")).form).toBeNull();
  });

  it("ignores email, phone and every other unknown parameter", () => {
    const params = new URLSearchParams("email=a@b.com&phone=5555551234&name=Pat&website=x&company=Acme");
    const prefill = parsePrefill(params);
    expect(prefill.values).toEqual({ company: "Acme" });
    expect(JSON.stringify(prefill)).not.toMatch(/a@b\.com|5555551234|Pat/);
    expect(forwardQuery(params)).toBe("?company=Acme");
  });

  it("forwards only known keys from /start to the state page", () => {
    expect(forwardQuery(new URLSearchParams("state=CA&type=cp&gc=Test%20GC&ref=TEST-0001&email=a@b.com"))).toBe(
      "?type=cp&gc=Test+GC&ref=TEST-0001",
    );
    expect(forwardQuery(new URLSearchParams(""))).toBe("");
  });

  it("is a plain visit when there is nothing usable in it", () => {
    expect(hasPrefill(parsePrefill(new URLSearchParams("")))).toBe(false);
    expect(hasPrefill(parsePrefill(new URLSearchParams("email=a@b.com&state=CA")))).toBe(false);
    expect(hasPrefill(parsePrefill(new URLSearchParams("ref=SD-PL-0001")))).toBe(true);
  });
});

describe("sanitizing", () => {
  it("neutralizes script tags and markup", () => {
    expect(sanitizeText("<script>alert(1)</script>Acme Drywall", MAX_LENGTH)).toBe("Acme Drywall");
    expect(sanitizeText("<img src=x onerror=alert(1)>Acme", MAX_LENGTH)).toBe("Acme");
    expect(sanitizeText("<b>Bold</b> Builders", MAX_LENGTH)).toBe("Bold Builders");
    // Anything shaped like a tag goes, even when it was not meant as one --
    // the cost of "no markup at all" is the odd mangled angle bracket.
    expect(sanitizeText("A < B > C", MAX_LENGTH)).toBe("A C");
    expect(sanitizeText("Smith > Jones", MAX_LENGTH)).toBe("Smith Jones");
    expect(sanitizeText("<script>unterminated", MAX_LENGTH)).toBeNull();
    expect(sanitizeText("line\none\ttwo\u0000", MAX_LENGTH)).toBe("line one two");
    expect(sanitizeText("   ", MAX_LENGTH)).toBeNull();
  });

  it("cuts long values: 120, or 200 for the address", () => {
    const long = "x".repeat(5000);
    const prefill = parsePrefill(new URLSearchParams({ company: long, address: long, gc: long }));
    expect(prefill.values.company).toHaveLength(MAX_LENGTH);
    expect(prefill.values.gc).toHaveLength(120);
    expect(prefill.values.address).toHaveLength(MAX_ADDRESS_LENGTH);
    expect(MAX_ADDRESS_LENGTH).toBe(200);
  });

  it("a script in a link never reaches a blank", () => {
    const answers = prefillAnswers("CA", parsePrefill(new URLSearchParams({ company: "<script>alert('x')</script>Test Drywall Inc" })).values);
    expect(answers.companyName).toBe("Test Drywall Inc");
  });

  it("accepts a ref only as a plain code", () => {
    expect(sanitizeRef("SD-PL-0001")).toBe("SD-PL-0001");
    expect(sanitizeRef(" TEST_0001.a ")).toBe("TEST_0001.a");
    for (const bad of ["<script>", "has space", "a".repeat(41), "", "x@y.com"]) expect(sanitizeRef(bad)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The ref on the lead, and nowhere a person can see it.

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
const REF = "SD-PL-0001";

function deps(overrides: Partial<WaiverDeps> = {}) {
  const sent: Array<{ to: string; subject: string; text: string; attachments?: Array<{ content: Uint8Array }> }> = [];
  const contacts: Array<Record<string, unknown>> = [];
  const base: WaiverDeps = {
    env: {},
    rate: { store: new MemoryRateStore(), salt: "s" },
    ip: "1.2.3.4",
    published: () => true,
    reviewed: () => false,
    send: vi.fn(async (message: (typeof sent)[number]) => {
      sent.push(message);
      return { status: "sent", id: "x" } as SendResult;
    }) as unknown as typeof SendEmail,
    subscribe: vi.fn(async (contact: Record<string, unknown>) => {
      contacts.push(contact);
      return { status: "sent", id: "c" } as SendResult;
    }) as unknown as typeof addContact,
    ...overrides,
  };
  return { deps: base, sent, contacts };
}
const BODY = { state: "TX", form: "CONDITIONAL_PROGRESS", fills: FILLS, email: "sub@example.com", name: "Pat Sub", company: "Desert Drywall" };

const STANDARD_FONTS = join(dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json")), "standard_fonts") + "/";
async function pdfText(bytes: Uint8Array): Promise<string> {
  const doc = await getDocument({ data: bytes, useSystemFonts: false, isEvalSupported: false, standardFontDataUrl: STANDARD_FONTS }).promise;
  const parts: string[] = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    for (const item of (await (await doc.getPage(n)).getTextContent()).items) if ("str" in item) parts.push(item.str);
  }
  return parts.join(" ").replace(/\s+/g, " ");
}

describe("ref", () => {
  it("is saved on the lead: the note to Diego and the Resend contact", async () => {
    const { deps: d, sent, contacts } = deps();
    expect(await handleWaiverRequest({ ...BODY, ref: REF }, d)).toMatchObject({ kind: "sent" });
    const note = sent.find((message) => message.subject.startsWith("Lien waiver lead"))!;
    expect(note.to).toBe("diego@cstream.ai");
    expect(note.subject).toContain(`[${REF}]`);
    expect(note.text).toContain(`Ref: ${REF}`);
    expect(contacts).toEqual([expect.objectContaining({ email: "sub@example.com", ref: REF })]);
  });

  it("never appears in the PDF or in the person's own email", async () => {
    const { deps: d, sent } = deps();
    await handleWaiverRequest({ ...BODY, ref: REF }, d);
    const own = sent.find((message) => message.to === "sub@example.com")!;
    expect(own.subject + own.text).not.toContain(REF);
    const text = await pdfText(own.attachments![0].content);
    // A positive control first: the reader really did read the PDF.
    expect(text).toContain("Desert Drywall LLC");
    expect(text).not.toContain(REF);
  });

  it("without a ref, the lead says so and the request is unchanged", async () => {
    const { deps: d, sent, contacts } = deps();
    await handleWaiverRequest(BODY, d);
    expect(sent[1].text).toContain("Ref: (none");
    expect(contacts[0].ref).toBeNull();
  });

  it("a ref that is not a plain code is dropped, not written into an email", async () => {
    const { deps: d, sent } = deps();
    await handleWaiverRequest({ ...BODY, ref: "<script>x</script>" }, d);
    expect(JSON.stringify(sent)).not.toContain("<script>");
  });

  it("a returning browser from an outreach link still sends Diego the lead, without adding the contact twice", async () => {
    const { deps: d, sent, contacts } = deps();
    await handleWaiverRequest({ ...BODY, returning: true, ref: REF }, d);
    expect(sent.map((message) => message.subject.startsWith("Lien waiver lead"))).toEqual([false, true]);
    expect(sent[1].text).toContain(`Ref: ${REF}`);
    expect(contacts).toEqual([]);
  });

  it("a returning browser with NO ref behaves exactly as before: no lead note", async () => {
    const { deps: d, sent } = deps();
    await handleWaiverRequest({ ...BODY, returning: true }, d);
    expect(sent).toHaveLength(1);
  });
});

describe("the Resend contact's ref property", () => {
  const env = { RESEND_API_KEY: "re_test", RESEND_AUDIENCE_ID: "aud" };
  const fetcher = (statuses: number[]) => {
    const bodies: Array<Record<string, unknown>> = [];
    const fn = (async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      const status = statuses[bodies.length - 1];
      return new Response(JSON.stringify(status < 300 ? { id: "c1" } : { message: "property ref does not exist" }), { status });
    }) as unknown as typeof fetch;
    return { fn, bodies };
  };

  it("sends `properties.ref` when there is one", async () => {
    const { fn, bodies } = fetcher([200]);
    expect(await addContact({ email: "a@b.com", name: "Pat Sub", marketingOptIn: false, ref: REF }, env, fn)).toEqual({ status: "sent", id: "c1" });
    expect(bodies[0].properties).toEqual({ ref: REF });
  });

  it("keeps the contact if Resend refuses the property, and says the ref was dropped", async () => {
    const { fn, bodies } = fetcher([422, 200]);
    const result = await addContact({ email: "a@b.com", name: "Pat Sub", marketingOptIn: false, ref: REF }, env, fn);
    expect(result).toMatchObject({ status: "sent", refDropped: expect.stringMatching(/422/) });
    expect(bodies[1]).not.toHaveProperty("properties");
  });

  it("sends no properties at all without a ref -- the request it always sent", async () => {
    const { fn, bodies } = fetcher([200]);
    await addContact({ email: "a@b.com", name: "Pat Sub", marketingOptIn: true }, env, fn);
    expect(Object.keys(bodies[0]).sort()).toEqual(["email", "first_name", "last_name", "unsubscribed"]);
  });
});

describe("prefill_link_opened", () => {
  const run = (body: Record<string, unknown>, ip = "9.9.9.9", store = new MemoryRateStore()) => {
    const lines: string[] = [];
    return handlePrefillEvent(body, { rate: { store, salt: "s" }, ip, log: (line) => lines.push(line) }).then((status) => ({ status, lines }));
  };

  it("logs the event with the ref and the state, and nothing about the person", async () => {
    const { status, lines } = await run({ ref: REF, state: "CA", email: "a@b.com", company: "Acme" });
    expect(status).toBe(204);
    expect(lines.map((line) => JSON.parse(line))).toEqual([{ event: "prefill_link_opened", ref: REF, state: "CA" }]);
    expect(lines.join()).not.toMatch(/a@b\.com|Acme|9\.9\.9\.9/);
  });

  it("refuses a ref that is not a plain code", async () => {
    expect((await run({ ref: "<script>" })).status).toBe(400);
    expect((await run({})).status).toBe(400);
  });

  it("is rate limited per connection", async () => {
    const store = new MemoryRateStore();
    for (let i = 0; i < LIMITS.prefillEventsPerIpPerHour; i += 1) expect((await run({ ref: REF }, "1.1.1.1", store)).status).toBe(204);
    expect((await run({ ref: REF }, "1.1.1.1", store)).status).toBe(429);
  });
});
