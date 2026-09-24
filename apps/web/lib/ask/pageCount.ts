import { inflateSync } from "node:zlib";

/**
 * How many PAGES an attached file costs against the monthly allowance.
 *
 * WHY PAGES ARE A SEPARATE UNIT FROM QUESTIONS. A question is a question
 * whatever it says; an attached document is not. The whole file goes into
 * the request and is re-sent on every pass of the tool loop, so one 40-page
 * scanned bid package is the most expensive single thing this product can
 * do — tens of times an ordinary question. An allowance that counted it as
 * one question would be an allowance in name only, which is the defect this
 * module exists to close. See lib/ask/allowance.ts for the ledger it feeds.
 *
 * WHAT CAN AND CANNOT BE COUNTED, stated plainly because a rule nobody can
 * read is a rule nobody can argue with:
 *
 *   - **PDF** — counted for real. Page objects are found in the file's own
 *     bytes; if none are there, every Flate stream is inflated and searched
 *     again, which is where a modern PDF keeps them (PDF 1.5 object
 *     streams, what Word and Acrobat emit). No dependency: `node:zlib` is
 *     in the runtime already, and this repo cannot add one.
 *   - **PDF whose page tree cannot be read** — encrypted, damaged, or a
 *     compression this does not inflate. NOT KNOWABLE, and not pretended
 *     otherwise: it is charged a flat `uncountablePdfPages` and the person
 *     is TOLD, on screen, that it was charged that and why. Charging one
 *     would be the cheap silent answer and it is the wrong one — a file
 *     this app cannot read the size of is exactly the file most likely to
 *     be a big scan.
 *   - **A photo** (JPEG, PNG, WebP) — one page. It is one image block, one
 *     page's worth of the request, and there is nothing to count.
 *   - **Plain text and CSV** — not paginated at all, so there is no page to
 *     count and one has to be defined. `charsPerTextPage` characters make a
 *     page, rounded UP, minimum one. That number is a judgment call and is
 *     one constant to retune, exactly like the limits in usage.ts.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It never returns zero for a file that
 * exists: a file that reached the model cost something. And it never reads
 * the page count from anything the browser sent — the browser's `size` and
 * `contentType` are claims, and this counts the bytes that were actually
 * fetched from the store.
 *
 * WIRED TO COMPLIANCE EXTRACTION SINCE 2026-09-22, and this paragraph said
 * the opposite for a day. It read "NOT WIRED TO COMPLIANCE EXTRACTION YET
 * … it is the next caller to bring under the same ledger and it wants its
 * own PR", which was true when written and is the kind of sentence that
 * stops the next person looking. It got its own PR.
 * `uploadComplianceDocument` counts its document here and claims the pages
 * through lib/ask/documentSpend.ts, against the same `AskAllowancePeriod`
 * row the Ask box claims against — one ledger, two surfaces. The one thing
 * that path adds and this module does not know about is a ceiling on a
 * SINGLE document, which is documentSpend.ts's and is derived from the
 * allowance rather than typed out again.
 */

export const ASK_PAGE_RULES = {
  /** Characters of plain text or CSV that make one page. About a full
   * page of typed text; a CSV of a few hundred rows lands around three. */
  charsPerTextPage: 3000,
  /**
   * What a PDF costs when its page count cannot be read at all.
   *
   * A FIXED, VISIBLE NUMBER RATHER THAN A FORMULA OVER THE FILE SIZE. A
   * size formula would invent a precision this app does not have — bytes
   * per page differ by two orders of magnitude between a generated
   * one-pager and a scan — and would be impossible to explain to the
   * person being charged. Ten is above what an unreadable PDF usually
   * turns out to be and far below the worst case the 10 MB attachment cap
   * allows, and it is one constant to retune.
   */
  uncountablePdfPages: 10,
} as const;

/** Which rule produced the figure. Carried rather than re-derived so the
 * sentence shown to the person and the number charged cannot disagree. */
