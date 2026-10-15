import { describe, expect, it } from "vitest";
import {
  RFQ_SOURCE_PURPOSE,
  attachable,
  attachmentsFit,
  rfqBody,
  rfqRecipient,
  rfqSubject,
  type RfqDocument,
} from "./rfq";
import { PROVIDER_MAX_MESSAGE_BYTES } from "./bid-submission";

/**
 * SENDING A SUPPLIER THE PAGES THEY NEED TO PRICE.
 *
 * The app recorded that a request was made and sent nothing — the two delete
 * confirmations on that screen still say "Nothing is sent to them." Every case
 * here is a decision about what may go out and to whom; the I/O ordering is
 * `actions/bidSubmission.test.ts`'s, since both sends call one `deliverEmail`.
 */

const spec = (over: Partial<RfqDocument> = {}): RfqDocument => ({
  id: "s1",
  kind: "SPEC_SECTION",
  label: "09 21 16",
  fileUrl: "https://store.public.blob.vercel-storage.com/bid-spec-sections/co_1/s.pdf",
  fileName: "09-21-16.pdf",
  ...over,
});

describe("which documents can be sent", () => {
  it("OFFERS ONLY THE ONES THAT HAVE A FILE", () => {
    // A section logged without its PDF is the normal case, not an error:
    // "logging that section 09 21 16 is in this bid's book is useful before
    // anybody has the file". So this filters rather than refuses.
    const offered = attachable([
      spec(),
      spec({ id: "s2", fileUrl: null }),
      spec({ id: "s3", fileUrl: "   " }),
      spec({ id: "a1", kind: "ADDENDUM", label: "Addendum 2" }),
    ]);
    expect(offered.map((one) => one.id)).toEqual(["s1", "a1"]);
  });

  it("sends each kind to its OWN upload purpose for checking", () => {
    // `documentUrlProblem` proves a file sits under that purpose's folder for
    // this company. Handing it the wrong purpose would check the wrong folder
    // and pass a file from somewhere else.
    expect(RFQ_SOURCE_PURPOSE.SPEC_SECTION).toBe("bid-spec-section");
    expect(RFQ_SOURCE_PURPOSE.ADDENDUM).toBe("bid-addendum");
    expect(Object.keys(RFQ_SOURCE_PURPOSE)).toHaveLength(2);
  });
});

describe("whether they fit in one email", () => {
  it("passes an ordinary set", () => {
    expect(attachmentsFit([1_000_000, 2_000_000])).toEqual({ ok: true });
  });

  it("CHECKS THE TOTAL, which is the whole reason this is not the package's check", () => {
    // A bid package is one attachment the upload ceiling already bounds. An RFQ
    // is as many documents as somebody ticks, each of which passed its own
    // upload check separately. Four legitimate files, one impossible email.
    const justUnder = Math.floor((PROVIDER_MAX_MESSAGE_BYTES / 4) * 3) - 1024;
    expect(attachmentsFit([justUnder]).ok).toBe(true);
    expect(attachmentsFit([justUnder / 2, justUnder / 2, justUnder / 2]).ok).toBe(false);
  });

  it("NAMES THE FIGURE AND WHAT TO DO, not just 'too big'", () => {
    // "Too big" sends somebody to untick things at random.
    const verdict = attachmentsFit([PROVIDER_MAX_MESSAGE_BYTES]);
    expect(verdict.ok).toBe(false);
    expect(!verdict.ok && verdict.problem).toMatch(/MB/);
    expect(!verdict.ok && verdict.problem).toMatch(/two requests/i);
  });

  it("an empty set fits", () => {
    // A request with no attachments is legitimate — a supplier who already has
    // the drawings just needs asking.
    expect(attachmentsFit([])).toEqual({ ok: true });
  });
});

describe("who a request may be sent to", () => {
  it("uses the vendor's own address, and the contact's name when there is one", () => {
    expect(
      rfqRecipient({
        quotedVendorName: "Alpha Supply",
        vendor: { name: "Alpha Supply", contactName: "Jo Patel", email: "jo@alpha.test" },
      }),
    ).toEqual({ ok: true, address: "jo@alpha.test", name: "Jo Patel" });
  });

  it("falls back to the company's name when nobody is named", () => {
    expect(
      rfqRecipient({
        quotedVendorName: "Alpha Supply",
        vendor: { name: "Alpha Supply", contactName: null, email: "sales@alpha.test" },
      }),
    ).toMatchObject({ ok: true, name: "Alpha Supply" });
  });

  it("REFUSES A QUOTE THAT NAMES NO RECORDED VENDOR, which is a real state", () => {
    // `BidQuote.vendorId` is nullable and `vendorName` is free text, because a
    // price can arrive from somebody nobody has set up. That request can be
    // recorded; it cannot be sent.
    const refusal = rfqRecipient({ quotedVendorName: "Somebody's Cousin", vendor: null });
    expect(refusal.ok).toBe(false);
    expect(!refusal.ok && refusal.problem).toContain("Somebody's Cousin");
    expect(!refusal.ok && refusal.problem).toMatch(/vendor list/i);
  });

  it("tells a missing address apart from a broken one", () => {
    const missing = rfqRecipient({
      quotedVendorName: "Alpha",
      vendor: { name: "Alpha Supply", contactName: null, email: null },
    });
    expect(!missing.ok && missing.problem).toMatch(/no email address on file/i);

    const broken = rfqRecipient({
      quotedVendorName: "Alpha",
      vendor: { name: "Alpha Supply", contactName: null, email: "alpha at test" },
    });
    expect(!broken.ok && broken.problem).toMatch(/doesn't look like an address/i);
  });
});

describe("what the supplier reads", () => {
  it("LEADS THE SUBJECT WITH THE PACKAGE, which is what they sort by", () => {
    expect(rfqSubject("Metal stud framing", "West Herr Jaguar").startsWith("Metal stud framing")).toBe(
      true,
    );
  });

  it("ASKS FOR THE EXCLUSIONS, which is what makes quotes comparable at all", () => {
    // `bid-levelling.ts` can only name what the cheapest quote excludes if
    // somebody wrote the exclusions down. Asking is the cheapest way to get
    // them, and it is the sentence an estimator retypes every time.
    const body = rfqBody({
      packageLabel: "Metal stud framing",
      projectName: "West Herr Jaguar",
      companyName: "Cyrus Drywall",
      dueBy: null,
      documents: [],
    });
    expect(body).toMatch(/excluding/i);
    expect(body).toMatch(/freight/i);
    expect(body).toMatch(/lead time/i);
  });

  it("names the attachments it is sending", () => {
    const body = rfqBody({
      packageLabel: "EIFS",
      projectName: "West Herr Jaguar",
      companyName: "Cyrus Drywall",
      dueBy: null,
      documents: ["09 21 16", "Addendum 2"],
    });
    expect(body).toContain("09 21 16, Addendum 2");
  });

  it("INVENTS NO DEADLINE when the request has none", () => {
    // A supplier who meets a date nobody needed has been rushed for nothing,
    // and one who misses an invented one reads as late.
    const without = rfqBody({
      packageLabel: "EIFS",
      projectName: "P",
      companyName: "C",
      dueBy: null,
      documents: [],
    });
    expect(without).not.toMatch(/need it back/i);

    const withDate = rfqBody({
      packageLabel: "EIFS",
      projectName: "P",
      companyName: "C",
      dueBy: "2026-10-20",
      documents: [],
    });
    expect(withDate).toContain("2026-10-20");
  });
});
