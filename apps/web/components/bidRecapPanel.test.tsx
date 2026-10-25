// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE BID RECAP MUST MOVE WHEN A LINE'S COST IS TYPED, NOT WHEN THE SERVER
 * GETS ROUND TO SAYING SO. Bug A from the 2026-10-19 walk.
 *
 * ── WHAT WAS ACTUALLY WRONG, MEASURED RATHER THAN GUESSED ──
 *
 * Nothing was un-revalidated. `setLineBudgetedCost` revalidates, the action
 * response carries the re-rendered page, and on a fast local server the recap
 * repaints in half a second. The walk saw "$0.00 until a reload" anyway, and a
 * real Chromium against a production build of this app, with 2s of network
 * latency on each request, shows why:
 *
 *     POST sent 41ms      ...each cost box blurred, one after another
 *     POST done 2038      the second POST is only SENT now — Next runs
 *     POST done 4046      Server Actions one at a time, in a queue
 *     POST done 6054
 *     POST done 8063
 *     8246ms  direct $0.00 -> $8,950.00   NOTHING in between
 *
 * Every one of those saves is an async transition, React 19 entangles them,
 * and it commits none of their re-renders until the LAST one settles. So four
 * cost boxes typed in a row show $0.00 for four full round trips — each of
 * which, on this page in production, is a whole Estimate-tab render — and the
 * only thing on screen that moved was nothing. A reload looks like the fix.
 *
 * The rates never had this problem because the preview reads the rates from
 * the form's own `draft` state; it never waited for the server at all. The
 * line costs now do the same thing through `useOptimistic`: the preview is the
 * SAME pure `bidRecap` over the lines as typed, and the server's lines replace
 * them the moment its re-render commits — or put the old figure back, beside
 * the refusal, if the save is refused.
 *
 * These cases hold the action pending on purpose. That is the state the walk
 * was in, and the only state in which the old code and the new one differ.
 */

const pending: Array<(value: { ok: true } | { ok: false; error: string }) => void> = [];
const setLineBudgetedCost = vi.fn(
  () => new Promise<{ ok: true } | { ok: false; error: string }>((resolve) => pending.push(resolve)),
);
const setLineCostCategory = vi.fn(
  () => new Promise<{ ok: true } | { ok: false; error: string }>((resolve) => pending.push(resolve)),
);

const applyBidRecap = vi.fn<(jobId: string, options?: { priceUnpriced?: boolean }) => Promise<unknown>>(async () => ({
  ok: true as const,
  value: { bidTotal: 0, appliedTotal: 0, lineCount: 0 },
}));

vi.mock("@/lib/actions", () => ({
  applyBidRecap,
  saveBidRecap: vi.fn(),
  setLineBudgetedCost,
  setLineCostCategory,
}));
const { BidRecapPanel } = await import("@/components/BidRecapPanel");
type Props = Parameters<typeof BidRecapPanel>[0];

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  pending.length = 0;
  setLineBudgetedCost.mockClear();
  setLineCostCategory.mockClear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  // Settle whatever a case left in flight. React 19 entangles every pending
  // async transition in the page — that is bug A's whole mechanism — so a save
  // one case never answered would hold the NEXT case's commit back too.
  await act(async () => {
    for (const resolve of pending.splice(0)) resolve({ ok: true });
  });
  act(() => root.unmount());
  host.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

/** Two cost-only lines with no cost yet — the walk's starting state. */
const LINES: Props["lines"] = [
  { id: "board", description: "5/8 Type X board", quantity: 2800, unitCost: null, unitPrice: null, costCategory: "MATERIAL" },
  { id: "tape", description: "Hang and tape", quantity: 300, unitCost: null, unitPrice: null, costCategory: "LABOR" },
];

function render(lines: Props["lines"] = LINES, rates: Props["rates"] = {}) {
  act(() => {
    root.render(createElement(BidRecapPanel, { jobId: "job-1", lines, rates, applied: null, ratesCollapsed: true }));
  });
}

/** The figure in the "Direct cost of the work" row, read off the DOM. */
function directCost(): string {
  const row = [...host.querySelectorAll("tr")].find((tr) => tr.textContent?.includes("Direct cost of the work"));
  if (!row) throw new Error("no Direct cost row rendered");
  return row.querySelectorAll("td")[1]?.textContent ?? "";
}

