// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StoredCalibration } from "@/lib/takeoff-plan";

/**
 * PICKING A STANDARD SCALE IN THE SET-SCALE FORM.
 *
 * A 30-year sub: "architect using 3/16, the measure tools we're using are 1/8 or
 * quarter, so you need to calculate." The picker is a CONFIRMATION like every
 * other offer in this form: one press draws the line the scale stands for and
 * fills the distance and the provenance note, the readback names the scale back
 * through `readScale`, and the person still presses "Set the scale".
 *
 * Rendered as `CalibrationForm` itself, inside a parent that holds the draft the
 * way the viewer does — the whole viewer never learns its page size in
 * happy-dom, because pdf.js does not render there.
 */

vi.mock("@/lib/actions", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  saveTakeoffCalibration: vi.fn(async () => ({ ok: true })),
}));

const { CalibrationForm } = await import("./TakeoffPlanViewer");

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

// ANSI B, 17 x 11 in.
const WIDTH = 17 * 72;
const HEIGHT = 11 * 72;

function Harness({ printedScale, widthPt }: { printedScale: string | null; widthPt: number | null }) {
  const [draft, setDraft] = useState<StoredCalibration | null>(null);
  return createElement(CalibrationForm, {
    jobId: "job_1",
    planId: "plan_1",
    pageNumber: 1,
    pageWidthPt: widthPt,
    pageHeightPt: HEIGHT,
    printedScale,
    existingLabel: "",
    existingNote: "",
    draft,
    prefill: null,
    viewScales: [],
    declineReason: null,
    onUsePrefill: (xs, ys) => setDraft({ x1: xs[0], y1: ys[0], x2: xs[1], y2: ys[1], declaredDistanceFeet: 1 }),
    onSaved: () => {},
  });
}

function paint(printedScale: string | null, widthPt: number | null = WIDTH) {
  act(() => root.render(createElement(Harness, { printedScale, widthPt })));
}

const picker = () => host.querySelector('[data-takeoff="pick-scale"]') as HTMLSelectElement | null;
const use = () => host.querySelector('[data-takeoff="use-picked-scale"]') as HTMLButtonElement | null;
const input = (name: string) => host.querySelector(`input[name="${name}"]`) as HTMLInputElement | null;

function choose(value: string) {
  const select = picker();
  if (!select) throw new Error("no picker");
  act(() => {
    // React tracks the value through the native setter; assigning `.value`
    // directly would be swallowed as "no change".
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("the standard scale picker in the Set-scale form", () => {
  it("is offered beside the printed-dimension path, which stays on screen", () => {
    paint(null);
    expect(picker(), "no scale picker in the Set-scale form").not.toBeNull();
    expect(host.textContent).toContain("Click once at each end of a dimension printed on the drawing.");
    expect(host.textContent).toContain("Exact only if this PDF is printed at 100%");
    // Nothing pre-selected on a sheet that named no scale, and the button
    // cannot apply an empty choice.
    expect(picker()?.value).toBe("");
    expect(use()?.disabled).toBe(true);
  });

  it("offers both families, grouped", () => {
    paint(null);
    const groups = [...host.querySelectorAll("optgroup")].map((group) => group.label);
    expect(groups).toEqual(["Architectural", "Engineering"]);
    const values = [...host.querySelectorAll("option")].map((option) => option.value);
    expect(values).toContain('3/16" = 1\'-0"');
    expect(values).toContain('1" = 40\'');
  });

  it("pre-selects the scale the title block prints, without applying it", () => {
    paint('3/16" = 1\'-0"');
    expect(picker()?.value).toBe('3/16" = 1\'-0"');
    expect(use()?.textContent).toBe('Use 3/16" = 1\'-0"');
    // Pre-selection is not a press: no line, no form yet.
    expect(input("declaredDistanceFeet")).toBeNull();
  });

  it("one press fills the form with a line that reads back as the picked scale — and saves nothing", () => {
    paint(null);
    choose('3/16" = 1\'-0"');
    act(() => use()?.click());
    // 17in of paper at 16/3 ft per inch, over the 90% of the width the line
    // spans: 81.6 ft. Decimal, so nothing is rounded to the inch.
    expect(input("declaredDistanceFeet")?.value).toBe("81.6");
    expect(input("note")?.value).toContain('Picked 3/16" = 1\'-0" from the standard scales');
    expect(input("note")?.value).toContain("Exact only if this PDF is printed at 100%");
    // The readback is the existing one, through `readScale`.
    expect(host.textContent).toContain('that\'s 3/16" = 1\'-0" (1:64)');
    const save = [...host.querySelectorAll("button")].find((b) => b.textContent === "Set the scale");
    expect(save, "the confirming Set the scale button is not on screen").toBeDefined();
    expect(save?.disabled).toBe(false);
  });

  it("is not offered when the page size is unknown, since there is nothing to place a line on", () => {
    paint(null, null);
    expect(picker()).toBeNull();
    expect(host.textContent).toContain("Click once at each end of a dimension printed on the drawing.");
  });
});
