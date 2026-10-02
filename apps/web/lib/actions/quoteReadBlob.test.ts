import { beforeEach, describe as group, expect, it, vi } from "vitest";

/**
 * THE UPLOADED QUOTE IS DELETED ON EVERY PATH OUT OF `readBidQuoteDocument`.
 *
 * ── THE DEFECT, WHICH SHIPPED ──
 *
 * Issue #559. The action takes the blob URL as an argument and no bid model has
 * a `fileUrl` column, so every quote read left a PDF in the store that nothing
 * pointed at. Blobs are uploaded `access: "public"` — the URL is unguessable,
 * but anybody who ever holds it can fetch a competitor's pricing forever with no
 * sign-in — and a stranded one had no row in the database that would let
 * anybody find it again to remove it. `deleteDocument` was called from four
 * files in the repo and none of them was this path.
 *
 * ── WHY THE TEST IS PER-PATH RATHER THAN ONE HAPPY CASE ──
 *
 * The fix is a `finally`, so a single success case would pass over a version
 * that only deleted on success — which is the version somebody writing this by
 * hand would land on, because success is the path you are looking at while you
 * write it. There are FIVE ways out, every one of which stranded the file: the
 * per-company switch being off, the store not serving the bytes, the allowance
 * refusing, the extractor throwing, and success. Each gets a case, and each
 * asserts the delete AND that the path still behaves as it did.
 *
 * The two refusals BEFORE the URL is validated are asserted too, in the other
 * direction: nothing may be deleted there, because `documentUrlProblem` has not
 * yet proved the URL is ours. Deleting by an unvalidated URL is the dangerous
 * half of #195 — a blob URL is not proof of whose file it is — and a fix that
 * deleted eagerly could take out an addendum's stored file or another tenant's.
 */

type Fake = { company: { id: string }; id: string; role: string; jobFunction: string | null };
const context: Fake = { company: { id: "co_1" }, id: "user_1", role: "OWNER", jobFunction: null };

/** Every URL handed to the blob store's delete, in order. */
const deleted: string[] = [];

