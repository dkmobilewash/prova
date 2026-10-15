import { describe, expect, it, vi } from "vitest";
import { createLetter, keyMode, LOB_LETTERS_URL } from "./lob";
import { decideLetters, queueLettersForTier1, type QueueCandidate } from "./queue";
import { sendQueuedLetters } from "./send";
import { addresseeFor, factSentence, FORBIDDEN, letterFor, letterHtml, missingConfig, toAddressFor, type LetterConfig } from "./template";
import { factFor, type Signal } from "@/lib/public-works/signals";

/** Every firm, person, address and key here is invented. */

const config: LetterConfig = {
  fromName: "Cyrus Oliveras",
  fromAddress: { line1: "100 Test Way Ste 2", city: "Ventura", state: "CA", zip: "93001" },
  mobile: "(805) 555-0199",
  replyEmail: "cyrus@example.test",
};

const today = new Date("2026-10-14T00:00:00Z");
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(today.getTime() - n * DAY);

const filing: Signal = { kind: "ECPR_FILING", project: "McAuliffe Modernization", awardingBody: "Oxnard School District", primeContractor: null, occurredOn: daysAgo(7) };
const oldListing: Signal = { kind: "PROJECT_LISTING", project: "Old Gym", awardingBody: "Some USD", primeContractor: "Big GC", occurredOn: daysAgo(400) };

const firm = {
  licence: "12345",
  name: "ACME DRYWALL INC",
  mailingAddress: "1 MAIN ST",
  city: "OXNARD",
  zip: "93030",
  owners: [{ name: "SMITH JOHN", title: "RMO" }],
};

describe("the letter", () => {
  const fact = factFor([filing]);
  const out = letterFor(firm, fact, config);

  it("opens with the public fact and names the source, in the subs' words", () => {
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const lines = out.body.split("\n");
    expect(lines[0]).toBe("John —");
    expect(lines[2]).toMatch(/^ACME DRYWALL INC filed certified payroll on McAuliffe Modernization for Oxnard School District on October 7 — that's on the DIR's certified payroll list\./);
    expect(out.body).toContain("the 347");
    expect(out.body).toContain("certifieds");
    expect(out.body).toContain('text me "yes" at (805) 555-0199');
    expect(out.body).toContain("Cyrus Oliveras, founder, C Stream");
    expect(out.body.split("\n").at(-1)).toBe("C Stream, Inc. · cstream.ai · 100 Test Way Ste 2, Ventura, CA 93001");
    expect(out.body.split(/\s+/).length).toBeLessThan(200);
  });

  it("uses none of the study's forbidden words, including the eCPR the fact itself carries", () => {
    if (!out.ok) throw new Error(out.error);
    for (const re of FORBIDDEN) expect(out.body, String(re)).not.toMatch(re);
    expect(fact).toContain("eCPR"); // the page's fact does; the letter must not
  });

  it("refuses without a return address, naming the env var", () => {
    const r = letterFor(firm, fact, { ...config, fromAddress: { ...config.fromAddress, line1: " " } });
    expect(r).toEqual({ ok: false, error: expect.stringContaining("OUTBOUND_FROM_LINE1") });
    expect(missingConfig(undefined)).toHaveLength(7);
    expect(missingConfig(config)).toEqual([]);
  });

  it("refuses a firm with no complete mailing address, and a firm with no fact", () => {
    expect(letterFor({ ...firm, zip: null }, fact, config)).toMatchObject({ ok: false, error: expect.stringContaining("mailing address") });
    expect(letterFor(firm, "", config)).toMatchObject({ ok: false, error: expect.stringContaining("no public fact") });
    expect(toAddressFor({ ...firm, zip: "9303" })).toBeNull();
  });

  it("turns CSLB's surname-first owner into a greeting and falls back to the firm", () => {
    expect(addresseeFor(firm)).toBe("John Smith");
    expect(addresseeFor({ name: "ACME DRYWALL INC", owners: [] })).toBe("ACME DRYWALL INC");
    expect(toAddressFor(firm)).toEqual({ name: "John Smith", company: "ACME DRYWALL INC", line1: "1 MAIN ST", city: "Oxnard", state: "CA", zip: "93030" });
  });

  it("speaks a project listing too, and leaves an unknown fact shape alone minus the acronym", () => {
    expect(factSentence(factFor([{ ...oldListing, occurredOn: new Date("2026-09-01T00:00:00Z") }]))).toBe(
      "is listed as a sub on Old Gym (Some USD, GC Big GC), awarded September 1 — that's on the DIR's project list",
    );
    expect(factSentence("something about eCPR")).toBe("something about certified payroll");
  });

  it("renders HTML as escaped paragraphs", () => {
    expect(letterHtml("a & b\nc\n\nd")).toContain("<p>a &amp; b<br>c</p><p>d</p>");
  });
});

