import { describe as group, expect, it } from "vitest";
import {
  DOCUMENT_UPLOAD_CONTENT_TYPES,
  DOCUMENT_UPLOAD_MAX_BYTES,
  DOCUMENT_UPLOAD_PURPOSES,
  DOCUMENT_UPLOAD_TARGETS,
  documentDisplayFileName,
  documentFileProblem,
  documentUploadErrorMessage,
  documentUploadFileName,
  documentUploadPathname,
  documentUploadPurpose,
  documentUrlProblem,
  isAllowedDocumentType,
  isDocumentBlobUrl,
  isDocumentUploadPathname,
} from "./document-uploads";

/**
 * The rules three places enforce — the token route, the five recording
 * actions, and the browser — decided here once so they cannot drift apart.
 *
 * The adversarial cases are the point. One Vercel Blob store serves every
 * tenant, so the folder in a pathname is the only thing that says whose
 * file a blob is, and the recorded URL is the one `deleteDocument` later
 * hands to `del()`.
 */

const OURS = "abc123xyz";
const ENV = { BLOB_READ_WRITE_TOKEN: `vercel_blob_rw_${OURS}_s3cr3t` };
const url = (store: string, path: string) =>
  `https://${store}.public.blob.vercel-storage.com/${path}`;

group("the six purposes and where each one lands", () => {
  it("gives every purpose a target, and no purpose is missing one", () => {
    // Guards the table itself: every assertion below reads through it, and
    // a table that quietly lost an entry would make them all vacuous.
    expect(Object.keys(DOCUMENT_UPLOAD_TARGETS).sort()).toEqual([...DOCUMENT_UPLOAD_PURPOSES].sort());
    expect(DOCUMENT_UPLOAD_PURPOSES).toHaveLength(6);
  });

  it("puts each kind in the folder its existing documents already live in", () => {
    // These prefixes are not a fresh choice — every document already
    // stored is under one of them, and changing one would strand it. The
    // exception is `plan-takeoff`, which is new and therefore strands
    // nothing; it gets its own folder rather than sharing one, so a drawing
    // somebody is measuring is never mistaken for a contract.
    expect(DOCUMENT_UPLOAD_TARGETS["dispatch-slip"].root).toBe("dispatch-slips");
    expect(DOCUMENT_UPLOAD_TARGETS["prevailing-wage"].root).toBe("prevailing-wage");
    expect(DOCUMENT_UPLOAD_TARGETS["contract-document"].root).toBe("contracts");
    expect(DOCUMENT_UPLOAD_TARGETS["executed-subcontract"].root).toBe("contracts");
    expect(DOCUMENT_UPLOAD_TARGETS["compliance-document"].root).toBe("compliance");
    expect(DOCUMENT_UPLOAD_TARGETS["plan-takeoff"].root).toBe("plan-takeoff");
  });

  it("shares the contracts folder between two purposes with DIFFERENT guards", () => {
    // The reason the table is keyed on purpose rather than on folder. If
    // these two ever agree, the key could be the folder — and until then a
    // folder-keyed route would have to refuse somebody one of the two
    // actions admits.
    expect(DOCUMENT_UPLOAD_TARGETS["contract-document"].root).toBe(
      DOCUMENT_UPLOAD_TARGETS["executed-subcontract"].root,
    );
    expect(DOCUMENT_UPLOAD_TARGETS["contract-document"].capability).toBeNull();
    expect(DOCUMENT_UPLOAD_TARGETS["executed-subcontract"].capability).toBe("MANAGE_JOBS");
  });

  it("scopes exactly one purpose to the company rather than to a job", () => {
    const companyScoped = DOCUMENT_UPLOAD_PURPOSES.filter(
      (p) => DOCUMENT_UPLOAD_TARGETS[p].scope === "company",
    );
    expect(companyScoped).toEqual(["compliance-document"]);
  });

  it("accepts only a purpose on the list, and refuses anything else", () => {
    expect(documentUploadPurpose("contract-document")).toBe("contract-document");
    expect(documentUploadPurpose("invoice-attachment")).toBeNull();
    expect(documentUploadPurpose("")).toBeNull();
    expect(documentUploadPurpose(null)).toBeNull();
    expect(documentUploadPurpose(42)).toBeNull();
    expect(documentUploadPurpose({ purpose: "contract-document" })).toBeNull();
  });
});

