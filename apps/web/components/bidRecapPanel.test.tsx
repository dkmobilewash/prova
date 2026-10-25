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

vi.mock("@/lib/actions", () => ({
  applyBidRecap: vi.fn(),
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

  it("says why nothing would be written, and what to do, before the press", () => {
    render(COSTED, RATES);
    expect(host.textContent).toContain("every line here is cost-only");
    expect(host.textContent).toContain("Give each line you sell a unit price");
    expect(applyButton().disabled).toBe(true);
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
});
