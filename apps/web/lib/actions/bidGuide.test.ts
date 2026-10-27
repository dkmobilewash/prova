import { beforeEach, describe, expect, it, vi } from "vitest";

const requireCompanyContext = vi.fn();
const can = vi.fn();
const applyBidRecap = vi.fn();
const applyPastPrice = vi.fn();
const revalidatePath = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("@/lib/auth", () => ({ requireCompanyContext: () => requireCompanyContext() }));
vi.mock("@/lib/permissions", () => ({ can: (...a: unknown[]) => can(...a) }));
vi.mock("./bidRecap", () => ({ applyBidRecap: (...a: unknown[]) => applyBidRecap(...a) }));
vi.mock("./bidGuidePastPrice", () => ({ usePastPrice: (...a: unknown[]) => applyPastPrice(...a) }));

const updateWallType = vi.fn();
const refreshWallSchedule = vi.fn();
vi.mock("./wallTypes", () => ({
  updateWallType: (...a: unknown[]) => updateWallType(...a),
  refreshWallSchedule: (...a: unknown[]) => refreshWallSchedule(...a),
}));
const jobFindFirst = vi.fn();
const wallTypeFindFirst = vi.fn();
const wallRunFindMany = vi.fn();
vi.mock("@prova/db", () => ({
  prisma: {
    job: { findFirst: (...a: unknown[]) => jobFindFirst(...a) },
    wallType: { findFirst: (...a: unknown[]) => wallTypeFindFirst(...a) },
    wallRun: { findMany: (...a: unknown[]) => wallRunFindMany(...a) },
  },
}));

import { runGuideAction } from "./bidGuide";
import { wallHeightArg, wallHeightQuestions } from "@/lib/bid/guide/wallHeight";
import { boardLayerQuestions, boardLayersArg } from "@/lib/bid/guide/boardLayers";

/**
 * The guide's buttons reach the server through ONE action, and it must refuse
 * before it does anything: wrong capability, an id it does not know, and the
 * one it has not been built for yet. `applyRecap` must go through the existing
 * `applyBidRecap` — the maths is not duplicated here.
 */
describe("runGuideAction", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireCompanyContext.mockResolvedValue({ company: { id: "c1" } });
    can.mockReturnValue(true);
  });

  it("refuses without MANAGE_ESTIMATING, and touches nothing", async () => {
    can.mockReturnValue(false);
    const result = await runGuideAction("j1", "applyRecap");
    expect(result.ok).toBe(false);
    expect(can).toHaveBeenCalledWith(expect.anything(), "MANAGE_ESTIMATING");
    expect(applyBidRecap).not.toHaveBeenCalled();
  });

  it("applyRecap goes through applyBidRecap and revalidates the Bid layout", async () => {
    applyBidRecap.mockResolvedValue({ ok: true, value: { bidTotal: 1, appliedTotal: 1, lineCount: 1 } });
    expect(await runGuideAction("j1", "applyRecap")).toEqual({ ok: true });
    expect(applyBidRecap).toHaveBeenCalledWith("j1");
    expect(revalidatePath).toHaveBeenCalledWith("/bid/estimates/j1", "layout");
  });

  it("passes applyBidRecap's refusal through as a sentence", async () => {
    applyBidRecap.mockResolvedValue({ ok: false, error: "Set the markup rates first." });
    expect(await runGuideAction("j1", "applyRecap")).toEqual({ ok: false, error: "Set the markup rates first." });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("usePastPrice passes the suggestion's own arg to the past-price action and revalidates", async () => {
    applyPastPrice.mockResolvedValue({ ok: true, value: { updated: 2, fromJobName: "Civic", priceHeldForRecap: false } });
    expect(await runGuideAction("j1", "usePastPrice", "wt:abc:0123abcd")).toEqual({ ok: true });
    expect(applyPastPrice).toHaveBeenCalledWith("j1", "wt:abc:0123abcd");
    expect(revalidatePath).toHaveBeenCalledWith("/bid/estimates/j1", "layout");
  });

  it("usePastPrice passes a stale refusal through, and refuses a missing arg without calling it", async () => {
    applyPastPrice.mockResolvedValue({ ok: false, error: "That price changed. Reload to see the new one." });
    expect(await runGuideAction("j1", "usePastPrice", "wt:abc:0123abcd")).toEqual({
      ok: false,
      error: "That price changed. Reload to see the new one.",
    });
    applyPastPrice.mockClear();
    expect((await runGuideAction("j1", "usePastPrice")).ok).toBe(false);
    expect(applyPastPrice).not.toHaveBeenCalled();
  });

  it("an unknown id is refused, not trusted", async () => {
    const result = await runGuideAction("j1", "dropTheDatabase");
    expect(result.ok).toBe(false);
    expect(applyBidRecap).not.toHaveBeenCalled();
  });
});

