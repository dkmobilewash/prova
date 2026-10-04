import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `runCompanyCamImport` with CompanyCam's API and the blob store mocked —
 * the two guarantees that matter most for a re-runnable import: the SAME
 * photo is never written twice, and a link only ever reads or writes the
 * COMPANY it belongs to, never a bystander's job.
 */

let linkRows: Record<string, unknown>[] = [];
let existingJobMedia: { companycamPhotoId: string | null }[] = [];
let created: Record<string, unknown>[] = [];
let linkUpdates: { where: unknown; data: Record<string, unknown> }[] = [];
let findFirstCalls: { where: unknown }[] = [];
let deletedBlobUrls: string[] = [];
let putCalls: { pathname: string }[] = [];

vi.mock("@prova/db", () => ({
  prisma: {
    companyCamProjectLink: {
      findFirst: async (args: { where: unknown }) => {
        findFirstCalls.push(args);
        const where = args.where as { id: string; companyId: string };
        return linkRows.find((r) => r.id === where.id && r.companyId === where.companyId) ?? null;
      },
      updateMany: async (args: { where: unknown; data: Record<string, unknown> }) => {
        linkUpdates.push(args);
        return { count: 1 };
      },
    },
    jobMedia: {
      findMany: async () => existingJobMedia,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (data.companycamPhotoId === "RACE") {
          const err = new Error("Unique constraint failed") as Error & { code: string };
          err.code = "P2002";
          throw err;
        }
        created.push(data);
        return { id: `jm_${created.length}`, ...data };
      },
    },
    integrationConnection: {
      findUnique: async () => ({ id: "conn_1" }),
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        companyCamProjectLink: { updateMany: async (args: unknown) => linkUpdates.push(args as never) },
        integrationConnection: { update: async () => {} },
        integrationSyncLog: { create: async () => {} },
      }),
  },
}));

vi.mock("@vercel/blob", () => ({
  put: async (pathname: string) => {
    putCalls.push({ pathname });
    return { url: `https://blob.example/${pathname}` };
  },
  del: async (url: string) => {
    deletedBlobUrls.push(url);
  },
}));

vi.mock("@/lib/companycam/connection", () => ({
  withCompanyCamToken: async (companyId: string, fn: (token: string) => Promise<unknown>) => fn("fake-token"),
}));

let photosByProject: Record<string, { id: string; processingStatus: string | null }[]> = {};

vi.mock("@prova/integrations", async () => {
  const actual = await vi.importActual<typeof import("@prova/integrations")>("@prova/integrations");
  return {
    ...actual,
    fetchCompanyCamPhotoPage: async (_token: string, projectId: string) => {
      const photos = (photosByProject[projectId] ?? []).map((p) => ({
        id: p.id,
        projectId,
        capturedAt: new Date("2026-09-01T00:00:00Z"),
        creatorName: "Ana",
        description: "A photo",
        processingStatus: p.processingStatus,
        uris: [{ type: "web", uri: `https://cdn.companycam.com/${p.id}.jpg` }],
      }));
      return { photos, hasNext: false };
    },
  };
});

// A minimal fetch for the CDN download step — every photo downloads a
// small, valid JPEG-typed response.
const fakeFetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } }));
vi.stubGlobal("fetch", fakeFetch);

const { runCompanyCamImport } = await import("./import");

beforeEach(() => {
  linkRows = [{ id: "link_1", companyId: "company_A", jobId: "job_1", companycamProjectId: "proj_1", companycamProjectName: "Proj One" }];
  existingJobMedia = [];
  created = [];
  linkUpdates = [];
  findFirstCalls = [];
  deletedBlobUrls = [];
  putCalls = [];
  photosByProject = {};
  fakeFetch.mockClear();
});

describe("no duplicates on re-import", () => {
  it("skips a photo already on the job (by companycamPhotoId) and imports only the new one", async () => {
    existingJobMedia = [{ companycamPhotoId: "42" }];
    photosByProject.proj_1 = [
      { id: "42", processingStatus: "processed" },
      { id: "43", processingStatus: "processed" },
    ];
    const summary = await runCompanyCamImport("company_A", "link_1");
    expect(summary.imported).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(created).toHaveLength(1);
    expect(created[0].companycamPhotoId).toBe("43");
  });

  it("skips a photo still processing at CompanyCam rather than importing a placeholder", async () => {
    photosByProject.proj_1 = [{ id: "99", processingStatus: "processing" }];
    const summary = await runCompanyCamImport("company_A", "link_1");
    expect(summary.imported).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(created).toHaveLength(0);
  });

  it("a race onto the unique index (two imports at once) is counted as skipped, not a crash, and cleans up its own blob", async () => {
    photosByProject.proj_1 = [{ id: "RACE", processingStatus: "processed" }];
    const summary = await runCompanyCamImport("company_A", "link_1");
    expect(summary.imported).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(summary.failed).toBe(0);
    expect(deletedBlobUrls).toEqual(["https://blob.example/job-media/job_1/companycam-RACE.jpg"]);
  });

  it("re-running an import that found nothing new writes nothing and still reports success", async () => {
    existingJobMedia = [{ companycamPhotoId: "42" }];
    photosByProject.proj_1 = [{ id: "42", processingStatus: "processed" }];
    const summary = await runCompanyCamImport("company_A", "link_1");
    expect(summary.imported).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(created).toHaveLength(0);
  });
});