group("what may be uploaded, and how much of it", () => {
  it("accepts the four types every one of these five actions already accepted", () => {
    expect([...DOCUMENT_UPLOAD_CONTENT_TYPES]).toEqual([
      "application/pdf",
      "image/png",
      "image/jpeg",
      "image/webp",
    ]);
    for (const type of DOCUMENT_UPLOAD_CONTENT_TYPES) {
      expect(isAllowedDocumentType(type)).toBe(true);
    }
  });

  it("refuses everything else, including a HEIC a phone might offer", () => {
    expect(isAllowedDocumentType("image/heic")).toBe(false);
    expect(isAllowedDocumentType("application/x-msdownload")).toBe(false);
    expect(isAllowedDocumentType("")).toBe(false);
  });

  it("keeps the 15MB number the five deleted constants declared", () => {
    expect(DOCUMENT_UPLOAD_MAX_BYTES).toBe(15 * 1024 * 1024);
    // And it is above the framework cap that made it unreachable, which is
    // the whole of #27. If these two ever crossed, the feature would be
    // broken again and this says so.
    expect(DOCUMENT_UPLOAD_MAX_BYTES).toBeGreaterThan(1024 * 1024);
  });

  it("tells a person in the browser what is wrong before any bytes move", () => {
    expect(documentFileProblem({ type: "application/pdf", size: 5_000_000 })).toBeNull();
    expect(documentFileProblem({ type: "image/heic", size: 10 })).toContain("isn't supported");
    expect(documentFileProblem({ type: "application/pdf", size: 0 })).toContain("empty");
    const tooBig = documentFileProblem({
      type: "application/pdf",
      size: DOCUMENT_UPLOAD_MAX_BYTES + 1,
    });
    expect(tooBig).toContain("15.0 MB");
  });
});

group("where the browser is told to put a file", () => {
  it("builds <folder>/<owner>/<name>", () => {
    expect(documentUploadPathname("contract-document", "job_1", "subcontract.pdf")).toBe(
      "contracts/job_1/subcontract.pdf",
    );
    expect(documentUploadPathname("compliance-document", "cmp_1", "COI.pdf")).toBe(
      "compliance/cmp_1/COI.pdf",
    );
  });

  it("REFUSES an owner id that could not have come from this schema", () => {
    // An id carrying a slash would build a prefix that scopes nothing,
    // which is the one thing this function exists to do.
    expect(documentUploadPathname("contract-document", "job_1/../job_2", "x.pdf")).toBeNull();
    expect(documentUploadPathname("contract-document", "", "x.pdf")).toBeNull();
    expect(documentUploadPathname("contract-document", "a".repeat(65), "x.pdf")).toBeNull();
  });

  it("reduces a filename to something that cannot change the shape of the path", () => {
    expect(documentUploadFileName("../../etc/passwd")).toBe("passwd");
    expect(documentUploadFileName("my scan (1).pdf")).toBe("my-scan-1-.pdf");
    expect(documentUploadFileName("....pdf")).toBe("pdf");
    expect(documentUploadFileName("")).toBe("document");
    expect(documentUploadFileName("a".repeat(400)).length).toBeLessThanOrEqual(120);
  });

  it("produces a pathname its own checker accepts, for every awkward name", () => {
    // The two functions are used at opposite ends of an upload and a
    // disagreement between them would refuse a file AFTER it transferred.
    for (const name of ["../../etc/passwd", "my scan (1).pdf", "", "a".repeat(400), "%2e%2e.pdf"]) {
      const pathname = documentUploadPathname("dispatch-slip", "job_1", name) as string;
      expect(isDocumentUploadPathname(pathname, "dispatch-slip", "job_1"), name).toBe(true);
    }
  });
});

group("does this pathname belong to this record", () => {
  it("accepts one under the right folder and owner", () => {
    expect(isDocumentUploadPathname("contracts/job_1/x-r4nd0m.pdf", "contract-document", "job_1")).toBe(
      true,
    );
  });

  it("refuses an owner whose id merely STARTS with this one", () => {
    // Without the trailing slash in the prefix, job_1 would match a blob
    // under job_12 — a different company's job.
    expect(isDocumentUploadPathname("contracts/job_12/x.pdf", "contract-document", "job_1")).toBe(
      false,
    );
  });

  it("refuses a second path segment, so nothing climbs out of the folder", () => {
    expect(
      isDocumentUploadPathname("contracts/job_1/sub/x.pdf", "contract-document", "job_1"),
    ).toBe(false);
    expect(isDocumentUploadPathname("contracts/job_1/..", "contract-document", "job_1")).toBe(false);
  });

  it("refuses a percent-encoded separator, which URL parsing does not normalise", () => {
    expect(
      isDocumentUploadPathname("contracts/job_1/%2e%2e%2fx.pdf", "contract-document", "job_1"),
    ).toBe(false);
    expect(
      isDocumentUploadPathname("contracts/job_1/%2Fx.pdf", "contract-document", "job_1"),
    ).toBe(false);
  });

  it("refuses an empty remainder — the folder itself is not a file", () => {
    expect(isDocumentUploadPathname("contracts/job_1/", "contract-document", "job_1")).toBe(false);
  });

  it("refuses the RIGHT owner in the WRONG folder", () => {
    expect(isDocumentUploadPathname("contracts/job_1/x.pdf", "dispatch-slip", "job_1")).toBe(false);
  });
});

