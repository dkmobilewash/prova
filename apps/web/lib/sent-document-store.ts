import { get, put } from "@vercel/blob";

/**
 * WHERE THE EXACT FILE WE SENT IS KEPT. The one place that knows.
 *
 * TODO(diego): when a private Blob store exists, connect it in the Vercel
 * dashboard with the variable prefix `SENT_DOCUMENTS` and change this one word to
 * "blob". Nothing else moves. Rows already written stay readable, because a read
 * follows the row, never this constant. The token is never copied by hand.
 *
 * It starts as "database" because the shared Blob store is public to anyone with
 * the link, and these are financial documents.
 */
export const SENT_COPY_STORE: "database" | "blob" = "database";

const blobToken = () => process.env.SENT_DOCUMENTS_READ_WRITE_TOKEN;

/** The columns that hold a new copy. */
export async function storeSentCopy(companyId: string, fileName: string, bytes: Buffer) {
  if (SENT_COPY_STORE === "database") return { content: new Uint8Array(bytes), blobPathname: null };
  const { pathname } = await put(`sent-documents/${companyId}/${fileName}`, bytes, {
    access: "private",
    addRandomSuffix: true,
    contentType: "application/pdf",
    token: blobToken(),
  });
  return { content: null, blobPathname: pathname };
}

const CHUNK_BYTES = 1024 * 1024;

/** Streamed, because a function's plain response is size-limited and a package
 * can be large. */
function chunked(bytes: Uint8Array): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.byteLength) return controller.close();
      controller.enqueue(bytes.subarray(offset, offset + CHUNK_BYTES));
      offset += CHUNK_BYTES;
    },
  });
}

/** Follows the row, so a store change never strands an older copy. */
export async function readSentCopy(row: { content: Uint8Array | null; blobPathname: string | null }) {
  if (row.content) return chunked(row.content);
  if (!row.blobPathname) return null;
  const found = await get(row.blobPathname, { access: "private", token: blobToken() });
  return found?.stream ?? null;
}

export function sentCopyResponse(body: ReadableStream<Uint8Array>, fileName: string) {
  return new Response(body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName.replace(/["\r\n]/g, "")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
