import { looksLikeEmail } from "@prova/integrations";
import { PROVIDER_MAX_MESSAGE_BYTES, base64Bytes } from "./bid-submission";

/**
 * THE REQUEST FOR QUOTE — sending a supplier the pages they need to price.
 *
 * Step 5 of the estimating workflow reads "package specific schedule pages and
 * specs into a request for quote for key vendors". The app recorded the
 * CONVERSATION — `requestedOn`, `dueBy`, who declined, who is overdue — and
 * sent nothing. The two delete confirmations on that screen say so out loud:
 * *"Nothing is sent to them."*
 *
 * So an estimator exported the spec section, opened their mail client, found
 * the vendor's address, attached it, wrote the same sentence they write every
 * time, sent it, came back and typed the date into C Stream. This is the last
 * of the three sub-tasks the workflow audit found missing.
 *
 * ── IT REUSES THE BID SUBMISSION'S MACHINERY ON PURPOSE ──
 *
 * `deliverEmail` learned attachments for #787 and keeps the write ordering
 * that cost this repo a DATA-LOST bug to get right; `bid-submission.ts` worked
 * out what fits in one message. An RFQ is the same send at lower stakes, so it
 * is the same code with a different recipient rule — not a second
 * implementation that drifts from it.
 *
 * ── AND IT NEEDS NO UPLOAD AT ALL, UNLIKE THE BID PACKAGE ──
 *
 * A bid package is merged in the browser, so its bytes have to transit the
 * blob store and are deleted afterwards. The documents an RFQ carries are
 * ALREADY STORED and are permanent records: `BidSpecSection.fileUrl` and
 * `BidAddendum.fileUrl`, uploaded when the estimator logged them. The server
 * reads them back where they already live. Nothing is uploaded, so nothing has
 * to be cleaned up.
 *
 * Pure. The action does the I/O.
 */

/** Where an attachable document came from. Its `purpose` is what
 *  `documentUrlProblem` is given, and the two are not interchangeable: the
 *  check proves the file sits under THAT purpose's folder for this company. */
export type RfqSourceKind = "SPEC_SECTION" | "ADDENDUM";

export const RFQ_SOURCE_PURPOSE: Record<RfqSourceKind, "bid-spec-section" | "bid-addendum"> = {
  SPEC_SECTION: "bid-spec-section",
  ADDENDUM: "bid-addendum",
};

export type RfqDocument = {
  id: string;
  kind: RfqSourceKind;
  /** What the estimator calls it on screen — "09 21 16" or "Addendum 2". */
  label: string;
  fileUrl: string | null;
  fileName: string | null;
};

/**
 * Which of a bid's documents can actually be sent.
 *
 * A SPEC SECTION WITHOUT A FILE IS THE NORMAL CASE, not an error.
 * `bid-specs.prisma` says so: *"Both nullable: logging that section 09 21 16 is
 * in this bid's book is useful before anybody has the file."* The same is true
 * of an addendum a GC announced in an email. So this filters rather than
 * refuses, and the screen offers what it returns.
 */
export function attachable(documents: readonly RfqDocument[]): RfqDocument[] {
  return documents.filter((one) => (one.fileUrl?.trim().length ?? 0) > 0);
}

export type FitVerdict =
  | { ok: true }
  | { ok: false; problem: string };

/**
 * Does this set of documents fit in one message?
 *
 * CHECKED ON THE TOTAL, not per file, and that is the whole reason this exists
 * separately from the bid package's version. A package is one attachment and
 * the upload ceiling already bounds it; an RFQ is as many documents as somebody
 * ticks, each of which passed its own upload check years apart. Four
 * ten-megabyte spec sections are four legitimate files and one impossible
 * email.
 *
 * REFUSES WITH THE FIGURE AND THE REMEDY. "Too big" sends somebody to delete
 * things at random; naming the total and telling them to send it in two says
 * what to do.
 */
export function attachmentsFit(sizes: readonly number[]): FitVerdict {
  const raw = sizes.reduce((total, size) => total + size, 0);
  const encoded = base64Bytes(raw);
  if (encoded <= PROVIDER_MAX_MESSAGE_BYTES) return { ok: true };
  return {
    ok: false,
    problem: `Those attachments come to ${megabytes(raw)} MB, which is more than one email can carry. Send them in two requests, or leave the largest one out and tell them where to get it.`,
  };
}