let bidRow: { id: string; companyId: string } | null = null;
let urlProblem: string | null = null;
let gateOk = true;
let storeServes = true;
let allowanceOk = true;
let extractorThrows = false;
let markedFailures = 0;

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("@/lib/permissions", () => ({ can: () => context.role !== "NOBODY" }));
vi.mock("@prova/db", () => ({
  Prisma: {},
  prisma: { bidInvitation: { findFirst: async () => bidRow } },
}));
vi.mock("@/lib/blob", () => ({
  deleteDocument: async (url: string) => {
    deleted.push(url);
  },
}));
vi.mock("@/lib/ai/settings", () => ({
  aiGate: async () =>
    gateOk ? { ok: true, model: "claude-opus-5" } : { ok: false, error: "Quote reading is switched off." },
}));
vi.mock("@/lib/ask/usage", () => ({ recordAskUsage: async () => {} }));
vi.mock("@/lib/ask/documentSpend", () => ({
  claimDocumentPages: async () =>
    allowanceOk
      ? { ok: true, claim: { id: "claim_1" }, note: "1 page", pagesLeft: 99 }
      : { ok: false, error: "This month's document pages are used up." },
}));
vi.mock("@/lib/ask/allowance", () => ({
  markAskAllowanceFailure: async () => {
    markedFailures += 1;
  },
}));
vi.mock("@/lib/document-uploads", () => ({
  documentUrlProblem: () => urlProblem,
  documentDisplayFileName: (name: string) => name,
  // The action checks the type the STORE served, not the caller's claim. Real
  // here rather than a blanket `true`, so a case that changes the served type
  // to something unacceptable would exercise the refusal rather than sail past
  // it — the media-type allowlist is not this file's subject but silently
  // disabling it would make one of the paths below untrue.
  isAllowedDocumentType: (type: string) =>
    ["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(type),
  // Generous on purpose: the four-byte fixture below must not be refused for
  // size, because a size refusal is a different path from the five under test.
  uploadMaxBytesFor: () => 250 * 1024 * 1024,
  DOCUMENT_UPLOAD_TARGETS: { "bid-quote": { scope: "company", maxBytes: 1024 } },
}));
vi.mock("@prova/integrations", () => ({
  extractBidQuote: async () => {
    if (extractorThrows) throw new Error("the model refused");
    return {
      vendorName: "Acme Drywall",
      packageLabel: null,
      amount: 1000,
      quotedOn: "2026-10-02",
      exclusions: null,
      readingNotes: null,
    };
  },
}));

/**
 * The one piece the action reaches the network with. Stubbed through `fetch`
 * because `readStoredQuote` is module-private and reads the store directly —
 * stubbing it any other way would mean exporting it only for a test, which is
 * the shape that makes a private function part of the API by accident.
 */
const originalFetch = globalThis.fetch;

beforeEach(() => {
  deleted.length = 0;
  bidRow = { id: "bid_1", companyId: "co_1" };
  urlProblem = null;
  gateOk = true;
  storeServes = true;
  allowanceOk = true;
  extractorThrows = false;
  markedFailures = 0;
  context.role = "OWNER";
  globalThis.fetch = (async () =>
    storeServes
      ? {
          ok: true,
          headers: { get: (h: string) => (h.toLowerCase() === "content-type" ? "application/pdf" : null) },
          arrayBuffer: async () => new Uint8Array([37, 80, 68, 70]).buffer,
        }
      : { ok: false, status: 404, headers: { get: () => null } }) as unknown as typeof fetch;
});

async function read() {
  const { readBidQuoteDocument } = await import("./quoteRead");
  return readBidQuoteDocument("bid_1", "https://store.public.blob.vercel-storage.com/co_1/bid-quote/q.pdf", "q.pdf");
}

const URL_READ = "https://store.public.blob.vercel-storage.com/co_1/bid-quote/q.pdf";

group("reading a quote never leaves its file behind", () => {
  it("deletes it after a successful read", async () => {
    const result = await read();
    expect(result.ok, "the happy path still succeeds").toBe(true);
    expect(deleted, "the file is gone once its bytes have been read").toEqual([URL_READ]);
  });

  it("deletes it when the company has quote reading switched off", async () => {
    gateOk = false;
    const result = await read();
    expect(result.ok).toBe(false);
    // The refusal is the point of the switch and the delete is the point of
    // this file: a company that said a competitor's pricing must not reach a
    // model should not be left with that pricing at a public URL either.
    expect(deleted).toEqual([URL_READ]);
  });

  it("deletes it when the store will not serve the bytes back", async () => {
    storeServes = false;
    const result = await read();
    expect(result.ok).toBe(false);
    expect(deleted).toEqual([URL_READ]);
  });

  it("deletes it when the month's allowance refuses", async () => {
    allowanceOk = false;
    const result = await read();
    expect(result.ok).toBe(false);
    expect(deleted).toEqual([URL_READ]);
  });

  it("deletes it when the extractor throws, and still marks the failure", async () => {
    extractorThrows = true;
    const result = await read();
    expect(result.ok).toBe(false);
    // Marked, not released — the rule the action already followed. Asserted
    // here so the `finally` cannot be mistaken for a reason to stop marking.
    expect(markedFailures, "a failed read is still charged as a failure").toBe(1);
    expect(deleted).toEqual([URL_READ]);
  });

  it("deletes NOTHING when the URL has not been proved ours", async () => {
    // The dangerous direction. Before `documentUrlProblem` accepts it, this URL
    // is a claim the browser made — it could name an addendum's stored file, a
    // contract document, or another tenant's upload. #195: a blob URL is not
    // proof of whose file it is.
    urlProblem = "That file did not come from this app's storage.";
    const result = await read();
    expect(result.ok).toBe(false);
    expect(deleted, "an unvalidated URL must never be deleted").toEqual([]);
  });

  it("deletes NOTHING when the bid is not this company's", async () => {
    bidRow = null;
    const result = await read();
    expect(result.ok).toBe(false);
    expect(deleted).toEqual([]);
  });

  it("deletes NOTHING when the caller lacks the capability", async () => {
    context.role = "NOBODY";
    const result = await read();
    expect(result.ok).toBe(false);
    expect(deleted).toEqual([]);
  });
});

globalThis.fetch = originalFetch;
