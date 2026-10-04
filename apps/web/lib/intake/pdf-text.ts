/**
 * THE FIRST PAGE'S TEXT, READ IN THE BROWSER, SO THE FREE CLASSIFIER CAN SEE IT.
 *
 * WHY THIS FILE EXISTS. `lib/intake/classify.ts` has a fully built
 * text-evidence path — it matches "Certificate of Liability Insurance",
 * "Application and Certificate for Payment", "IN WITNESS WHEREOF", a
 * `Project:` job hint, and more, quoting the fragment it matched as its
 * reason. It takes that text as `textPreview`, and until this file existed
 * NOTHING IN THE REPO EVER SET IT. Four references: the action reading it off
 * a FormData, the email path passing `null`, and two lines inside the
 * classifier consuming it. No producer anywhere. The detectors were dead on
 * every live path, and `scan_0042.pdf` was UNKNOWN forever.
 *
 * That is this repo's "written, documented, and never called" shape wearing a
 * form field, and the accompanying census (`textPreviewCensus.test.ts`) is
 * what stops it happening again — the tests for `classify.ts` pass
 * `textPreview` directly, so they were green the whole time and could never
 * have caught it.
 *
 * WHY IT IS WORTH DOING AT ALL, and the reason is money rather than accuracy.
 * The classifier is FREE — pure regex, no model call, no database. It is the
 * triage layer that decides which documents are worth spending a real read
 * on, and a whole-document read is costed in-repo at $2.25–$4.50 against a
 * 300-page monthly allowance (`packages/integrations/src/anthropic.ts`,
 * `lib/ask/documentSpend.ts`). Every point of accuracy this layer gains is a
 * paid read not spent.
 *
 * WHY THE BROWSER. The server has no PDF library — `lib/plan-ingest/stages.ts`
 * says so outright, and `pdfjs-dist` appears in this app only inside
 * `components/TakeoffPlanViewer.tsx`, which is a client component. This
 * module is the second browser-side use of the same already-installed
 * dependency and the same dynamic import, so it adds no package and shares
 * the chunk.
 *
 * WHY NOT THE EMAIL PATH. `lib/intake/inbound.ts` passes `textPreview: null`
 * deliberately and says why: extracting text from an arbitrary emailed file
 * is "parser attack surface a webhook has no business opening". That
 * judgement is untouched here. A dropped file is a file a signed-in person
 * chose, opened in their own browser, in their own tab — a different
 * exposure from a webhook opening whatever arrives. The email path stays on
 * filenames until somebody decides otherwise on purpose.
 *
 * WHAT THIS IS NOT. It is not OCR and it is not a model. A scanned page has
 * no text layer and comes back null, which is the same answer as before and
 * the correct one: `classify.ts`'s own header says `scan_0042.pdf` being
 * UNKNOWN/LOW *is* the right answer when there is nothing to go on.
 */

/**
 * The cap, and it is generous rather than tight on purpose. Every phrase the
 * detectors look for is in a document's first screenful — a form title, a
 * header block, a `Project:` line. 4,000 characters is roughly two pages of
 * dense text, so a title block pushed down by a letterhead still lands inside
 * it, while a 200-page drawing set cannot turn into a 40 MB string.
 */
export const TEXT_PREVIEW_MAX_CHARS = 4000;

/**
 * A PDF that takes longer than this to yield one page is abandoned and the
 * upload proceeds without a preview. This runs BEFORE the upload, so it is
 * latency the person waits through; a malformed or enormous file must not be
 * able to hold their drop open. Failing here costs exactly what existed
 * before this file: a filename-only classification.
 */
export const TEXT_PREVIEW_TIMEOUT_MS = 4000;

/** What `classify.ts` documents its input as: text where available, null for
 * images. Anything that is not a PDF has no text layer to read. */
function hasTextLayer(contentType: string): boolean {
  return contentType === "application/pdf";
}

/** pdfjs returns text items and marked-content items in one array; only the
 * former carry a string. Duck-typed rather than imported, because the type
 * lives at a deep path inside the package that has moved between versions. */
function stringOf(item: unknown): string | null {
  if (typeof item !== "object" || item === null) return null;
  const { str } = item as { str?: unknown };
  return typeof str === "string" ? str : null;
}

async function readFirstPage(file: File): Promise<string | null> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.mjs",
    import.meta.url,
  ).toString();

  // `data` rather than `url`: the file is in memory and has not been uploaded
  // yet, which is the whole point — the preview has to travel WITH the upload
  // in the same FormData, not be fetched back afterwards.
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    // Served by this app already, for the viewer. Text extraction does not
    // rasterise glyphs, but a document with an embedded standard font still
    // resolves its character map through this.
    standardFontDataUrl: "/pdfjs/standard_fonts/",
  }).promise;

  try {
    if (doc.numPages < 1) return null;
    const page = await doc.getPage(1);
    const content = await page.getTextContent();
    const parts: string[] = [];
    let length = 0;
    for (const item of content.items) {
      const str = stringOf(item);
      if (str === null) continue;
      parts.push(str);
      length += str.length + 1;
      if (length >= TEXT_PREVIEW_MAX_CHARS) break;
    }
    // Single-spaced: pdfjs emits a run per positioned text fragment, so a
    // heading set in tracked-out capitals arrives as many items. Joining on a
    // space and collapsing runs is what makes "CERTIFICATE OF LIABILITY
    // INSURANCE" match as a phrase rather than as a column of letters.
    const text = parts.join(" ").replace(/\s+/g, " ").trim();
    return text.length > 0 ? text.slice(0, TEXT_PREVIEW_MAX_CHARS) : null;
  } finally {
    // The worker is a real thread. Left undestroyed, dropping forty files
    // leaves forty of them alive for the life of the tab.
    await doc.destroy().catch(() => {});
  }
}

/**
 * The first page's text, or null — and null is a first-class answer, not a
 * failure to report. Never throws: every caller is on the upload path, where
 * the document still has to be filed whatever came back. A null preview is
 * exactly the behaviour this app had before this module existed.
 */
export async function firstPageTextPreview(file: File): Promise<string | null> {
  if (!hasTextLayer(file.type)) return null;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      readFirstPage(file),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), TEXT_PREVIEW_TIMEOUT_MS);
      }),
    ]);
  } catch {
    // Password-protected, corrupt, or a PDF pdfjs will not open. The row is
    // still created; it is classified on its filename, as everything was
    // until now. Deliberately silent: this is an expected outcome on a
    // person's own drop, not an error worth a console line per file.
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
