import type { AskAttachmentBlock } from "@prova/integrations";
import type { BlobCredentialEnv } from "@/lib/blob-urls";
import { askAttachmentRefusal, askAttachmentTypeOrSizeProblem, ASK_ATTACHMENT_MAX_BYTES, type AskAttachmentRef } from "./attachment";
import { attachmentPageCharge, type PageCharge } from "./pageCount";

/**
 * Fetching an attached file and turning it into a model block — the
 * SERVER-ONLY half of lib/ask/attachment.ts.
 *
 * SPLIT OUT BECAUSE `attachment.ts` IS ALSO CLIENT CODE, and the build is
 * the only check that says so. `components/AskPanel.tsx` imports that
 * module for the accept list and the refusal sentence it shows before an
 * upload starts, so everything in it is bundled for the browser. Counting a
 * PDF's pages needs `node:zlib`; webpack cannot resolve a node builtin for
 * the browser and the whole build fails with an import trace that ends at
 * AskPanel. `typecheck` and `lint` were both green — this repo's own rule
 * about a passing build being necessary and nowhere near sufficient,
 * arriving from the other direction for once.
 *
 * So the line is: `attachment.ts` holds the POLICY both sides need, and
 * this file holds the part that touches bytes and the network. Nothing the
 * browser imports reaches here.
 */

export type LoadedAttachment =
  /**
   * `charge` rides back with the block because THIS is the only place the
   * fetched bytes exist. The block carries base64 and text, not bytes, so
   * counting the pages anywhere later would mean decoding a 10 MB file a
   * second time to answer a question that was already answerable here —
   * and counting them from the browser's declared `size` instead would be
   * metering a customer's paid allowance off a number the browser chose.
   */
  | { ok: true; block: AskAttachmentBlock; charge: PageCharge }
  | { ok: false; error: string };

/**
 * Fetches a verified reference and turns it into a model block.
 *
 * The declared size and type are the browser's claims. The fetched bytes
 * are measured again, and the store's own content type is what decides the
 * block: a file uploaded as a PDF is refused by the store if it is not one
 * (the signed token carries the type), so the header here is the store's
 * word, not the browser's.
 */
export async function loadAskAttachment(
  ref: AskAttachmentRef,
  companyId: string,
  env: BlobCredentialEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<LoadedAttachment> {
  const refused = askAttachmentRefusal(ref, companyId, env);
  if (refused) return { ok: false, error: refused };

  let response: Response;
  try {
    response = await fetchImpl(ref.url, { cache: "no-store" });
  } catch {
    return { ok: false, error: "The attached file couldn't be read. Attach it again." };
  }
  if (!response.ok) return { ok: false, error: "The attached file couldn't be read. Attach it again." };

  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > ASK_ATTACHMENT_MAX_BYTES) {
    return { ok: false, error: askAttachmentTypeOrSizeProblem(ref.contentType, declaredLength) ?? "That file is too large." };
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const sizeProblem = askAttachmentTypeOrSizeProblem(ref.contentType, bytes.length);
  if (sizeProblem) return { ok: false, error: sizeProblem };

  const storeType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  // The store's word over the browser's where the store gave one.
  const contentType = storeType || ref.contentType;

  const fileName = ref.name;
  // Counted from the STORE'S content type and the bytes actually fetched,
  // on the same line as the decision about which block to build, so the two
  // can never describe different files.
  const charge = attachmentPageCharge(contentType, bytes);
  switch (contentType) {
    case "application/pdf":
      return { ok: true, charge, block: { kind: "pdf", fileName, base64: bytes.toString("base64") } };
    case "image/jpeg":
    case "image/png":
    case "image/webp":
      return { ok: true, charge, block: { kind: "image", fileName, mediaType: contentType, base64: bytes.toString("base64") } };
    case "text/plain":
    case "text/csv":
      return { ok: true, charge, block: { kind: "text", fileName, text: bytes.toString("utf8") } };
    default:
      return { ok: false, error: askAttachmentTypeOrSizeProblem(contentType, bytes.length) ?? "That file type can't be read." };
  }
}