describe("tenant scope", () => {
  it("looks the link up scoped by BOTH id and companyId, never id alone", async () => {
    photosByProject.proj_1 = [];
    await runCompanyCamImport("company_A", "link_1");
    expect(findFirstCalls).toHaveLength(1);
    expect(findFirstCalls[0].where).toMatchObject({ id: "link_1", companyId: "company_A" });
  });

  it("refuses a link that belongs to a DIFFERENT company, even with the right link id", async () => {
    await expect(runCompanyCamImport("company_B", "link_1")).rejects.toThrow(/gone/);
    // Never reached CompanyCam or wrote anything for the wrong tenant.
    expect(created).toHaveLength(0);
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it("a company with no link at all gets the same refusal as a wrong company — no information leak about whether the link id exists", async () => {
    const wrongCompany = await runCompanyCamImport("company_B", "link_1").catch((e: Error) => e.message);
    const neverExisted = await runCompanyCamImport("company_A", "link_does_not_exist").catch((e: Error) => e.message);
    expect(wrongCompany).toBe(neverExisted);
  });
});

describe("the import batch limit and remaining flag", () => {
  it("stops at COMPANYCAM_IMPORT_BATCH_LIMIT and says more remain", async () => {
    const { COMPANYCAM_IMPORT_BATCH_LIMIT } = await import("./import");
    photosByProject.proj_1 = Array.from({ length: COMPANYCAM_IMPORT_BATCH_LIMIT + 5 }, (_, i) => ({
      id: `p${i}`,
      processingStatus: "processed",
    }));
    const summary = await runCompanyCamImport("company_A", "link_1");
    expect(summary.imported).toBe(COMPANYCAM_IMPORT_BATCH_LIMIT);
    expect(summary.remaining).toBe(true);
    expect(summary.message).toMatch(/press Import photos again/);
  });
});

/**
 * THE PHOTO STORE REFUSING A WRITE USED TO BE A REDACTED CRASH WITH NO RECORD.
 *
 * `putImpl` was the one call in `importOne` outside a try/catch, while every
 * other failure in that function returns "failed". So a blob-store problem threw
 * past `explain()`, out of the Server Action, and into production's redaction —
 * the operator saw a digest.
 *
 * The message was the lesser half. The throw happened BEFORE the summary block,
 * so `lastImportedAt`, `lastImportStatus`, `lastImportMessage` and the sync-log
 * row were never written, while rows already stored in that press persisted.
 * `companycam.prisma` says those three columns exist because "an import that
 * fails silently is indistinguishable from one nobody ran" — and this path made
 * them do precisely nothing.
 *
 * It is not an exotic case: `BLOB_READ_WRITE_TOKEN` is not in
 * `COMPANYCAM_REQUIRED_ENV`, so a card reads "Connected" and offers Import
 * photos on an install with no store at all — and then every photo in the press
 * takes this path.
 */
describe("a photo store that refuses the write", () => {
  const refusingPut = (async () => {
    throw new Error("No token found. Set BLOB_READ_WRITE_TOKEN.");
  }) as unknown as NonNullable<Parameters<typeof runCompanyCamImport>[2]>["putImpl"];

  it("does not throw out of the import", async () => {
    photosByProject.proj_1 = [
      { id: "1", processingStatus: "processed" },
      { id: "2", processingStatus: "processed" },
    ];
    await expect(
      runCompanyCamImport("company_A", "link_1", { putImpl: refusingPut }),
    ).resolves.toBeDefined();
  });

  it("STILL WRITES THE SUMMARY ROW — the half that actually hurt", async () => {
    photosByProject.proj_1 = [{ id: "1", processingStatus: "processed" }];
    await runCompanyCamImport("company_A", "link_1", { putImpl: refusingPut });

    /* The original defect in one assertion. The throw used to skip this block
     * entirely, so the card kept whatever it last said — including a SUCCESS
     * from an earlier press — while this one failed. */
    expect(
      linkUpdates,
      "a press that failed to store anything wrote no summary row, so the card " +
        "still shows the previous result and the failure is invisible",
    ).toHaveLength(1);
    expect(linkUpdates[0].data.lastImportStatus).toBe("FAILURE");
  });

  it("counts them apart from fetch failures, because the fault is ours", async () => {
    photosByProject.proj_1 = [
      { id: "1", processingStatus: "processed" },
      { id: "2", processingStatus: "processed" },
    ];
    const summary = await runCompanyCamImport("company_A", "link_1", { putImpl: refusingPut });

    expect(summary.unstorable).toBe(2);
    expect(summary.imported).toBe(0);
    expect(
      summary.failed,
      "these photos WERE fetched — counting them as fetch failures blames " +
        "CompanyCam for our own storage being unavailable",
    ).toBe(0);
    expect(created, "nothing should have been written to the database").toHaveLength(0);
  });

  it("says whose problem it is, in the sentence the operator reads", async () => {
    photosByProject.proj_1 = [{ id: "1", processingStatus: "processed" }];
    const summary = await runCompanyCamImport("company_A", "link_1", { putImpl: refusingPut });

    expect(summary.message).toContain("couldn't be saved");
    expect(
      summary.message,
      "the operator's next move depends on knowing this is not a CompanyCam " +
        "outage — without it they go and check CompanyCam, or ring them",
    ).toContain("not a problem at CompanyCam");
  });
});
