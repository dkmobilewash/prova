// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SheetPager } from "./TakeoffPlanViewer";

/**
 * JUMPING TO A SHEET INSTEAD OF WALKING TO IT.
 *
 * ── WHAT THIS IS FOR, MEASURED BEFORE IT WAS BUILT ──
 *
 * A press count of all nine estimating steps on one real bid put reaching
 * `A-101` on a 52-sheet set at TWENTY presses of Next, and the pager read
 * "Sheet 23 of 52" — a position in the file, not the sheet's own number — so
 * all twenty were blind. Largest single number in the count, and the only one
 * that was navigation rather than a decision somebody has to make.
 *
 * ── A RENDER TEST, AND WHY IT HAS TO BE ──
 *
 * The #665 lesson, which `ClusterTag`'s test beside this one states: a census
 * proves the code is there and only rendering proves somebody can reach it.
 * This repo has paid for that twice over in one sitting — a control that
 * existed, called the right action and appeared on no screen (#665), and three
 * expo-router header fixes that shipped green and rendered nothing. Here the
 * specific risk is narrow and real: the picker lives behind
 * `pageCount !== null && pageCount > 1`, so a wrong condition hides it on every
 * set and nothing about the label function would notice.
 *
 * It cannot mount the viewer: the pager renders only once pdf.js has reported a
 * page count, and pdf.js never runs in happy-dom. That is why the control is
 * its own exported component.
 *
 * NO TEST HERE CAN SEE LAYOUT — happy-dom does no layout and returns zeros from
 * `getBoundingClientRect`, per CLAUDE.md. So nothing below asserts where the
 * control sits or how wide it is; that is the click-list's job.
 *
 * ── ONE MUTATION THIS FILE DOES NOT CATCH, RECORDED RATHER THAN PAPERED OVER ──
 *
 * Putting `hidden` on the Next button leaves every test here green: happy-dom
 * still returns it from `querySelectorAll`, still reports `disabled`, and still
 * dispatches its click, because visibility is a layout question and there is no
 * layout. DELETING the button is caught, and so is inverting or unbounding
 * either direction — so what is unguarded is specifically an attribute that
 * hides a control which is otherwise wired correctly.
 *
 * No assertion is added for it. A `not.toHaveAttribute("hidden")` on two
 * buttons would pass by matching this one mutation and would say nothing about
 * the next way a control gets hidden — the same reason `scaleBar.ts` keeps its
 * zero check recorded as redundant and `sheetNumber.ts` keeps its type-size
 * sort recorded as unproven, instead of either growing a fixture to make a
 * mutation red. Visibility is what the click-list is for.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let host: HTMLElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

/** The jumps the control asked for, in order, so a press is checked by what it
 *  requested rather than by a repaint this harness cannot produce. */
function paint(
  props: Partial<Parameters<typeof SheetPager>[0]> & { pageCount: number },
): { jumps: number[]; picker: HTMLSelectElement; buttons: HTMLButtonElement[] } {
  const jumps: number[] = [];
  act(() =>
    root.render(
      createElement(SheetPager, {
        pageNumber: 1,
        sheetLabelByPage: {},
        onJump: (page: number) => jumps.push(page),
        ...props,
      }),
    ),
  );
  const picker = host.querySelector<HTMLSelectElement>('select[data-takeoff="sheet-picker"]')!;
  return { jumps, picker, buttons: [...host.querySelectorAll("button")] };
}

