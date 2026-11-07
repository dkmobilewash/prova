import { afterEach, describe, expect, it, vi } from "vitest";

const { readPlanBytes, openPlanPdf, closed } = vi.hoisted(() => {
  const closed: string[] = [];
  return {
    closed,
    readPlanBytes: vi.fn(async (planId: string) => ({ ok: true as const, bytes: Buffer.from(planId) })),
    openPlanPdf: vi.fn(async (bytes: Buffer, _options?: { images?: boolean }) => ({ pageCount: 3, close: async () => void closed.push(bytes.toString()) })),
  };
});
vi.mock("./planBytes", () => ({ readPlanBytes }));
vi.mock("./planPdf", () => ({ openPlanPdf }));
const { openSharedPlanPdf, openSharedPlanCount } = await import("./sharedPlanPdf");

describe("openSharedPlanPdf", () => {
  afterEach(() => vi.useRealTimers());

  it("READS AND OPENS A PLAN ONCE for every reader at the same time (ELEVEN03: one copy per reader made 5.07 GB)", async () => {
    vi.useFakeTimers();
    readPlanBytes.mockClear();
    openPlanPdf.mockClear();
    const borrowed = await Promise.all(Array.from({ length: 35 }, () => openSharedPlanPdf("plan_a", "co_1")));
    expect(borrowed.every((b) => b.ok)).toBe(true);
    expect(readPlanBytes).toHaveBeenCalledTimes(1);
    expect(openPlanPdf).toHaveBeenCalledTimes(1);
    // Giving every loan back does not close it at once: the next slice reuses it.
    for (const b of borrowed) if (b.ok) await b.pdf.close();
    expect(closed).not.toContain("plan_a");
    const again = await openSharedPlanPdf("plan_a", "co_1");
    expect(openPlanPdf).toHaveBeenCalledTimes(1);
    if (again.ok) await again.pdf.close();
    // Idle for 30 s with no loans out: really closed, and the next reader opens afresh.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(closed.filter((c) => c === "plan_a")).toHaveLength(1);
    expect(openSharedPlanCount()).toBe(0);
    await openSharedPlanPdf("plan_a", "co_1");
    expect(openPlanPdf).toHaveBeenCalledTimes(2);
  });

  it("is not closed while any loan is out, and a loan given back twice counts once", async () => {
    vi.useFakeTimers();
    const a = await openSharedPlanPdf("plan_b", "co_1");
    const b = await openSharedPlanPdf("plan_b", "co_1");
    if (!a.ok || !b.ok) throw new Error("borrow failed");
    await a.pdf.close();
    await a.pdf.close();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(closed).not.toContain("plan_b");
    await b.pdf.close();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(closed).toContain("plan_b");
  });

  it("skips images by default, and the copy that decodes them is a separate one, opened only when asked for", async () => {
    openPlanPdf.mockClear();
    await openSharedPlanPdf("plan_e", "co_1");
    await openSharedPlanPdf("plan_e", "co_1");
    expect(openPlanPdf.mock.calls.map((call) => call[1])).toEqual([{ images: false }]);
    await openSharedPlanPdf("plan_e", "co_1", { images: true });
    expect(openPlanPdf.mock.calls.map((call) => call[1])).toEqual([{ images: false }, { images: true }]);
  });

  it("keeps companies apart, and a refused read is a sentence that is not kept", async () => {
    readPlanBytes.mockClear();
    await openSharedPlanPdf("plan_c", "co_1");
    await openSharedPlanPdf("plan_c", "co_2");
    expect(readPlanBytes).toHaveBeenCalledTimes(2);
    readPlanBytes.mockResolvedValueOnce({ ok: false, error: "That plan set is no longer on file, so nothing was read." } as never);
    expect(await openSharedPlanPdf("plan_d", "co_1")).toEqual({ ok: false, error: "That plan set is no longer on file, so nothing was read." });
    expect((await openSharedPlanPdf("plan_d", "co_1")).ok).toBe(true);
  });
});

describe("one copy for the process", () => {
  it("A SECOND COPY OF THE MODULE BORROWS THE SAME DOCUMENT (Next bundles each route on its own: ELEVEN03 read the plan from two chunks)", async () => {
    readPlanBytes.mockClear();
    await openSharedPlanPdf("plan_x", "co_1");
    vi.resetModules();
    const other = await import("./sharedPlanPdf");
    expect(other.openSharedPlanPdf).not.toBe(openSharedPlanPdf);
    await other.openSharedPlanPdf("plan_x", "co_1");
    expect(readPlanBytes).toHaveBeenCalledTimes(1);
  });
});