group("does this STORED URL belong to this record", () => {
  it("accepts a real store URL under the right prefix", () => {
    expect(
      isDocumentBlobUrl(url(OURS, "contracts/job_1/x-r4nd0m.pdf"), "contract-document", "job_1"),
    ).toBe(true);
  });

  it("strips exactly one leading slash, never two", () => {
    // `//contracts/job_1/x.pdf` is a different store key, and collapsing
    // the two would let a caller name a blob this prefix does not cover.
    expect(
      isDocumentBlobUrl(
        `https://${OURS}.public.blob.vercel-storage.com//contracts/job_1/x.pdf`,
        "contract-document",
        "job_1",
      ),
    ).toBe(false);
  });

  it("refuses a URL that is not a blob URL at all", () => {
    expect(isDocumentBlobUrl("https://evil.test/contracts/job_1/x.pdf", "contract-document", "job_1")).toBe(
      false,
    );
    expect(isDocumentBlobUrl("not a url", "contract-document", "job_1")).toBe(false);
  });
});

group("the one call every recording action makes", () => {
  it("accepts a URL from our store under this record's own prefix", () => {
    expect(
      documentUrlProblem(url(OURS, "contracts/job_1/x-r4nd0m.pdf"), "contract-document", "job_1", ENV),
    ).toBeNull();
  });

  it("REFUSES a correct path in SOMEBODY ELSE'S store", () => {
    // The gap the path cannot close: the path is exactly what an attacker
    // with a store of their own gets to choose.
    const problem = documentUrlProblem(
      url("attackerstore", "contracts/job_1/x-r4nd0m.pdf"),
      "contract-document",
      "job_1",
      ENV,
    );
    expect(problem).toContain("did not come from this app's storage");
  });

  it("REFUSES our store under another owner's prefix, and says which kind of owner", () => {
    expect(
      documentUrlProblem(url(OURS, "contracts/job_2/x.pdf"), "contract-document", "job_1", ENV),
    ).toContain("was not uploaded to this job");
    expect(
      documentUrlProblem(url(OURS, "compliance/cmp_2/x.pdf"), "compliance-document", "cmp_1", ENV),
    ).toContain("was not uploaded to this company");
  });

  it("FAILS CLOSED when no credentials name a store at all", () => {
    // Without credentials the token route cannot mint anything, so no
    // legitimate URL exists to record in that state. Refusing costs
    // nothing that was working.
    expect(
      documentUrlProblem(url(OURS, "contracts/job_1/x.pdf"), "contract-document", "job_1", {}),
    ).not.toBeNull();
  });
});

group("the name stored beside the row", () => {
  it("keeps what the person picked, not the suffixed pathname", () => {
    expect(documentDisplayFileName("Executed Subcontract (final).pdf")).toBe(
      "Executed Subcontract (final).pdf",
    );
  });

  it("drops directory parts and control characters, and bounds the length", () => {
    expect(documentDisplayFileName("C:\\Users\\bob\\COI.pdf")).toBe("COI.pdf");
    expect(documentDisplayFileName("COI\u0000\u001b.pdf")).toBe("COI.pdf");
    expect((documentDisplayFileName("a".repeat(500)) as string).length).toBe(200);
  });

  it("returns null rather than an empty string when nothing usable is left", () => {
    expect(documentDisplayFileName("")).toBeNull();
    expect(documentDisplayFileName("   ")).toBeNull();
  });
});

group("what the person is told when storage refuses", () => {
  it("says the reason was not passed on, because the SDK discards it", () => {
    // dist/client.js:398-400 throws `Failed to  retrieve the client token`
    // — double space and all — without reading the body of our 400.
    const message = documentUploadErrorMessage(
      new Error("Failed to  retrieve the client token"),
    );
    expect(message).toContain("does not pass on the reason");
  });

  it("passes any other message through rather than inventing one", () => {
    expect(documentUploadErrorMessage(new Error("Network request failed"))).toBe(
      "Network request failed",
    );
    expect(documentUploadErrorMessage(null)).toBe("Upload failed");
  });
});