function pick(picker: HTMLSelectElement, value: string) {
  act(() => {
    picker.value = value;
    picker.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("the picker is on the screen and reaches every sheet", () => {
  it("renders one option per page, so none is reachable only by Next", () => {
    const { picker } = paint({ pageCount: 52 });
    expect(picker).not.toBeNull();
    expect(picker.options).toHaveLength(52);
    expect([...picker.options].map((o) => o.value)).toEqual(
      Array.from({ length: 52 }, (_, i) => String(i + 1)),
    );
  });

  it("names the sheets it has numbers for", () => {
    const { picker } = paint({
      pageCount: 3,
      sheetLabelByPage: { 2: "A-101 · First floor plan" },
    });
    expect([...picker.options].map((o) => o.textContent)).toEqual([
      "Sheet 1",
      "A-101 · First floor plan",
      "Sheet 3",
    ]);
  });

  it("KEEPS an unread page in the list, with the pager's old wording", () => {
    // A scanned sheet has no proposal row, so nothing reads a number off it.
    // Listing only the named sheets would leave it reachable by nothing but
    // Prev and Next — the control this replaces.
    const { picker } = paint({ pageCount: 2, sheetLabelByPage: { 1: "G-001 · Cover" } });
    expect(picker.options[1]!.textContent).toBe("Sheet 2");
    pick(picker, "2");
  });

  it("asks for the page that was chosen — the twenty presses becoming one", () => {
    const { jumps, picker } = paint({ pageCount: 52, pageNumber: 1 });
    pick(picker, "21");
    expect(jumps).toEqual([21]);
  });

  it("shows the open sheet as the current value, not a placeholder", () => {
    const { picker } = paint({ pageCount: 52, pageNumber: 23 });
    expect(picker.value).toBe("23");
  });

  it("still says how big the set is", () => {
    paint({ pageCount: 52 });
    expect(host.textContent).toContain("of 52");
  });

  it("is labelled for a screen reader, since the control shows no text of its own", () => {
    const { picker } = paint({ pageCount: 3 });
    expect(picker.closest("label")?.textContent).toContain("Jump to a sheet");
  });
});

describe("Prev and Next are not taken away", () => {
  // Reading a set is often "the next sheet", and a picker is the wrong shape
  // for that. The jump is an addition.

  it("steps one either way", () => {
    const { jumps, buttons } = paint({ pageCount: 52, pageNumber: 23 });
    const [prev, next] = buttons;
    act(() => prev!.click());
    act(() => next!.click());
    expect(jumps).toEqual([22, 24]);
  });

  it("refuses to walk off either end", () => {
    const first = paint({ pageCount: 52, pageNumber: 1 });
    expect(first.buttons[0]!.disabled).toBe(true);
    expect(first.buttons[1]!.disabled).toBe(false);

    const last = paint({ pageCount: 52, pageNumber: 52 });
    expect(last.buttons[0]!.disabled).toBe(false);
    expect(last.buttons[1]!.disabled).toBe(true);
  });
});

describe("and the viewer actually mounts it", () => {
  /**
   * THE RENDER TEST ABOVE CANNOT SEE THIS, and that gap is the whole reason
   * this block exists. It renders `SheetPager` directly, so it proves the
   * control works GIVEN that something renders it — and the pager sits behind
   * `pageCount !== null && pageCount > 1` in the viewer, where a wrong
   * condition would hide it on every set with all nine tests above still green.
   * That is the #665 shape exactly: right code, right branch, no screen.
   *
   * COMMENTS ARE STRIPPED FIRST, which is not decoration: this component's own
   * docblock quotes the position-only wording it replaced, so a census over raw
   * text would find the old control and call it present. CLAUDE.md names this
   * one twice — "the better the comment, the more likely it contains the string
   * you are forbidding" — and `clerkMountGate.test.ts` strips for the same
   * reason.
   */
  const source = (() => {
    const raw = readFileSync(resolve(__dirname, "TakeoffPlanViewer.tsx"), "utf8");
    return raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  })();

  it("PARSED SOMETHING — so a broken strip fails loudly instead of passing", () => {
    // The other half of the deriving-check rule: assert the set you reasoned
    // about is not empty, against something that cannot drift with the search.
    expect(source.length).toBeGreaterThan(20_000);
    expect(source).toContain("export function TakeoffPlanViewer");
    expect(source).toContain("export function SheetPager");
  });

  it("renders the pager, and hands it the page it is on", () => {
    expect(source).toMatch(/<SheetPager\s/);
    expect(source).toMatch(/pageNumber=\{pageNumber\}/);
    expect(source).toMatch(/onJump=\{setPageNumber\}/);
    expect(source).toMatch(/sheetLabelByPage=\{sheetLabelByPage\}/);
  });

  it("GATES IT ON A REAL PAGE COUNT, which mounting it does not prove", () => {
    // ── A MUTATION GOT PAST THE ASSERTION ABOVE, WHICH IS WHY THIS EXISTS ──
    //
    // Changing the viewer's guard to `pageCount > 10_000` hides the picker on
    // every set there will ever be, and every other test in this file stayed
    // GREEN: the control is still mounted, still correct, still rendered by the
    // viewer — just never for a real drawing. "Is it mounted" and "is it
    // mounted when somebody has a drawing open" are different questions, and
    // only the first was being asked.
    //
    // Pinned as the literal guard rather than a parsed bound, because the thing
    // that broke was the COMPARISON and a looser assertion would have passed it
    // too. `pageCount > 1` is also the correct bound on its own terms: a
    // one-sheet plan has nowhere to jump to.
    expect(source).toContain("{pageCount !== null && pageCount > 1 && (");
  });

  it("no longer prints the position-only wording it replaced", () => {
    // That wording as plain text WAS the control. If it comes back outside a
    // comment, somebody has reinstated it beside the picker.
    expect(source).not.toMatch(/Sheet \{pageNumber\} of \{pageCount\}/);
  });
});