/**
 * "How tall are the W2 walls?" — the tap answer. Refused before anything is
 * read or written for a missing capability; refused for another company's job
 * or wall type, a contracted job, a height nobody offered, and a question that
 * has moved since the screen asked it. The write itself is the EXISTING
 * `updateWallType` (with every other field as it stands) and then the existing
 * `refreshWallSchedule` for this job — never raw prisma.
 */
describe("runGuideAction: setWallHeight", () => {
  const TYPE_ROW = {
    id: "wt_w2",
    code: "W2",
    name: "rated wall",
    sides: 2,
    studSpacingIn: { toString: () => "16" },
    notes: null,
    defaultHeightFt: null,
    thicknessIn: { toString: () => "4.88" },
    boardLayers: 2,
    _count: { components: 3 },
  };
  const RUNS = [
    { id: "r1", wallTypeId: "wt_w2", lengthFt: 100, heightFt: null },
    { id: "r2", wallTypeId: "wt_w2", lengthFt: 40, heightFt: null },
  ];
  // The arg the screen was handed, built by the same function the facts use.
  const question = wallHeightQuestions(RUNS, [{ id: "wt_w2", code: "W2", defaultHeightFt: null, componentCount: 3 }])[0]!;
  const ARG = wallHeightArg(question, 9);

  beforeEach(() => {
    vi.resetAllMocks();
    requireCompanyContext.mockResolvedValue({ company: { id: "c1" } });
    can.mockReturnValue(true);
    jobFindFirst.mockResolvedValue({ id: "j1", status: "ESTIMATE" });
    wallTypeFindFirst.mockResolvedValue(TYPE_ROW);
    wallRunFindMany.mockResolvedValue(RUNS);
    updateWallType.mockResolvedValue({ ok: true });
    refreshWallSchedule.mockResolvedValue({ ok: true, value: { created: 3, updated: 0, removed: 0, unpricedRuns: [], orphanRuns: [] } });
  });

  const nothingWritten = () => {
    expect(updateWallType).not.toHaveBeenCalled();
    expect(refreshWallSchedule).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  };

  it("writes the height through updateWallType with the row as it stands, then refreshes this job's walls", async () => {
    expect(await runGuideAction("j1", "setWallHeight", ARG)).toEqual({ ok: true });
    expect(updateWallType).toHaveBeenCalledTimes(1);
    const [typeId, form] = updateWallType.mock.calls[0] as [string, FormData];
    expect(typeId).toBe("wt_w2");
    // EVERY column the library form sends, the thickness and the layers
    // included: `updateWallType` writes what it is given, and this form once
    // left the thickness out — so answering the height cleared it.
    expect(Object.fromEntries(form.entries())).toEqual({
      code: "W2",
      name: "rated wall",
      sides: "2",
      studSpacingIn: "16",
      notes: "",
      thicknessIn: "4.88",
      defaultHeightFt: "9",
      boardLayers: "2",
    });
    expect(refreshWallSchedule).toHaveBeenCalledWith("j1");
    expect(revalidatePath).toHaveBeenCalledWith("/bid/estimates/j1", "layout");
    expect(revalidatePath).toHaveBeenCalledWith("/bid/wall-types");
  });

  it("reads the job, the type and the runs through THIS company", async () => {
    await runGuideAction("j1", "setWallHeight", ARG);
    expect(jobFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "j1", companyId: "c1" } }));
    expect(wallTypeFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "wt_w2", companyId: "c1" } }));
    expect(wallRunFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { jobId: "j1", companyId: "c1", wallTypeId: "wt_w2" } }));
  });

  it("refuses without MANAGE_ESTIMATING, before reading anything", async () => {
    can.mockImplementation((_c: unknown, capability: string) => capability !== "MANAGE_ESTIMATING");
    expect((await runGuideAction("j1", "setWallHeight", ARG)).ok).toBe(false);
    expect(jobFindFirst).not.toHaveBeenCalled();
    nothingWritten();
  });

  it("refuses without VIEW_JOB_COSTS (the refresh's gate) before writing the height", async () => {
    can.mockImplementation((_c: unknown, capability: string) => capability !== "VIEW_JOB_COSTS");
    const result = await runGuideAction("j1", "setWallHeight", ARG);
    expect(result).toEqual({ ok: false, error: expect.stringContaining("costs and pricing") });
    expect(jobFindFirst).not.toHaveBeenCalled();
    nothingWritten();
  });

  it("refuses another company's job (it is not found through this company)", async () => {
    jobFindFirst.mockResolvedValue(null);
    expect(await runGuideAction("j_other", "setWallHeight", ARG)).toEqual({ ok: false, error: "That job isn't on your account any more." });
    nothingWritten();
  });

  it("refuses another company's wall type (not found through this company)", async () => {
    wallTypeFindFirst.mockResolvedValue(null);
    expect((await runGuideAction("j1", "setWallHeight", ARG)).ok).toBe(false);
    nothingWritten();
  });

  it("refuses a contracted job", async () => {
    jobFindFirst.mockResolvedValue({ id: "j1", status: "CONTRACTED" });
    expect((await runGuideAction("j1", "setWallHeight", ARG)).ok).toBe(false);
    nothingWritten();
  });

  it("refuses a height nobody offered, a malformed arg, and a missing one", async () => {
    for (const arg of [ARG.replace(":9:", ":11:"), "wh:wt_w2:9", "not an arg", undefined]) {
      expect((await runGuideAction("j1", "setWallHeight", arg)).ok, String(arg)).toBe(false);
    }
    nothingWritten();
  });

  it("refuses a stale question: a run given its own height since", async () => {
    wallRunFindMany.mockResolvedValue([RUNS[0], { ...RUNS[1], heightFt: 10 }]);
    const result = await runGuideAction("j1", "setWallHeight", ARG);
    expect(result).toEqual({ ok: false, error: expect.stringContaining("changed since you saw the question") });
    nothingWritten();
  });

  it("refuses a stale question: a run added since", async () => {
    wallRunFindMany.mockResolvedValue([...RUNS, { id: "r3", wallTypeId: "wt_w2", lengthFt: 5, heightFt: null }]);
    expect((await runGuideAction("j1", "setWallHeight", ARG)).ok).toBe(false);
    nothingWritten();
  });

  it("refuses a stale question: the type got a default height elsewhere", async () => {
    wallTypeFindFirst.mockResolvedValue({ ...TYPE_ROW, defaultHeightFt: { toString: () => "10" } });
    expect((await runGuideAction("j1", "setWallHeight", ARG)).ok).toBe(false);
    nothingWritten();
  });

  it("refuses rather than let updateWallType's normalising rename the type (a lower-case tag, an untrimmed name)", async () => {
    for (const row of [{ ...TYPE_ROW, code: "W2a" }, { ...TYPE_ROW, name: " rated wall" }, { ...TYPE_ROW, notes: "note\n" }]) {
      wallTypeFindFirst.mockResolvedValue(row);
      const result = await runGuideAction("j1", "setWallHeight", ARG);
      expect(result).toEqual({ ok: false, error: expect.stringContaining("would be renamed") });
    }
    nothingWritten();
  });

  it("passes updateWallType's refusal through and does not refresh", async () => {
    updateWallType.mockResolvedValue({ ok: false, error: "That wall type is no longer in your schedule." });
    expect(await runGuideAction("j1", "setWallHeight", ARG)).toEqual({ ok: false, error: "That wall type is no longer in your schedule." });
    expect(refreshWallSchedule).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("passes the refresh's refusal through", async () => {
    refreshWallSchedule.mockResolvedValue({ ok: false, error: "This job is contracted." });
    expect(await runGuideAction("j1", "setWallHeight", ARG)).toEqual({ ok: false, error: "This job is contracted." });
  });
});

