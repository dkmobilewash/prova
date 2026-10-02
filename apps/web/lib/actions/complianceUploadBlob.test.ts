import { beforeEach, describe as group, expect, it, vi } from "vitest";

/**
 * A COMPLIANCE UPLOAD THAT DOES NOT GET FILED DOES NOT LEAVE ITS FILE BEHIND.
 *
 * ── THE SECOND INSTANCE OF #559, AND HOW IT WAS FOUND ──
 *
 * #559 was filed against the quote reader, which recorded its blob URL nowhere.
 * This path DOES record it — `fileUrl` on `ComplianceDocument` — so it looked
 * collectable, and on the success path it is. Asking whether there was a SECOND
 * path with the same defect is what found this: since #277 the browser uploads
 * BEFORE this action runs, so on all four failure paths the file already exists
 * and no row is ever written to point at it.
 *
 * That is the lesson CLAUDE.md records twice over — a guard that a list is
 * complete cannot notice a second list, and *nothing is ever missing from a
 * list nobody imports*. The fix for the quote path would have shipped alone and
 * read as closing the issue.
 *
 * It matters more here than for a quote: these are COIs, lien waivers and
 * certified payroll, and blobs are uploaded `access: "public"`.
 *
 * ── THE ASSERTION THAT MAKES THIS DIFFERENT FROM THE QUOTE TEST ──
 *
 * The quote path deletes on EVERY exit, because the file has no purpose once
 * its bytes are read. Here a successful upload KEEPS the file — the row renders
 * a link to it — so the rule is "delete unless a row now points at it", and the
 * success case asserts the file SURVIVES. A blanket `finally` copied over from
 * the quote fix would pass every failure case here and silently delete the file
 * off every document a contractor successfully filed, which is a worse bug than
 * the one being fixed.
 */

const context = { company: { id: "co_1" }, id: "user_1", role: "OWNER" as string, jobFunction: null as string | null };

const deleted: string[] = [];
const created: Record<string, unknown>[] = [];

let urlProblem: string | null = null;
let gateOk = true;
let storeServes = true;
let allowanceOk = true;
let extractorThrows = false;

const URL_UP = "https://store.public.blob.vercel-storage.com/co_1/compliance-document/coi.pdf";

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("@/lib/permissions", () => ({ can: () => context.role !== "NOBODY" }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@prova/db", () => ({
  Prisma: {},
  prisma: {
    complianceDocument: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: `cd_${created.length}`, ...data };
      },
    },
    job: { findFirst: async () => null },
  },
}));
vi.mock("@/lib/blob", () => ({
  deleteDocument: async (url: string) => {
    deleted.push(url);
  },
}));
vi.mock("@/lib/ai/settings", () => ({
  aiGate: async () =>
    gateOk ? { ok: true, model: "claude-opus-5" } : { ok: false, error: "Document reading is switched off." },
}));
vi.mock("@/lib/ask/usage", () => ({ recordAskUsage: async () => {} }));
vi.mock("@/lib/ask/documentSpend", () => ({
  claimDocumentPages: async () =>
    allowanceOk
      ? { ok: true, claim: { id: "claim_1" }, note: "1 page", pagesLeft: 99 }
      : { ok: false, error: "This month's document pages are used up." },
}));
vi.mock("@/lib/ask/allowance", () => ({ markAskAllowanceFailure: async () => {} }));
vi.mock("@/lib/document-uploads", () => ({
  documentUrlProblem: () => urlProblem,
  documentDisplayFileName: (name: string) => name || "coi.pdf",
  isAllowedDocumentType: (type: string) =>
    ["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(type),
  uploadMaxBytesFor: () => 250 * 1024 * 1024,
  DOCUMENT_UPLOAD_TARGETS: { "compliance-document": { scope: "company", maxBytes: 1024 } },
}));
vi.mock("@prova/integrations", () => ({
  extractComplianceDocument: async () => {
    if (extractorThrows) throw new Error("the model refused");
    return {
      type: "CERTIFICATE_OF_INSURANCE",
      partyName: "Acme Drywall",
      amount: null,
      periodStart: null,
      periodEnd: null,
      effectiveDate: null,
      expiresAt: null,
      notes: null,
    };
  },
}));

beforeEach(() => {
  deleted.length = 0;
  created.length = 0;
  urlProblem = null;
  gateOk = true;
  storeServes = true;
  allowanceOk = true;
  extractorThrows = false;
  context.role = "OWNER";
  globalThis.fetch = (async () =>
    storeServes
      ? {
          ok: true,
          headers: { get: (h: string) => (h.toLowerCase() === "content-type" ? "application/pdf" : null) },
          arrayBuffer: async () => new Uint8Array([37, 80, 68, 70]).buffer,
        }
      : { ok: false, status: 404, headers: { get: () => null } }) as unknown as typeof fetch;
});

async function upload() {
  const { uploadComplianceDocument } = await import("./compliance");
  const form = new FormData();
  form.set("fileUrl", URL_UP);
  form.set("fileName", "coi.pdf");
  return uploadComplianceDocument(form);
}

group("a compliance upload that is not filed leaves no file behind", () => {
  it("KEEPS the file when the document is filed — the difference from the quote path", async () => {
    const result = await upload();
    expect(result.ok, "a good upload still files").toBe(true);
    expect(created, "a row was written").toHaveLength(1);
    expect(created[0]!.fileUrl, "and it points at the file").toBe(URL_UP);
    // THE ASSERTION A COPIED-OVER `finally` WOULD FAIL. The row renders a link
    // to this file; deleting it here would break every filed document.
    expect(deleted, "a filed document keeps its file").toEqual([]);
  });

  it("deletes it when document reading is switched off", async () => {
    gateOk = false;
    const result = await upload();
    expect(result.ok).toBe(false);
    expect(created, "nothing is filed with the reader off").toEqual([]);
    expect(deleted).toEqual([URL_UP]);
  });

  it("deletes it when the store will not serve the bytes back", async () => {
    storeServes = false;
    const result = await upload();
    expect(result.ok).toBe(false);
    expect(deleted).toEqual([URL_UP]);
  });

  it("deletes it when the month's allowance refuses", async () => {
    allowanceOk = false;
    const result = await upload();
    expect(result.ok).toBe(false);
    expect(deleted).toEqual([URL_UP]);
  });

  it("deletes it when the extractor throws", async () => {
    extractorThrows = true;
    const result = await upload();
    expect(result.ok).toBe(false);
    expect(created, "a thrown extractor files nothing").toEqual([]);
    expect(deleted).toEqual([URL_UP]);
  });

  it("deletes NOTHING when the URL has not been proved ours", async () => {
    // The dangerous direction, same as the quote path: before
    // `documentUrlProblem` accepts it this URL is a claim the browser made.
    urlProblem = "That file did not come from this app's storage.";
    const result = await upload();
    expect(result.ok).toBe(false);
    expect(deleted, "an unvalidated URL must never be deleted").toEqual([]);
  });
});
