import { describe, expect, it } from "vitest";
import {
  INTAKE_MAX_FILES,
  INTAKE_MAX_FILE_BYTES,
  displayFileName,
  intakeFileName,
  intakeUploadPathname,
  isAllowedIntakeType,
  isIntakeBlobUrl,
  isIntakePathname,
} from "./upload";
import { jobNameMatchesHint, soleJobForHint } from "./review";

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

describe("the name a person sees, versus the name a store gets", () => {
  /* These were the same function until 2026-09-14 and that cost real
     accuracy, not just looks. `intakeFileName` builds a STORE PATH, so it
     replaces every run of non-[A-Za-z0-9._-] with a hyphen. Running it on
     the DISPLAY name showed people a mangled filename — and, because the
     same string was handed to the classifier, removed the apostrophe and
     space that the compliance pattern needs. A file that reads HIGH on its
     real name came back MEDIUM through the upload path. Found by uploading
     three real files. */
  it("keeps the characters a person would recognise", () => {
    expect(displayFileName("Nevada contractor's license C-4.pdf")).toBe(
      "Nevada contractor's license C-4.pdf",
    );
    expect(displayFileName("Riverside COI 2027.pdf")).toBe("Riverside COI 2027.pdf");
  });

  it("still differs from the path sanitiser, which must keep mangling", () => {
    // The control: if these two ever agree on this input, one of them has
    // been changed into the other and the bug is back.
    const real = "Nevada contractor's license C-4.pdf";
    expect(intakeFileName(real)).not.toBe(displayFileName(real));
    expect(intakeFileName(real)).toBe("Nevada-contractor-s-license-C-4.pdf");
  });

  it("takes the leaf of a dropped folder's path, and bounds what it shows", () => {
    expect(displayFileName("Riverside/COI.pdf")).toBe("COI.pdf");
    expect(displayFileName("a\\\\b\\\\COI.pdf")).toBe("COI.pdf");
    expect(displayFileName("  spaced   out .pdf ")).toBe("spaced out .pdf");
    expect(displayFileName("")).toBe("document");
    expect(displayFileName("x".repeat(500)).length).toBeLessThanOrEqual(200);
  });
});

describe("a filename hint against a real job name", () => {
  /* One rule, three callers — the tray summary, the action's jobFromHint,
     and the table's "not a job here" line. They were three different rules
     and all three used equality, so a short hint never matched a long job
     name and the table contradicted its own dropdown. */
  const JOBS = [
    { id: "j1", name: "Riverside Medical Office Building [demo]" },
    { id: "j2", name: "Cedar Park Elementary [demo]" },
  ];

  it("matches the short hint a filename carries", () => {
    expect(jobNameMatchesHint("Riverside Medical Office Building [demo]", "Riverside")).toBe(true);
    expect(soleJobForHint(JOBS, "Riverside")?.id).toBe("j1");
    expect(soleJobForHint(JOBS, "Cedar Park")?.id).toBe("j2");
  });

  it("stops at a word boundary", () => {
    expect(jobNameMatchesHint("Riverside Medical Office Building", "River")).toBe(false);
    expect(soleJobForHint(JOBS, "River")).toBeNull();
  });

  it("refuses an ambiguous hint rather than guessing one", () => {
    // Blank when ambiguous: the filename does not say which, so pre-filling
    // one for a person to rubber-stamp is worse than leaving it to them.
    const two = [
      { id: "a", name: "Riverside Medical" },
      { id: "b", name: "Riverside Retail" },
    ];
    expect(two.filter((j) => jobNameMatchesHint(j.name, "Riverside"))).toHaveLength(2);
    expect(soleJobForHint(two, "Riverside")).toBeNull();
  });

  it("returns null for no hint and for no match", () => {
    expect(soleJobForHint(JOBS, null)).toBeNull();
    expect(soleJobForHint(JOBS, "Oakmont")).toBeNull();
  });
});