function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

/** Where a request can be sent, or why it cannot. */
export type RfqRecipient =
  | { ok: true; address: string; name: string }
  | { ok: false; problem: string };

/**
 * The supplier's address.
 *
 * ── `Vendor.email` HAS EXISTED ALL ALONG AND NOTHING HAS EVER READ IT ──
 *
 * The column is on the model, there is a form field behind it on `/vendors`,
 * and a grep for a query selecting it returns nothing: `/bids` asks for
 * `{ id, name }` and `BidLevelling`'s own prop type is `{ id, name }[]`. So
 * every supplier address a company has typed in has been write-only. That is
 * the "written, documented, and never called" shape pointed at a column.
 *
 * A VENDOR HAS ONE ADDRESS, unlike a GC. `ContactPerson` hangs off `Contact`
 * and gives the GC side named people; `Vendor` carries a single
 * `contactName`/`email` pair, so there is nothing to choose between and no
 * picker to build.
 *
 * REFUSES WHEN THE QUOTE NAMES NO RECORDED VENDOR, which is a real state:
 * `BidQuote.vendorId` is nullable and `vendorName` is free text, because a
 * price can arrive from somebody nobody has set up yet. That request can be
 * recorded; it cannot be sent, and the sentence says which.
 */
export function rfqRecipient(input: {
  quotedVendorName: string;
  vendor: { name: string; contactName: string | null; email: string | null } | null;
}): RfqRecipient {
  if (!input.vendor) {
    return {
      ok: false,
      problem: `${input.quotedVendorName} isn't on your vendor list yet. Add them on the Vendors page with an email address, then link this request to them.`,
    };
  }
  const address = input.vendor.email?.trim();
  if (!address) {
    return {
      ok: false,
      problem: `There's no email address on file for ${input.vendor.name}. Add one on the Vendors page, then send.`,
    };
  }
  if (!looksLikeEmail(address)) {
    return {
      ok: false,
      problem: `The email address on file for ${input.vendor.name} doesn't look like an address. Fix it on the Vendors page, then send.`,
    };
  }
  return { ok: true, address, name: input.vendor.contactName?.trim() || input.vendor.name };
}

/** The subject a supplier sees.
 *
 *  THE PACKAGE FIRST, because a supplier pricing four jobs this week sorts by
 *  what they are being asked to price, not by who asked. */
export function rfqSubject(packageLabel: string, projectName: string): string {
  return `${packageLabel} — quote request for ${projectName}`;
}

/**
 * The message.
 *
 * ── IT ASKS FOR THE THREE THINGS THAT MAKE QUOTES COMPARABLE ──
 *
 * `bid-levelling.ts` opens with the rule this whole area is built on: *"THE
 * POINT IS NOT 'WHO IS CHEAPEST'. IT IS 'ARE THEY BIDDING THE SAME THING'."*
 * Its `cautionFor` then names the exclusions the cheapest quote carries that
 * another does not — a comparison it can only make if the exclusions were
 * written down. Asking for them in the request is the cheapest possible way to
 * get them, and it is the one sentence an estimator retypes every time.
 *
 * The due date is included only when the request has one. An invented deadline
 * is worse than none: a supplier who meets a date nobody needed has been
 * rushed for nothing, and one who misses an invented one reads as late.
 */
export function rfqBody(input: {
  packageLabel: string;
  projectName: string;
  companyName: string;
  dueBy: string | null;
  documents: readonly string[];
}): string {
  const lines = [
    `We're bidding ${input.projectName} and would like a quote for ${input.packageLabel}.`,
    "",
  ];

  if (input.documents.length > 0) {
    lines.push(
      `Attached: ${input.documents.join(", ")}.`,
      "",
    );
  }

  lines.push(
    "Please include freight and tax, your lead time, and anything you're excluding — we level quotes on the exclusions, so a price with them written down is worth more to us than a lower one without.",
    "",
  );

  if (input.dueBy) lines.push(`We need it back by ${input.dueBy}.`, "");

  lines.push(input.companyName);
  return lines.join("\n");
}
