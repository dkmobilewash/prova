import { describe, expect, it } from "vitest";
import {
  INTAKE_MAX_FILES,
  INTAKE_MAX_FILE_BYTES,
  intakeUploadPathname,
  isAllowedIntakeType,
  isIntakeBlobUrl,
  isIntakePathname,
} from "./upload";

/**
 * The upload policy for the intake tray.
 *
 * Every rule here is the job-media rule with the company in the place of
 * the job, and it is a security boundary rather than tidy filing: the blob
 * store is ONE store shared by every tenant, `recordIntakeDocument` is a
 * Server Action any signed-in caller can post to directly, and the URL it
 * records is the one the review screen later renders and offers as a link.
 * lib/job-media.ts carries the full account of what that cost the first
 * time; this file is the same three enforcement points for a different
 * prefix.
 */

const COMPANY = "cmp_0123abc";
const OTHER = "cmp_0123abcXYZ";

describe("what may be uploaded", () => {
  it("takes the paperwork a GC actually sends", () => {
    expect(isAllowedIntakeType("application/pdf")).toBe(true);
    expect(isAllowedIntakeType("image/jpeg")).toBe(true);
    expect(
      isAllowedIntakeType(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ),
    ).toBe(true);
  });

  it("refuses anything else, including a browser that would not say", () => {
    expect(isAllowedIntakeType("application/x-msdownload")).toBe(false);
    expect(isAllowedIntakeType("")).toBe(false);
  });

  it("caps the count and the size at numbers the UI can state", () => {
    // Both are shown on the drop zone. A cap nobody is told about is a
    // silent failure at the limit, which is the thing the brief for this
    // screen calls out by name.
    expect(INTAKE_MAX_FILES).toBeGreaterThanOrEqual(80);
    expect(INTAKE_MAX_FILE_BYTES).toBe(25 * 1024 * 1024);
  });
});

describe("where an intake file is allowed to live", () => {
  it("puts it under this company's own folder", () => {
    expect(intakeUploadPathname(COMPANY, "COI 2026.pdf")).toBe(
      `document-intake/${COMPANY}/COI-2026.pdf`,
    );
  });

  it("strips a path out of the filename rather than trusting it", () => {
    expect(intakeUploadPathname(COMPANY, "../../etc/passwd")).toBe(
      `document-intake/${COMPANY}/passwd`,
    );
  });

  it("refuses an id that is not one this app issued", () => {
    // An id carrying a slash would build a prefix that scopes nothing,
    // which is this function's entire job.
    expect(intakeUploadPathname("a/b", "x.pdf")).toBeNull();
  });

  it("accepts only one segment under the prefix", () => {
    expect(isIntakePathname(`document-intake/${COMPANY}/x.pdf`, COMPANY)).toBe(true);
    expect(isIntakePathname(`document-intake/${COMPANY}/nested/x.pdf`, COMPANY)).toBe(false);
    expect(isIntakePathname(`document-intake/${COMPANY}/..%2fx.pdf`, COMPANY)).toBe(false);
  });

  it("does not let one company's prefix match another's", () => {
    // The trailing slash is what stops `cmp_0123abc` matching a blob under
    // `cmp_0123abcXYZ/` — a different tenant whose id merely starts the
    // same way.
    expect(isIntakePathname(`document-intake/${OTHER}/x.pdf`, COMPANY)).toBe(false);
  });
});

describe("the URL that comes back", () => {
  const url = (path: string) => `https://store123.public.blob.vercel-storage.com/${path}`;

  it("accepts a store URL under this company's prefix", () => {
    expect(isIntakeBlobUrl(url(`document-intake/${COMPANY}/x-r4nd0m.pdf`), COMPANY)).toBe(true);
  });

  it("refuses another company's file in the same shared store", () => {
    expect(isIntakeBlobUrl(url(`document-intake/${OTHER}/x.pdf`), COMPANY)).toBe(false);
  });

  it("refuses a host that only looks like the store", () => {
    // Parsed, not pattern-matched: everything before the `@` is userinfo
    // and the real host is evil.test.
    expect(
      isIntakeBlobUrl(
        `https://store123.public.blob.vercel-storage.com@evil.test/document-intake/${COMPANY}/x.pdf`,
        COMPANY,
      ),
    ).toBe(false);
    expect(isIntakeBlobUrl(`http://evil.test/document-intake/${COMPANY}/x.pdf`, COMPANY)).toBe(
      false,
    );
  });

  it("refuses a double slash, which names a different blob key", () => {
    expect(isIntakeBlobUrl(url(`/document-intake/${COMPANY}/x.pdf`), COMPANY)).toBe(false);
  });
});
