import { afterEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const put = vi.fn(async () => ({ pathname: "sent-documents/c/a.pdf" }));
vi.mock("@vercel/blob", () => ({ get, put }));
const { readSentCopy, SENT_COPY_STORE, sentCopyResponse, storeSentCopy } = await import("./sent-document-store");

const collect = async (body: ReadableStream<Uint8Array> | null) => new Uint8Array(await new Response(body).arrayBuffer());

describe("the store switch", () => {
  afterEach(() => vi.clearAllMocks());

  it("stays on the database until a private store exists", () => {
    expect(SENT_COPY_STORE).toBe("database");
  });

  it("keeps bytes in the row and touches no blob", async () => {
    const stored = await storeSentCopy("c", "a.pdf", Buffer.from("%PDF"));
    expect(stored.blobPathname).toBeNull();
    expect(Buffer.from(stored.content!).toString()).toBe("%PDF");
    expect(put).not.toHaveBeenCalled();
  });

  it("reads a large row back whole, in pieces", async () => {
    const bytes = new Uint8Array(3 * 1024 * 1024 + 7).fill(5);
    expect((await collect(await readSentCopy({ content: bytes, blobPathname: null }))).byteLength).toBe(bytes.byteLength);
  });

  it("follows the row, so a Blob copy still reads with the switch on database", async () => {
    get.mockResolvedValue({ stream: new Response("blob bytes").body });
    const read = await readSentCopy({ content: null, blobPathname: "sent-documents/c/a.pdf" });
    expect(new TextDecoder().decode(await collect(read))).toBe("blob bytes");
    expect(get).toHaveBeenCalledWith("sent-documents/c/a.pdf", expect.objectContaining({ access: "private" }));
  });

  it("reports a row with nothing in it as nothing", async () => {
    expect(await readSentCopy({ content: null, blobPathname: null })).toBeNull();
  });

  it("serves a download that cannot be cached or rendered in place", () => {
    const headers = sentCopyResponse(new Response("x").body!, 'a"b.pdf').headers;
    expect(headers.get("content-disposition")).toBe('attachment; filename="ab.pdf"');
    expect(headers.get("cache-control")).toContain("no-store");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
  });
});
