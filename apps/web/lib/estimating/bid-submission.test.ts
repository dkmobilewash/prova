import { describe, expect, it } from "vitest";
import {
  BIGGEST_UPLOAD_BASE64,
  PROVIDER_MAX_MESSAGE_BYTES,
  UPLOAD_CEILING_FITS_ONE_MESSAGE,
  base64Bytes,
  recipientFor,
  submissionBody,
  submissionSubject,
} from "./bid-submission";
import { DOCUMENT_UPLOAD_MAX_BYTES } from "@/lib/document-uploads";

/**
 * SENDING A BID PACKAGE TO A GENERAL CONTRACTOR.
 *
 * Every case here is about a decision rather than plumbing: who it may be
 * addressed to, and whether a file that uploaded can actually be mailed. The
 * I/O ordering lives in `actions/messages.test.ts`, which already holds the
 * #111 write-ordering tests this send reuses rather than re-implements.
 */

describe("a file that uploaded can still be mailed", () => {
  it("counts base64 exactly, not as 'about a third more'", () => {
    expect(base64Bytes(3)).toBe(4);
    expect(base64Bytes(1)).toBe(4); // padded to a whole quad
    expect(base64Bytes(6)).toBe(8);
    expect(base64Bytes(0)).toBe(0);
  });

  it("ASSERTS THE RELATIONSHIP INSTEAD OF A SECOND CEILING", () => {
    // ── WHY THERE IS NO `SEND_MAX_BYTES` ──
    //
    // The obvious design is a send-side constant. It would be a second list of
    // one value: the upload token already caps a `bid-package`, enforced at
    // token minting because five in-action guards once shipped unreachable
    // behind the 1 MB body cap. A rival number drifts, and the one that drifts
    // LOWER refuses a file the uploader just accepted.
    //
    // So what is pinned is that the upload ceiling's base64 form still fits one
    // message. Raise the upload cap past the provider's limit and this goes
    // red — at the moment somebody can act on it, rather than on the send that
    // bounces afterwards.
    expect(UPLOAD_CEILING_FITS_ONE_MESSAGE).toBe(true);
    expect(BIGGEST_UPLOAD_BASE64).toBe(base64Bytes(DOCUMENT_UPLOAD_MAX_BYTES));
    expect(BIGGEST_UPLOAD_BASE64).toBeLessThan(PROVIDER_MAX_MESSAGE_BYTES);
  });

  it("leaves real headroom, so the margin is a choice and not an accident", () => {
    // 15 MB uploaded is 20 MB encoded against a 40 MB message — half. Stated
    // as a ratio so a change that quietly eats the margin is visible here
    // rather than discovered by a bounce on bid day.
    expect(BIGGEST_UPLOAD_BASE64 / PROVIDER_MAX_MESSAGE_BYTES).toBeLessThan(0.75);
  });
});

describe("who a bid may be addressed to", () => {
  const gc = { contactName: "Turner Construction", contactEmail: "bids@turner.com" };

  it("PREFERS A NAMED PERSON over the company address", () => {
    // An estimator sends to the PM they have been dealing with, not to a
    // general inbox. `ContactPerson` exists for exactly that distinction.
    const choice = recipientFor({ ...gc, people: [{ name: "Dana Reyes", email: "dana@turner.com" }] });
    expect(choice).toMatchObject({
      ok: true,
      recipient: { address: "dana@turner.com", name: "Dana Reyes" },
    });
  });

  it("offers every other usable address as an alternative", () => {
    const choice = recipientFor({
      ...gc,
      people: [
        { name: "Dana Reyes", email: "dana@turner.com" },
        { name: "Sam Ortiz", email: "sam@turner.com" },
      ],
    });
    expect(choice.ok && choice.alternatives.map((one) => one.address)).toEqual([
      "sam@turner.com",
      "bids@turner.com",
    ]);
  });

  it("falls back to the company address when nobody is named", () => {
    expect(recipientFor({ ...gc, people: [] })).toMatchObject({
      ok: true,
      recipient: { address: "bids@turner.com", name: "Turner Construction" },
    });
  });

  it("skips a person with no address rather than offering a blank", () => {
    const choice = recipientFor({
      ...gc,
      people: [
        { name: "No Email", email: null },
        { name: "Blank", email: "   " },
        { name: "Dana Reyes", email: "dana@turner.com" },
      ],
    });
    expect(choice).toMatchObject({ ok: true, recipient: { address: "dana@turner.com" } });
    expect(choice.ok && choice.alternatives).toHaveLength(1);
  });

  it("counts one person listed twice as one recipient", () => {
    const choice = recipientFor({
      contactName: "Turner",
      contactEmail: "Dana@Turner.com",
      people: [{ name: "Dana Reyes", email: "dana@turner.com" }],
    });
    // Same address, different case. Offering it twice invites somebody to
    // wonder which of the two is the real one.
    expect(choice.ok && choice.alternatives).toEqual([]);
  });

  it("TELLS THE TWO FAILURES APART, because they are fixed differently", () => {
    const none = recipientFor({ contactName: "Turner", contactEmail: null, people: [] });
    expect(none).toMatchObject({ ok: false });
    expect(!none.ok && none.problem).toMatch(/no email address on file/i);

    const broken = recipientFor({ contactName: "Turner", contactEmail: "turner at com", people: [] });
    expect(broken).toMatchObject({ ok: false });
    expect(!broken.ok && broken.problem).toMatch(/doesn't look like an address/i);
  });

  it("names the GC in the refusal, so it says whose record to fix", () => {
    const none = recipientFor({ contactName: "Skanska", contactEmail: null, people: [] });
    expect(!none.ok && none.problem).toContain("Skanska");
  });
});

describe("what the GC sees before they open it", () => {
  it("LEADS THE SUBJECT WITH THE PROJECT, which is what they sort by", () => {
    // A GC taking bids on four jobs gets forty emails on bid day. Leading with
    // the sender makes four of them indistinguishable.
    const subject = submissionSubject("West Herr Jaguar", "Cyrus Drywall");
    expect(subject.startsWith("West Herr Jaguar")).toBe(true);
    expect(subject).toContain("Cyrus Drywall");
  });

  it("NAMES THE ATTACHMENT IN THE BODY, because the file itself is not kept", () => {
    // `OutboundMessage` stores what was sent as text. The filename in the body
    // is the only thing that makes the log answer "what did we send them".
    const body = submissionBody({
      projectName: "West Herr Jaguar",
      companyName: "Cyrus Drywall",
      fileName: "West-Herr-Jaguar-2026-10-14-143207-bid-package.pdf",
      pages: 5,
    });
    expect(body).toContain("West-Herr-Jaguar-2026-10-14-143207-bid-package.pdf");
    expect(body).toContain("5 pages");
    expect(body).toContain("West Herr Jaguar");
  });

  it("says one page as one page", () => {
    const body = submissionBody({
      projectName: "P",
      companyName: "C",
      fileName: "f.pdf",
      pages: 1,
    });
    expect(body).toContain("1 page.");
    expect(body).not.toContain("1 pages");
  });
});