export type PageBasis = "pdf" | "pdf-uncountable" | "image" | "text";

export type PageCharge = { pages: number; basis: PageBasis };

/** `/Type /Page` but never `/Type /Pages`: the page-tree NODE is not a
 * page, and one name is a prefix of the other. Whitespace between the key
 * and its value is arbitrary in PDF, hence `\s*`. */
const PAGE_OBJECT = /\/Type\s*\/Page(?![A-Za-z0-9])/g;

/** `stream` ... `endstream`, the only thing in a PDF that can hide a page
 * object from a plain scan. Non-greedy, and `[\s\S]` because the payload is
 * binary and contains every byte including newlines. */
const STREAM_BODY = /stream\r?\n([\s\S]*?)endstream/g;

function markerCount(text: string): number {
  return (text.match(PAGE_OBJECT) ?? []).length;
}

/**
 * How many pages a PDF has, or null when its page tree cannot be read.
 *
 * TWO PASSES, NEVER SUMMED. A PDF keeps its page objects either in the file
 * body (a classic cross-reference table) or inside compressed object
 * streams (PDF 1.5 and later) — not both. So the body is searched first and
 * its answer taken if it has one; only a body with no page objects at all
 * falls through to inflating. Summing the two would double-count a file
 * that happens to carry another PDF inside it as an attachment.
 *
 * `latin1` rather than `utf8`: the file is binary, and utf8 decoding
 * replaces invalid sequences, which can eat the bytes of a marker that
 * happens to sit next to image data. latin1 is a byte-for-byte mapping and
 * cannot.
 */
export function pdfPageCount(bytes: Buffer): number | null {
  const body = bytes.toString("latin1");
  const inBody = markerCount(body);
  if (inBody > 0) return inBody;

  let inStreams = 0;
  for (const match of body.matchAll(STREAM_BODY)) {
    const payload = match[1];
    let inflated: Buffer;
    try {
      inflated = inflateSync(Buffer.from(payload, "latin1"));
    } catch {
      // Not Flate, or not a whole stream. An image, a font, a content
      // stream in another filter: none of them hold page objects, so
      // skipping is the correct outcome rather than a swallowed failure.
      continue;
    }
    inStreams += markerCount(inflated.toString("latin1"));
  }
  return inStreams > 0 ? inStreams : null;
}

/**
 * What one attached file costs in pages, from the bytes that were actually
 * fetched — never from anything the browser claimed.
 *
 * The content type is the store's, decided in `loadAskAttachment` before
 * this is called. An unrecognised type cannot reach here (the attachment is
 * refused first), and if one ever does it is charged one page rather than
 * zero: a file that reached the model cost something.
 */
export function attachmentPageCharge(contentType: string, bytes: Buffer): PageCharge {
  switch (contentType) {
    case "application/pdf": {
      const counted = pdfPageCount(bytes);
      return counted === null
        ? { pages: ASK_PAGE_RULES.uncountablePdfPages, basis: "pdf-uncountable" }
        : { pages: counted, basis: "pdf" };
    }
    case "image/jpeg":
    case "image/png":
    case "image/webp":
      return { pages: 1, basis: "image" };
    case "text/plain":
    case "text/csv": {
      const chars = bytes.toString("utf8").length;
      return { pages: Math.max(1, Math.ceil(chars / ASK_PAGE_RULES.charsPerTextPage)), basis: "text" };
    }
    default:
      return { pages: 1, basis: "image" };
  }
}

/** The clause a person reads about what their file cost. Only the
 * uncountable case needs explaining; the rest is just a number. */
export function pageChargeNote(charge: PageCharge): string {
  const pages = `${charge.pages} ${charge.pages === 1 ? "page" : "pages"}`;
  if (charge.basis === "pdf-uncountable") {
    return `${pages} (this PDF's page count couldn't be read, so it is charged as ${ASK_PAGE_RULES.uncountablePdfPages})`;
  }
  return pages;
}
