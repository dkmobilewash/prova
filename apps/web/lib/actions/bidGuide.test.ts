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

import { runGuideAction } from "./bidGuide";

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
