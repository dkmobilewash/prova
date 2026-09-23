import { describe, expect, it, vi } from "vitest";
import { attachmentContentBlock, streamToolConversation } from "@prova/integrations";
import {
  ASK_ATTACHMENT_MAX_BYTES,
  askAttachmentRefusal,
  askAttachmentTypeOrSizeProblem,
  attachmentRefOf,
  type AskAttachmentRef,
} from "./attachment";
// The fetching half is server-only and lives next door, so `attachment.ts`
// can stay importable from AskPanel — see attachmentLoad.ts's header.
import { loadAskAttachment } from "./attachmentLoad";

/**
 * A file on an Ask question: the refusals (type, size, whose file), and the
 * proof that an accepted file actually reaches the model request.
 *
 * The cross-company case is asserted as "fetch was never called" and not
 * only as "an error came back" — a check that fetched another tenant's file
 * and THEN refused would pass a weaker assertion while having read it.
 */

// Store id `abc123`, derived from the token exactly as lib/blob-urls.ts does.
const ENV = { BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_abc123_secret" };
const OURS = "https://abc123.public.blob.vercel-storage.com";
const url = (companyId: string, file = "ask-bid.pdf", host = OURS) => `${host}/document-intake/${companyId}/${file}`;

const ref = (overrides: Partial<AskAttachmentRef> = {}): AskAttachmentRef => ({
  url: url("co1"),
  name: "bid.pdf",
  contentType: "application/pdf",
  size: 1000,
  ...overrides,
});

function fileResponse(body: string | Uint8Array, contentType: string, contentLength?: number) {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
  const headers = new Headers({ "content-type": contentType });
  if (contentLength !== undefined) headers.set("content-length", String(contentLength));
  return new Response(bytes as unknown as BodyInit, { status: 200, headers });
}

describe("what the box will take", () => {
  it("refuses a Word document by name, with what to do instead", () => {
    const problem = askAttachmentTypeOrSizeProblem(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      1000,
    );
    expect(problem).toMatch(/PDF/);
    expect(problem).toMatch(/Word or Excel/);
  });

  it("refuses a file over the cap in plain words, and takes one exactly at it", () => {
    expect(askAttachmentTypeOrSizeProblem("application/pdf", ASK_ATTACHMENT_MAX_BYTES + 1)).toMatch(/up to 10\.0 MB/);
    expect(askAttachmentTypeOrSizeProblem("application/pdf", ASK_ATTACHMENT_MAX_BYTES)).toBeNull();
  });

  it("refuses an empty file", () => {
    expect(askAttachmentTypeOrSizeProblem("image/png", 0)).toMatch(/empty/);
  });

  it("parses only a well-shaped reference out of a request body", () => {
    expect(attachmentRefOf({ url: "u", name: "a/b/c.pdf", contentType: "application/pdf", size: 3 })).toEqual({
      url: "u",
      name: "c.pdf",
      contentType: "application/pdf",
      size: 3,
    });
    expect(attachmentRefOf({ url: 1, name: "x", contentType: "y", size: 2 })).toBeUndefined();
    expect(attachmentRefOf("https://x")).toBeUndefined();
  });
});

describe("whose file it is", () => {
  it("refuses another company's file", () => {
    expect(askAttachmentRefusal(ref({ url: url("co2") }), "co1", ENV)).toMatch(/isn't one of your company's/);
  });

  it("refuses a URL from somebody else's blob store, even under our company's folder", () => {
    const foreign = url("co1", "ask-bid.pdf", "https://evilstore.public.blob.vercel-storage.com");
    expect(askAttachmentRefusal(ref({ url: foreign }), "co1", ENV)).toMatch(/this app's storage/);
  });

  it("refuses a path that climbs out of the company folder", () => {
    expect(askAttachmentRefusal(ref({ url: `${OURS}/document-intake/co1/../co2/x.pdf` }), "co1", ENV)).not.toBeNull();
  });

  it("accepts this company's own file", () => {
    expect(askAttachmentRefusal(ref(), "co1", ENV)).toBeNull();
  });

  it("never fetches another company's file at all", async () => {
    const fetchImpl = vi.fn();
    const loaded = await loadAskAttachment(ref({ url: url("co2") }), "co1", ENV, fetchImpl as never);
    expect(loaded.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never fetches a file declared over the cap", async () => {
    const fetchImpl = vi.fn();
    const loaded = await loadAskAttachment(ref({ size: ASK_ATTACHMENT_MAX_BYTES + 1 }), "co1", ENV, fetchImpl as never);
    expect(loaded).toMatchObject({ ok: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("reading the file", () => {
  it("measures the bytes that arrive, not the size the browser claimed", async () => {
    const big = new Uint8Array(ASK_ATTACHMENT_MAX_BYTES + 10);
    const fetchImpl = vi.fn(async () => fileResponse(big, "application/pdf"));
    const loaded = await loadAskAttachment(ref({ size: 10 }), "co1", ENV, fetchImpl as never);
    expect(loaded).toMatchObject({ ok: false });
    if (!loaded.ok) expect(loaded.error).toMatch(/10\.0 MB/);
  });

  it("refuses on a content-length over the cap before reading the body", async () => {
    const fetchImpl = vi.fn(async () => fileResponse("x", "application/pdf", ASK_ATTACHMENT_MAX_BYTES + 1));
    const loaded = await loadAskAttachment(ref(), "co1", ENV, fetchImpl as never);
    expect(loaded.ok).toBe(false);
  });

  it("turns a PDF into a base64 document block", async () => {
    const fetchImpl = vi.fn(async () => fileResponse("%PDF-1.4 hello", "application/pdf"));
    const loaded = await loadAskAttachment(ref(), "co1", ENV, fetchImpl as never);
    expect(loaded).toEqual({
      ok: true,
      block: { kind: "pdf", fileName: "bid.pdf", base64: Buffer.from("%PDF-1.4 hello").toString("base64") },
      // The page charge rides back with the block, counted from the bytes
      // this function fetched — lib/ask/pageCount.ts. These bytes have no
      // readable page tree, so the uncountable rule applies and says so.
      charge: { pages: 10, basis: "pdf-uncountable" },
    });
  });

  it("turns a CSV into a text block and a photo into an image block", async () => {
    const csv = await loadAskAttachment(
      ref({ url: url("co1", "ask-items.csv"), name: "items.csv", contentType: "text/csv" }),
      "co1",
      ENV,
      (async () => fileResponse("a,b\n1,2", "text/csv")) as never,
    );
    expect(csv).toEqual({
      ok: true,
      block: { kind: "text", fileName: "items.csv", text: "a,b\n1,2" },
      charge: { pages: 1, basis: "text" },
    });

    const photo = await loadAskAttachment(
      ref({ url: url("co1", "ask-site.jpg"), name: "site.jpg", contentType: "image/jpeg" }),
      "co1",
      ENV,
      (async () => fileResponse("jpg", "image/jpeg")) as never,
    );
    expect(photo.ok && photo.block).toMatchObject({ kind: "image", mediaType: "image/jpeg" });
  });

  it("goes by the store's content type over the browser's claim", async () => {
    // Declared a PDF; the store says it is a spreadsheet. The store is the
    // one that enforced the signed type, so it wins, and a spreadsheet is
    // not something the model can read.
    const loaded = await loadAskAttachment(
      ref(),
      "co1",
      ENV,
      (async () => fileResponse("xlsx", "application/vnd.ms-excel")) as never,
    );
    expect(loaded.ok).toBe(false);
  });
});

describe("the file reaches the model", () => {
  function fakeStream(final: unknown) {
    return { async *[Symbol.asyncIterator]() {}, finalMessage: async () => final };
  }

  it("rides in the question's own user turn, before the words, with a cache breakpoint", async () => {
    const stream = vi.fn(() => fakeStream({ stop_reason: "end_turn", content: [{ type: "text", text: "Oct 10" }] }));
    const events = streamToolConversation({
      system: "s",
      question: "what's the bid date on this?",
      attachment: { kind: "pdf", fileName: "bid.pdf", base64: "UERG" },
      tools: [],
      execute: async () => ({ content: "" }),
      client: { messages: { stream } } as never,
    });
    for await (const event of events) void event;

    const request = (stream.mock.calls[0] as unknown as [{ messages: { role: string; content: unknown }[] }])[0];
    const last = request.messages[request.messages.length - 1];
    expect(last.role).toBe("user");
    const content = last.content as { type: string; source?: { data?: string }; text?: string; cache_control?: unknown }[];
    expect(content[0]).toMatchObject({ type: "document", source: { type: "base64", media_type: "application/pdf", data: "UERG" } });
    expect(content[0].cache_control).toEqual({ type: "ephemeral" });
    expect(content[1].type).toBe("text");
    expect(content[1].text).toContain("what's the bid date on this?");
    expect(content[1].text).toContain("bid.pdf");
  });

  it("sends a plain string question, unchanged, when nothing is attached", async () => {
    const stream = vi.fn(() => fakeStream({ stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] }));
    for await (const event of streamToolConversation({
      system: "s",
      question: "what's overdue?",
      tools: [],
      execute: async () => ({ content: "" }),
      client: { messages: { stream } } as never,
    }))
      void event;
    const request = (stream.mock.calls[0] as unknown as [{ messages: { content: unknown }[] }])[0];
    expect(request.messages[0].content).toBe("what's overdue?");
  });

  it("builds image and text blocks in the API's own shapes", () => {
    expect(attachmentContentBlock({ kind: "image", fileName: "a.png", mediaType: "image/png", base64: "Zg==" })).toMatchObject({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "Zg==" },
    });
    expect(attachmentContentBlock({ kind: "text", fileName: "a.txt", text: "hi" })).toMatchObject({
      type: "document",
      source: { type: "text", media_type: "text/plain", data: "hi" },
    });
  });
});
