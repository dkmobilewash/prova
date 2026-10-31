import { beforeEach, describe, expect, it, vi } from "vitest";

const detect = vi.fn();
const wallItems = vi.fn(async () => ({ kind: "skipped", why: "" }));
const count = vi.fn();
const deleteDetected = vi.fn(async () => ({ count: 0 }));
const deleteProposals = vi.fn(async () => ({ count: 0 }));
vi.mock("./detectWallsForCalibration", () => ({ detectWallsForCalibration: (t: unknown) => detect(t) }));
vi.mock("@/lib/plan-ingest/wallItems", () => ({ wallItemsForSheet: (i: unknown) => (wallItems as (x: unknown) => unknown)(i) }));
vi.mock("@prova/db", () => ({
  prisma: {
    takeoffMeasurement: { count: (a: unknown) => count(a), deleteMany: (a: unknown) => (deleteDetected as (x: unknown) => unknown)(a) },
    takeoffWallProposal: { deleteMany: (a: unknown) => (deleteProposals as (x: unknown) => unknown)(a) },
  },
}));
const { refreshSheetWalls } = await import("./refreshSheetWalls");
const target = { pageId: "p", calibrationId: "c", planId: "pl", companyId: "co", pageNumber: 1, feetPerUnit: 100, wallTypes: [], jobId: "j", userId: null };
/** total DETECTED rows, then how many of them are posted. */
const rows = (total: number, posted: number) => count.mockResolvedValueOnce(total).mockResolvedValueOnce(posted);

beforeEach(() => vi.clearAllMocks());

describe("refreshing a sheet's walls after an exclusion", () => {
  it("replaces unposted detected walls from the new detection", async () => {
    detect.mockResolvedValue("written");
    rows(4, 0);
    expect((await refreshSheetWalls(target)).kind).toBe("replaced");
    expect(deleteDetected).toHaveBeenCalledTimes(1);
    expect(wallItems).toHaveBeenCalledTimes(1);
  });
  it("ONE POSTED ROW LEAVES THE SHEET ALONE: nothing deleted, nothing rewritten, and it says so", async () => {
    detect.mockResolvedValue("written");
    rows(4, 1);
    expect((await refreshSheetWalls(target)).kind).toBe("posted-left-alone");
    expect(deleteDetected).not.toHaveBeenCalled();
    expect(wallItems).not.toHaveBeenCalled();
  });
  it("everything excluded: the old proposals and rows go, and no walls are written back", async () => {
    detect.mockResolvedValue("nothing-found");
    rows(4, 0);
    expect((await refreshSheetWalls(target)).kind).toBe("emptied");
    expect(deleteProposals).toHaveBeenCalledTimes(1);
    expect(wallItems).not.toHaveBeenCalled();
  });
  it("a sheet with no walls on the job refreshes the proposals only; a failed detection touches nothing", async () => {
    detect.mockResolvedValue("written");
    count.mockResolvedValueOnce(0);
    expect((await refreshSheetWalls(target)).kind).toBe("proposals-only");
    detect.mockResolvedValue("failed");
    expect((await refreshSheetWalls(target)).kind).toBe("failed");
    expect(deleteDetected).not.toHaveBeenCalled();
    expect(deleteProposals).not.toHaveBeenCalled();
  });
});
