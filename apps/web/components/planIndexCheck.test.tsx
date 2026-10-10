// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE INDEX CHECK'S CONTROL HAS TO BE ON THE SCREEN AN ESTIMATOR IS ON.
 *
 * A RENDER test, not a census, and #665 is why: that PR shipped a button gated
 * on a stage value, so it existed, called the right action, sat in the right
 * branch and appeared on no screen anybody used. Every assertion a source
 * census could make was true while the app was broken.
 *
 * This one has a second reason. The button only renders when `planId` is
 * passed, and the component had been taking `rows` alone for its whole life —
 * so forgetting the prop at the single call site is a one-character mistake
 * that hides the feature completely and breaks nothing.
 */
vi.mock("@/lib/actions/planSheets", () => ({
  checkDrawingIndex: vi.fn(),
  acceptPlanSheets: vi.fn(),
  rejectPlanSheet: vi.fn(),
}));

const { PlanSheetReview } = await import("./PlanSheetReview");
const { checkDrawingIndex } = await import("@/lib/actions/planSheets");

type Row = Parameters<typeof PlanSheetReview>[0]["rows"][number];

const row = (pageNumber: number, sheetNumber: string): Row =>
  ({
    pageNumber,
    hasText: true,
    proposal: {
      id: `prop_${pageNumber}`,
      sheetNumber,
      title: "FLOOR PLAN",
      confidence: "HIGH",
      status: "PROPOSED",
      acceptedSheetNumber: null,
      acceptedTitle: null,
    },
  }) as unknown as Row;

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.mocked(checkDrawingIndex).mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function paint(props: { rows: Row[]; planId?: string }) {
  act(() => {
    root.render(createElement(PlanSheetReview, props as never));
  });
  return host;
}

const button = (el: HTMLElement) =>
  el.querySelector('[data-sheet-review="check-index"]') as HTMLButtonElement | null;

describe("the drawing index check", () => {
  const rows = [row(1, "A100"), row(2, "A101")];

  it("is on the screen, and not hidden", () => {
    // `querySelector` finds a node with `hidden` on it just as happily as a
    // visible one, so the attribute is asserted rather than assumed.
    const found = button(paint({ rows, planId: "plan_1" }));
    expect(found).not.toBeNull();
    expect(found?.hidden).toBe(false);
    expect(found?.className).not.toContain("hidden");
  });

  it("says what it does in words an estimator reads", () => {
    expect(button(paint({ rows, planId: "plan_1" }))?.textContent).toBe("Check against the set's own index");
  });

  it("does nothing until it is asked", () => {
    paint({ rows, planId: "plan_1" });
    expect(checkDrawingIndex).not.toHaveBeenCalled();
  });

  it("asks about THIS plan when pressed", () => {
    vi.mocked(checkDrawingIndex).mockResolvedValue({
      ok: true,
      sentence: "The index on the cover lists 2 sheets and all 2 are here.",
      missing: [],
      unlisted: [],
      onPage: 1,
    });
    const el = paint({ rows, planId: "plan_7" });
    act(() => {
      button(el)?.click();
    });
    expect(checkDrawingIndex).toHaveBeenCalledWith("plan_7");
  });

  it("PUTS THE MISSING SHEET NUMBERS ON THE SCREEN", async () => {
    // The point of the feature. "4 sheets are missing" sends somebody back to
    // the index to work out which four, which is the work this saves.
    vi.mocked(checkDrawingIndex).mockResolvedValue({
      ok: true,
      sentence: "The index on page 2 lists 4 sheets. 2 are NOT in what was uploaded: A102, A103.",
      missing: ["A102", "A103"],
      unlisted: [],
      onPage: 2,
    });
    const el = paint({ rows, planId: "plan_1" });
    await act(async () => {
      button(el)?.click();
    });
    const text = el.textContent ?? "";
    expect(text).toContain("A102");
    expect(text).toContain("A103");
    expect(text).toContain("NOT in what was uploaded");
    // And the button is gone, because the answer replaced it.
    expect(button(el)).toBeNull();
  });

  it("SHOWS THE COULD-NOT-READ ANSWER rather than falling silent", async () => {
    // A scanned cover has no text layer. Showing nothing would read as an
    // all-clear, which is the one conclusion that is never safe here.
    vi.mocked(checkDrawingIndex).mockResolvedValue({
      ok: true,
      sentence: "Couldn't read this set's own drawing index — the front pages carry no selectable text.",
      missing: null,
      unlisted: null,
      onPage: null,
    });
    const el = paint({ rows, planId: "plan_1" });
    await act(async () => {
      button(el)?.click();
    });
    expect(el.textContent).toContain("Couldn't read");
  });

  it("shows a refusal as a refusal", async () => {
    vi.mocked(checkDrawingIndex).mockResolvedValue({ ok: false, error: "That plan file couldn't be read just now." });
    const el = paint({ rows, planId: "plan_1" });
    await act(async () => {
      button(el)?.click();
    });
    expect(el.textContent).toContain("couldn't be read just now");
  });

  it("stays away when there is no plan to check", () => {
    expect(button(paint({ rows }))).toBeNull();
  });

  it("leaves the rest of the review alone", () => {
    // The sheet number lives in an input's VALUE, not in page text — the rows
    // are editable. So the row is checked for rather than read.
    const el = paint({ rows, planId: "plan_1" });
    expect(el.querySelector('[data-sheet-review="root"]')).not.toBeNull();
    const values = [...el.querySelectorAll("input")].map((input) => (input as HTMLInputElement).value);
    expect(values).toContain("A100");
  });
});

describe("the call site", () => {
  it("PASSES planId, or the button is on no screen at all", async () => {
    // The #665 shape, one prop deep. Every test above can pass while the single
    // place this component is rendered forgets the prop — so the call site is
    // read directly. A census, deliberately, because the page is a server
    // component with a database query in it and cannot be rendered here.
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    // From the workspace root rather than `import.meta.url`, which vitest does
    // not hand over as a file URL here.
    const source = readFileSync(
      resolve(process.cwd(), "app/(app)/jobs/[id]/(tabs)/takeoff/page.tsx"),
      "utf8",
    );
    const call = /<PlanSheetReview([^/>]*)\/>/.exec(source);
    expect(call, "PlanSheetReview is not rendered on the takeoff page any more").not.toBeNull();
    expect(call?.[1]).toContain("planId=");
  });

  it("COUNTS THE UNREAD PAGES, or the check calls them missing again", async () => {
    // The production bug: reading paused at 21 of 55 sheets and the check
    // named twelve real drawings as NOT IN WHAT WAS UPLOADED. `indexCheck`
    // refuses the comparison when pages are unread — but only if the action
    // tells it how many, and mutation showed the action could pass a constant
    // zero with every test still green.
    //
    // A census, because the action is a Server Action that opens a PDF from
    // blob storage and nothing here can run it. It can see that the counter is
    // called with the page count; it cannot see that the page count is right.
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const action = readFileSync(resolve(process.cwd(), "lib/actions/planSheets.ts"), "utf8");
    expect(action).toContain("unreadPageCount(pages, sheets)");
    expect(action).toContain("planSheetText.count(");
    // And it reaches `indexCheck`, rather than being computed and dropped.
    expect(action).toContain("indexCheck(readDrawingIndex(pageTexts), sheets, unreadPages)");
  });
});
