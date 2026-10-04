import { beforeEach, describe as group, expect, it, vi } from "vitest";

/**
 * DELETING A RECORD THAT HOLDS A FILE DELETES THE FILE, AND IN THAT ORDER.
 *
 * ── HOW THESE THREE WERE FOUND ──
 *
 * #559 reported one stranded-blob path: the quote reader, which recorded its
 * URL nowhere. Fixing it, I claimed no other path had the defect — having
 * enumerated the actions that take a `fileUrl` IN. That was the wrong axis.
 *
 * The defect is "a blob with no row pointing at it", and dropping the ROW while
 * leaving the blob is the other way to cause it. Asking that question found
 * three more deletes, against two that already did it right:
 *
 *   bidAddendum      (estimating.ts)  already deleted its file
 *   contractDocument (billing.ts)     already deleted its file
 *   complianceDocument               did NOT
 *   takeoffPlan                      did NOT  — and `fileUrl` is REQUIRED there
 *   drawingRevision                  did NOT
 *
 * Two of five being right is why the pattern looked established. *Nothing is
 * ever missing from a question nobody is asking.*
 *
 * `takeoffPlan` is the one worth singling out: its `fileUrl` column is not
 * nullable, so every plan delete stranded an entire plan set — a GC's drawings
 * at a permanent unauthenticated address, since blobs are `access: "public"`.
 * Its old comment argued for leaving the file ("a dangling file costs storage,
 * and a delete that half-succeeded costs a drawing somebody was working from").
 * The second half is real and is why ORDER is asserted below; the first half
 * called a public leak a storage cost.
 *
 * ── WHY THE ORDER IS ASSERTED AND NOT JUST THE DELETE ──
 *
 * Row first, file second. The other order can leave a row pointing at a file
 * that is gone, which is a dead link on a document somebody is working from —
 * strictly worse than a stranded file, because it breaks something that looks
 * fine. Each case below checks the sequence, not just that both happened.
 */

const context = {
  company: { id: "co_1" },
  id: "user_1",
  role: "OWNER" as string,
  jobFunction: null as string | null,
};

/** Everything that happened, in order, so the sequence can be asserted. */
const log: string[] = [];

let complianceRow: { id: string; companyId: string; fileUrl: string | null } | null = null;
let planRow: { fileUrl: string | null } | null = null;
let planDeleteCount = 1;
let revisionRow: { id: string; fileUrl: string | null; set: { companyId: string } } | null = null;

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("@/lib/permissions", () => ({ can: () => context.role !== "NOBODY" }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/blob", () => ({
  deleteDocument: async (url: string) => {
    log.push(`blob:${url}`);
  },
}));
vi.mock("@prova/db", () => ({
  Prisma: {},
  prisma: {
    complianceDocument: {
      findUnique: async () => complianceRow,
      delete: async () => {
        log.push("row:compliance");
        return complianceRow;
      },
    },
    takeoffPlan: {
      findFirst: async () => planRow,
      deleteMany: async () => {
        if (planDeleteCount > 0) log.push("row:plan");
        return { count: planDeleteCount };
      },
    },
    drawingRevision: {
      findUnique: async () => revisionRow,
      delete: async () => {
        log.push("row:revision");
        return revisionRow;
      },
    },
  },
}));

const COMPLIANCE_URL = "https://store.public.blob.vercel-storage.com/co_1/compliance-document/coi.pdf";
const PLAN_URL = "https://store.public.blob.vercel-storage.com/co_1/plan-takeoff/A-101.pdf";
const REVISION_URL = "https://store.public.blob.vercel-storage.com/co_1/drawing-revision/rev-c.pdf";

beforeEach(() => {
  log.length = 0;
  context.role = "OWNER";
  complianceRow = { id: "cd_1", companyId: "co_1", fileUrl: COMPLIANCE_URL };
  planRow = { fileUrl: PLAN_URL };
  planDeleteCount = 1;
  revisionRow = { id: "dr_1", fileUrl: REVISION_URL, set: { companyId: "co_1" } };
});

group("deleting a compliance document takes its file", () => {
  it("deletes the row and then the file", async () => {
    const { deleteComplianceDocument } = await import("./compliance");
    await deleteComplianceDocument("cd_1");
    // Order, not just presence: the row goes first so a half-failure can only
    // strand a file, never leave a row pointing at one that is gone.
    expect(log).toEqual(["row:compliance", `blob:${COMPLIANCE_URL}`]);
  });

  it("deletes nothing from the store when the row carried no file", async () => {
    complianceRow = { id: "cd_1", companyId: "co_1", fileUrl: null };
    const { deleteComplianceDocument } = await import("./compliance");
    await deleteComplianceDocument("cd_1");
    expect(log).toEqual(["row:compliance"]);
  });

  it("deletes nothing at all when the document is another company's", async () => {
    complianceRow = { id: "cd_1", companyId: "co_OTHER", fileUrl: COMPLIANCE_URL };
    const { deleteComplianceDocument } = await import("./compliance");
    await expect(deleteComplianceDocument("cd_1")).rejects.toThrow(/not found/i);
    // Neither the row nor the file — the tenancy check comes first, and a
    // delete that reached the store here would be destroying another
    // company's document.
    expect(log).toEqual([]);
  });
});

group("deleting a takeoff plan takes its file", () => {
  it("deletes the row and then the file", async () => {
    const { deleteTakeoffPlan } = await import("./takeoff");
    const result = await deleteTakeoffPlan("job_1", "plan_1");
    expect(result.ok).toBe(true);
    expect(log).toEqual(["row:plan", `blob:${PLAN_URL}`]);
  });

  it("deletes nothing from the store when the row was already gone", async () => {
    // `deleteMany` matching nothing is the "somebody else deleted it" case; the
    // action refuses, and refusing must not delete a file a surviving row
    // elsewhere might still point at.
    planDeleteCount = 0;
    const { deleteTakeoffPlan } = await import("./takeoff");
    const result = await deleteTakeoffPlan("job_1", "plan_1");
    expect(result.ok).toBe(false);
    expect(log).toEqual([]);
  });

  it("refuses without the capability, and deletes nothing", async () => {
    context.role = "NOBODY";
    const { deleteTakeoffPlan } = await import("./takeoff");
    const result = await deleteTakeoffPlan("job_1", "plan_1");
    expect(result.ok).toBe(false);
    expect(log).toEqual([]);
  });
});

group("deleting a drawing revision takes its file", () => {
  it("deletes the row and then the file", async () => {
    const { deleteDrawingRevision } = await import("./drawings");
    const result = await deleteDrawingRevision("dr_1");
    expect(result.ok).toBe(true);
    expect(log).toEqual(["row:revision", `blob:${REVISION_URL}`]);
  });

  it("deletes nothing from the store when the revision carried no file", async () => {
    // `DrawingRevision.fileUrl` is nullable — a revision can be recorded as
    // issued before its PDF arrives, which is a state this feature exists to
    // show.
    revisionRow = { id: "dr_1", fileUrl: null, set: { companyId: "co_1" } };
    const { deleteDrawingRevision } = await import("./drawings");
    const result = await deleteDrawingRevision("dr_1");
    expect(result.ok).toBe(true);
    expect(log).toEqual(["row:revision"]);
  });

  it("deletes nothing at all when the revision belongs to another company", async () => {
    revisionRow = { id: "dr_1", fileUrl: REVISION_URL, set: { companyId: "co_OTHER" } };
    const { deleteDrawingRevision } = await import("./drawings");
    const result = await deleteDrawingRevision("dr_1");
    expect(result.ok).toBe(false);
    expect(log).toEqual([]);
  });
});