/** Type into a cost box and leave it, the way the walk did. */
function typeCost(description: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(`input[aria-label="Budgeted cost for ${description}"]`);
  if (!input) throw new Error(`no cost box for ${description}`);
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

describe("BidRecapPanel — a typed cost reaches the recap before the server answers (bug A)", () => {
  it("starts at $0.00, so the cases below are about a change and not a figure already on the page", () => {
    render();
    expect(directCost()).toBe("$0.00");
  });

  it("shows the typed cost in the direct cost while the save is still in flight", async () => {
    render();
    typeCost("5/8 Type X board", "1.25");
    await act(async () => {});
    expect(setLineBudgetedCost).toHaveBeenCalledTimes(1);
    expect(pending).toHaveLength(1); // still unanswered
    expect(directCost()).toBe("$3,500.00");
  });

  it("adds up several lines typed in a row, none of them answered yet", async () => {
    render();
    typeCost("5/8 Type X board", "1.25");
    typeCost("Hang and tape", "6.50");
    await act(async () => {});
    expect(pending).toHaveLength(2);
    expect(directCost()).toBe("$5,450.00");
  });

  it("says it is still saving while the figure runs ahead of the server, and stops once it has answered", async () => {
    render();
    expect(host.textContent).not.toContain("Saving…");
    typeCost("5/8 Type X board", "1.25");
    await act(async () => {});
    expect(host.textContent).toContain("Saving…");
    await act(async () => {
      pending[0]({ ok: true });
    });
    render([{ ...LINES[0], unitCost: 1.25 }, LINES[1]]);
    expect(host.textContent).not.toContain("Saving…");
  });

  it("reads a typed figure with the server's own parser — a leading $ is decoration, not a refusal", async () => {
    render();
    typeCost("5/8 Type X board", "$1.25");
    await act(async () => {});
    expect(directCost()).toBe("$3,500.00");
  });

  it("puts the old figure back, beside the refusal, when the save is refused", async () => {
    render();
    typeCost("5/8 Type X board", "1.25");
    await act(async () => {});
    expect(directCost()).toBe("$3,500.00");
    await act(async () => {
      pending[0]({ ok: false, error: "Budgeted cost can't be below 0." });
    });
    expect(directCost()).toBe("$0.00");
    expect(host.textContent).toContain("Budgeted cost can't be below 0.");
  });

  it("does not invent a figure from something that is not a number", async () => {
    render();
    typeCost("5/8 Type X board", "abc");
    await act(async () => {});
    expect(directCost()).toBe("$0.00");
  });

  it("takes the server's lines once they arrive", async () => {
    render();
    typeCost("5/8 Type X board", "1.25");
    await act(async () => {
      pending[0]({ ok: true });
    });
    render([{ ...LINES[0], unitCost: 1.25 }, LINES[1]]);
    expect(directCost()).toBe("$3,500.00");
  });

  it("moves the markup when a cost TYPE is changed, too", async () => {
    render([{ ...LINES[0], unitCost: 1, costCategory: null }, LINES[1]], { materialMarkupPercent: 10 });
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="Cost type for 5/8 Type X board"]')!;
    act(() => {
      select.value = "MATERIAL";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {});
    expect(pending).toHaveLength(1);
    expect(host.textContent).toContain("Material markup");
    expect(host.textContent).toContain("+$280.00");
  });
});

/**
 * BUG B — "Apply to line prices" on an estimate whose every line is cost-only.
 *
 * Applying deliberately writes no price to a cost-only line (`spreadToLines`:
 * "a cost-only line is not a share of the bid"), so on the walk's estimate
 * there was nothing to write to at all. The button was enabled anyway, and the
 * walk read the press as doing nothing. The reason now sits beside the button
 * before anybody presses it, and it says what to do.
 */
describe("BidRecapPanel — Apply on an estimate with no priced line (bug B)", () => {
  const COSTED: Props["lines"] = [
    { ...LINES[0], unitCost: 1.25 },
    { ...LINES[1], unitCost: 6.5 },
  ];
  const RATES: Props["rates"] = { overheadPercent: 10, profitPercent: 5 };
  const applyButton = () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Apply to line prices"))!;

  it("offers nothing when no line has a cost to share the bid by: Apply stays disabled and no confirmation appears", () => {
    // (No sentence here: with no cost there is no markup either, and the panel
    // only prints the reason when a markup is waiting to be applied.)
    render([{ ...LINES[0], unitCost: 0 }, LINES[1]], RATES);
    expect(applyButton().disabled).toBe(true);
    expect(host.textContent).not.toContain("This sets a price on");
  });

  it("says nothing of the kind once a line carries a price, and Apply is live", () => {
    render([{ ...COSTED[0], unitPrice: 0 }, COSTED[1]], RATES);
    expect(host.textContent).not.toContain("Apply has no line to put the bid on");
    expect(applyButton().disabled).toBe(false);
  });

  it("names the OTHER way to have nothing to write to: priced lines with no cost", () => {
    render([{ ...LINES[0], unitCost: null, unitPrice: 3 }, { ...LINES[1], unitCost: 6.5 }], RATES);
    expect(host.textContent).toContain("the lines that carry a unit price have no budgeted cost");
    expect(applyButton().disabled).toBe(true);
  });

  /**
   * THE DECISION: when no line carries a price, Apply offers to price the lines
   * that have a cost — and never silently. 3,500 + 1,950 of cost, +10% +5% is a
   * 6,294.75 bid; the unit prices hold two decimals, so the lines land at
   * 4,032.00 + 2,253.00 = 6,285.00 (the panel already says so beside the bid).
   */
  describe("pricing the unpriced lines", () => {
    const button = (label: string) =>
      [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(label));
    const click = async (label: string) => {
      await act(async () => {
        button(label)!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    };

    beforeEach(() => applyBidRecap.mockClear());

    it("is live, and the first press writes NOTHING: it shows what will happen and waits", async () => {
      render(COSTED, RATES);
      expect(applyButton().disabled).toBe(false);
      await click("Apply to line prices");
      expect(applyBidRecap).not.toHaveBeenCalled();
      expect(host.textContent).toContain(
        "This sets a price on 2 lines that have none, totalling $6,285.00. Lines you've priced by hand: none.",
      );
      expect(button("Confirm — price 2 lines")).toBeTruthy();
      expect(button("Cancel")).toBeTruthy();
    });

    it("writes only on Confirm, sending the second step to the server", async () => {
      render(COSTED, RATES);
      await click("Apply to line prices");
      await click("Confirm — price 2 lines");
      expect(applyBidRecap).toHaveBeenCalledTimes(1);
      expect(applyBidRecap).toHaveBeenCalledWith("job-1", { priceUnpriced: true });
    });

    it("Cancel closes the confirmation and writes nothing", async () => {
      render(COSTED, RATES);
      await click("Apply to line prices");
      await click("Cancel");
      expect(applyBidRecap).not.toHaveBeenCalled();
      expect(host.textContent).not.toContain("This sets a price on");
      expect(button("Apply to line prices")).toBeTruthy();
    });

    it("names a zero-cost line that stays unpriced", async () => {
      render([...COSTED, { id: "gc", description: "General conditions", quantity: 1, unitCost: null, unitPrice: null, costCategory: null }], RATES);
      await click("Apply to line prices");
      expect(host.textContent).toContain("This sets a price on 2 lines that have none");
      expect(host.textContent).toContain("1 line has no cost, so it stays unpriced: General conditions.");
    });

    it("mixed: Apply is the unchanged one-press spread, and one line says cost-only lines are left alone", async () => {
      render([{ ...COSTED[0], unitPrice: 0 }, COSTED[1]], RATES);
      expect(host.textContent).toContain("1 cost-only line is left alone");
      await click("Apply to line prices");
      expect(applyBidRecap).toHaveBeenCalledWith("job-1", {});
      expect(host.textContent).not.toContain("This sets a price on");
    });

    it("says no such thing when every line is priced", () => {
      render([{ ...COSTED[0], unitPrice: 0 }, { ...COSTED[1], unitPrice: 0 }], RATES);
      expect(host.textContent).not.toContain("left alone");
    });
  });
});

/**
 * BUG C — the header said BID $0.00 above a recap whose Bid total was
 * $10,249.47. The header is the bid of record (the line prices); the recap total
 * is what those prices become once applied. The recap now prints the header's
 * figure as well, through the same `bidTotalOf`, whenever the two differ.
 */
describe("BidRecapPanel — the bid on the job, beside the bid the rates make (bug C)", () => {
  const RATES: Props["rates"] = { overheadPercent: 10, profitPercent: 5 };
  const bidNowRow = () => [...host.querySelectorAll("tr")].find((tr) => tr.textContent?.includes("Bid on the job now"));

  it("shows the line prices' $0.00 under a marked-up bid nobody has applied", () => {
    render([{ ...LINES[0], unitCost: 1.25 }], RATES);
    const row = bidNowRow();
    expect(row, "the header's figure must be on the recap too").toBeTruthy();
    expect(row!.querySelectorAll("td")[1].textContent).toBe("$0.00");
  });

  it("shows a priced job's real bid under a recap that reads $0 for want of costs", () => {
    render([{ ...LINES[0], unitCost: null, unitPrice: 2 }], RATES);
    expect(bidNowRow()!.querySelectorAll("td")[1].textContent).toBe("$5,600.00");
  });

  it("goes away once the prices ARE the bid", () => {
    // 2800 × 1.25 = 3500; +10% +5% = 4042.50 → 1.44375/unit, stored 1.44 → 4032.
    render([{ ...LINES[0], unitCost: 1.25, unitPrice: 1.44 }], RATES);
    expect(bidNowRow()).toBeUndefined();
  });
});
