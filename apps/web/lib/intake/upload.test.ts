import { describe, expect, it } from "vitest";
import {
  INTAKE_MAX_FILES,
  INTAKE_MAX_FILE_BYTES,
  intakeFileName,
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

describe("a dropped folder repeats filenames, and the UI must survive it", () => {
  /**
   * NOT a hypothetical. `IntakeDropZone` walks a dropped folder recursively,
   * so `A/COI.pdf` and `B/COI.pdf` both arrive as a File named "COI.pdf" —
   * and that is the ORDINARY shape of a GC's transmittal folder, where each
   * job or package is a subfolder using the same handful of document names.
   *
   * The failure list keyed its rows on `file.name`. Two React children with
   * the same key in one list is not a warning to wave through: React
   * reconciles by key, so the second row can inherit the first's DOM and
   * render the wrong file's failure — on the one list whose entire job is
   * naming the files that did NOT make it.
   *
   * This asserts the PROPERTY that makes the fix work rather than the fix:
   * the sanitised store pathname is not unique per file either, so nothing
   * derived from the name can be the key. The component keys on the file's
   * index within the drop.
   */
  it("gives two same-named files in different subfolders the same pathname", () => {
    const companyId = "cmp_1234567890";
    const a = intakeUploadPathname(companyId, "COI.pdf");
    const b = intakeUploadPathname(companyId, "COI.pdf");
    expect(a).not.toBeNull();
    expect(a).toBe(b);
  });

  it("sanitises two different names to the same thing, which is the same hazard", () => {
    // The name is sanitised before it is a pathname, so names that differ in
    // the browser can collide here: another reason a name cannot be a key.
    expect(intakeFileName("pay app (1).pdf")).toBe(intakeFileName("pay app  1 .pdf"));
  });
});