/**
 * "How many layers of board are on the W2 walls?" — the second tap answer,
 * held to everything the height answer is: capability first, company scope,
 * an estimate-stage job, only an offered count, a re-derived question that
 * refuses a stale one, and the write through the EXISTING `updateWallType`
 * (the whole row, one field changed) then `refreshWallSchedule`.
 */
describe("runGuideAction: setBoardLayers", () => {
  const TYPE_ROW = {
    id: "wt_w2",
    code: "W2",
    name: "rated wall",
    sides: 2,
    studSpacingIn: { toString: () => "16" },
    notes: "UL U419",
    defaultHeightFt: { toString: () => "10" },
    thicknessIn: { toString: () => "4.88" },
    boardLayers: null,
    components: [{ perLayer: false }, { perLayer: true }, { perLayer: false }],
  };
  const RUNS = [
    { id: "r1", wallTypeId: "wt_w2", lengthFt: 100 },
    { id: "r2", wallTypeId: "wt_w2", lengthFt: 40 },
  ];
  const question = boardLayerQuestions(RUNS, [{ id: "wt_w2", code: "W2", sides: 2, boardLayers: null, perLayerCount: 1 }])[0]!;
  const ARG = boardLayersArg(question, 2);

  beforeEach(() => {
    vi.resetAllMocks();
    requireCompanyContext.mockResolvedValue({ company: { id: "c1" } });
    can.mockReturnValue(true);
    jobFindFirst.mockResolvedValue({ id: "j1", status: "ESTIMATE" });
    wallTypeFindFirst.mockResolvedValue(TYPE_ROW);
    wallRunFindMany.mockResolvedValue(RUNS);
    updateWallType.mockResolvedValue({ ok: true });
    refreshWallSchedule.mockResolvedValue({ ok: true, value: { created: 0, updated: 5, removed: 0, unpricedRuns: [], orphanRuns: [] } });
  });

  const nothingWritten = () => {
    expect(updateWallType).not.toHaveBeenCalled();
    expect(refreshWallSchedule).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  };

  it("writes the layers through updateWallType with the whole row as it stands, then refreshes this job's walls", async () => {
    expect(await runGuideAction("j1", "setBoardLayers", ARG)).toEqual({ ok: true });
    expect(updateWallType).toHaveBeenCalledTimes(1);
    const [typeId, form] = updateWallType.mock.calls[0] as [string, FormData];
    expect(typeId).toBe("wt_w2");
    expect(Object.fromEntries(form.entries())).toEqual({
      code: "W2",
      name: "rated wall",
      sides: "2",
      studSpacingIn: "16",
      notes: "UL U419",
      thicknessIn: "4.88",
      defaultHeightFt: "10",
      boardLayers: "2",
    });
    expect(refreshWallSchedule).toHaveBeenCalledWith("j1");
    expect(revalidatePath).toHaveBeenCalledWith("/bid/estimates/j1", "layout");
    expect(revalidatePath).toHaveBeenCalledWith("/bid/wall-types");
  });

  it("reads the job, the type and the runs through THIS company", async () => {
    await runGuideAction("j1", "setBoardLayers", ARG);
    expect(jobFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "j1", companyId: "c1" } }));
    expect(wallTypeFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "wt_w2", companyId: "c1" } }));
    expect(wallRunFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { jobId: "j1", companyId: "c1", wallTypeId: "wt_w2" } }));
  });

  it("refuses without MANAGE_ESTIMATING, before reading anything", async () => {
    can.mockImplementation((_c: unknown, capability: string) => capability !== "MANAGE_ESTIMATING");
    expect((await runGuideAction("j1", "setBoardLayers", ARG)).ok).toBe(false);
    expect(jobFindFirst).not.toHaveBeenCalled();
    nothingWritten();
  });

  it("refuses without VIEW_JOB_COSTS (the refresh's gate) before writing the layers", async () => {
    can.mockImplementation((_c: unknown, capability: string) => capability !== "VIEW_JOB_COSTS");
    expect(await runGuideAction("j1", "setBoardLayers", ARG)).toEqual({ ok: false, error: expect.stringContaining("costs and pricing") });
    expect(jobFindFirst).not.toHaveBeenCalled();
    nothingWritten();
  });

  it("refuses another company's job or wall type, and a contracted job", async () => {
    jobFindFirst.mockResolvedValueOnce(null);
    expect(await runGuideAction("j_other", "setBoardLayers", ARG)).toEqual({ ok: false, error: "That job isn't on your account any more." });
    wallTypeFindFirst.mockResolvedValueOnce(null);
    expect((await runGuideAction("j1", "setBoardLayers", ARG)).ok).toBe(false);
    jobFindFirst.mockResolvedValueOnce({ id: "j1", status: "CONTRACTED" });
    expect((await runGuideAction("j1", "setBoardLayers", ARG)).ok).toBe(false);
    nothingWritten();
  });

  it("refuses a count nobody offered, the height question's arg, a malformed arg and a missing one", async () => {
    const heightArg = wallHeightArg({ wallTypeId: "wt_w2", token: question.token }, 9);
    for (const arg of [ARG.replace(":2:", ":3:"), heightArg, "bl:wt_w2:2", "not an arg", undefined]) {
      expect((await runGuideAction("j1", "setBoardLayers", arg)).ok, String(arg)).toBe(false);
    }
    nothingWritten();
  });

  it("refuses a stale question: answered elsewhere since", async () => {
    wallTypeFindFirst.mockResolvedValue({ ...TYPE_ROW, boardLayers: 1 });
    expect(await runGuideAction("j1", "setBoardLayers", ARG)).toEqual({ ok: false, error: expect.stringContaining("changed since you saw the question") });
    nothingWritten();
  });

  it("refuses a stale question: the type's last per-layer part was unticked, so no answer would change anything", async () => {
    wallTypeFindFirst.mockResolvedValue({ ...TYPE_ROW, components: TYPE_ROW.components.map(() => ({ perLayer: false })) });
    expect((await runGuideAction("j1", "setBoardLayers", ARG)).ok).toBe(false);
    nothingWritten();
  });

  it("refuses a stale question: a run added or removed since", async () => {
    wallRunFindMany.mockResolvedValue([...RUNS, { id: "r3", wallTypeId: "wt_w2", lengthFt: 5 }]);
    expect((await runGuideAction("j1", "setBoardLayers", ARG)).ok).toBe(false);
    wallRunFindMany.mockResolvedValue([RUNS[0]]);
    expect((await runGuideAction("j1", "setBoardLayers", ARG)).ok).toBe(false);
    nothingWritten();
  });

  it("refuses rather than let updateWallType's normalising rename the type", async () => {
    wallTypeFindFirst.mockResolvedValue({ ...TYPE_ROW, code: "W2a" });
    expect(await runGuideAction("j1", "setBoardLayers", ARG)).toEqual({ ok: false, error: expect.stringContaining("would be renamed") });
    nothingWritten();
  });

  it("passes updateWallType's and the refresh's refusals through", async () => {
    updateWallType.mockResolvedValueOnce({ ok: false, error: "That wall type is no longer in your schedule." });
    expect(await runGuideAction("j1", "setBoardLayers", ARG)).toEqual({ ok: false, error: "That wall type is no longer in your schedule." });
    expect(refreshWallSchedule).not.toHaveBeenCalled();
    refreshWallSchedule.mockResolvedValueOnce({ ok: false, error: "This job is contracted." });
    expect(await runGuideAction("j1", "setBoardLayers", ARG)).toEqual({ ok: false, error: "This job is contracted." });
  });
});