describe("the queue picks tier 1, once per fact, with an address", () => {
  const candidate = (over: Partial<QueueCandidate>): QueueCandidate => ({ ...firm, signals: [filing], letters: [], ...over });

  it("decides", () => {
    const fact = factFor([filing]);
    const decisions = decideLetters(
      [
        candidate({ licence: "1" }),
        candidate({ licence: "2", signals: [oldListing] }),
        candidate({ licence: "3", signals: [] }),
        candidate({ licence: "4", letters: [{ signalFact: fact }] }),
        candidate({ licence: "5", letters: [{ signalFact: "an older fact" }] }),
        candidate({ licence: "6", mailingAddress: null }),
      ],
      config,
      today,
    );
    expect(decisions.map((d) => ("skipped" in d ? d.skipped : "QUEUE"))).toEqual([
      "QUEUE",
      "not in market this week",
      "not in market this week",
      "already written to about this filing",
      "QUEUE",
      expect.stringContaining("mailing address"),
    ]);
  });

  it("writes one row per decision, carrying the fact verbatim", async () => {
    const create = vi.fn(async (_args: { data: Record<string, unknown> }) => ({}));
    const prisma = {
      publicWorksFirm: { findMany: vi.fn(async () => [candidate({ licence: "1" }), candidate({ licence: "4", letters: [{ signalFact: factFor([filing]) }] })]) },
      publicWorksLetter: { create },
    } as never;
    const report = await queueLettersForTier1({ prisma, config, today });
    expect(report).toEqual({ queued: 1, skipped: { "already written to about this filing": 1 } });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0]).toMatchObject({ data: { licence: "1", signalFact: factFor([filing]), templateKey: expect.any(String) } });
  });
});

describe("the Lob client", () => {
  const to = { name: "John Smith", address_line1: "1 Main St", address_city: "Oxnard", address_state: "CA", address_zip: "93030" };
  const req = { to, from: to, html: "<p>hi</p>", description: "d", idempotencyKey: "ltr-row-1" };

  it("authenticates with the key as the Basic username, sends the idempotency key, and parses the reply", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "ltr_abc", expected_delivery_date: "2026-10-20", url: "https://x" }), { status: 200 }));
    const r = await createLetter(req, { apiKey: "test_123", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r).toEqual({ ok: true, id: "ltr_abc", expectedDeliveryOn: "2026-10-20", url: "https://x" });
    const [url, init] = fetchImpl.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe(LOB_LETTERS_URL);
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("test_123:").toString("base64")}`);
    expect(headers["Idempotency-Key"]).toBe("ltr-row-1");
    expect(JSON.parse(init.body as string)).toMatchObject({ file: "<p>hi</p>", color: false, use_type: "marketing", address_placement: "top_first_page" });
  });

  it("maps a Lob error to a sentence, and a missing key to a refusal without calling", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { message: "to.address_zip is invalid", status_code: 422, code: "invalid" } }), { status: 422 }));
    expect(await createLetter(req, { apiKey: "test_123", fetchImpl: fetchImpl as unknown as typeof fetch })).toEqual({ ok: false, error: "Lob refused the letter (invalid): to.address_zip is invalid" });
    expect(await createLetter(req, { apiKey: undefined, fetchImpl: fetchImpl as unknown as typeof fetch })).toMatchObject({ ok: false, error: expect.stringContaining("LOB_API_KEY") });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(keyMode("live_x")).toBe("live");
    expect(keyMode("test_x")).toBe("test");
    expect(keyMode("")).toBe("missing");
  });
});

describe("sending is idempotent", () => {
  const row = (id: string) => ({ id, body: "Dear —\n\nhi", toAddress: toAddressFor(firm), signalFact: "f", firm: { name: firm.name, licence: firm.licence } });

  it("sends only QUEUED rows, keys each call on the row id, and records SENT or FAILED", async () => {
    const update = vi.fn(async (_args: { where: { id: string }; data: Record<string, unknown> }) => ({}));
    const findMany = vi.fn(async (args: { where: { status: string } }) => (args.where.status === "QUEUED" ? [row("a"), row("b")] : []));
    const prisma = { publicWorksLetter: { findMany, update } } as never;
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const key = (init.headers as Record<string, string>)["Idempotency-Key"];
      return key === "a"
        ? new Response(JSON.stringify({ id: "ltr_a", expected_delivery_date: "2026-10-20" }), { status: 200 })
        : new Response(JSON.stringify({ error: { message: "undeliverable", code: "bad" } }), { status: 422 });
    });
    const report = await sendQueuedLetters({ prisma, config, apiKey: "test_k", fetchImpl: fetchImpl as unknown as typeof fetch, now: () => today });
    expect(report).toEqual({ sent: 1, failed: 1 });
    expect(findMany.mock.calls[0]![0]).toMatchObject({ where: { status: "QUEUED" } });
    expect(update.mock.calls[0]![0]).toMatchObject({ where: { id: "a" }, data: { status: "SENT", lobId: "ltr_a", expectedDeliveryOn: new Date("2026-10-20T00:00:00Z") } });
    expect(update.mock.calls[1]![0]).toMatchObject({ where: { id: "b" }, data: { status: "FAILED", error: expect.stringContaining("undeliverable") } });

    // Second press: nothing QUEUED remains, so Lob is not called again.
    findMany.mockResolvedValueOnce([]);
    expect(await sendQueuedLetters({ prisma, config, apiKey: "test_k", fetchImpl: fetchImpl as unknown as typeof fetch })).toEqual({ sent: 0, failed: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
