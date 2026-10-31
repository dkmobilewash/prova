// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { TakeoffPlanViewer } from "./TakeoffPlanViewer";

/**
 * Chrome was blocked on Baker EL1.01: an electrical sheet with no scale, and
 * every drawing tool greyed out. A count needs no scale, so its two buttons
 * must be pressable there, and the tools that measure length must not.
 */
function toolbar() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() =>
    root.render(
      createElement(TakeoffPlanViewer, { jobId: "job_1", planId: "plan_1", sheets: [], printedScaleByPage: {}, scannedPages: [], scalePrefillByPage: {}, symbolCount: true } as never),
    ),
  );
  const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
  return { button, done: () => { act(() => root.unmount()); host.remove(); } };
}

describe("the toolbar on a sheet with no scale and no page row", () => {
  it("leaves Count and Count like this pressable, and holds Line and Area back", () => {
    const { button, done } = toolbar();
    const count = button("Count"), like = button("Count like this"), line = button("Line"), area = button("Area");
    expect(count && like && line && area).toBeTruthy();
    expect(count!.disabled).toBe(false);
    expect(like!.disabled).toBe(false);
    expect(line!.disabled).toBe(true);
    expect(area!.disabled).toBe(true);
    expect(line!.title).toBe("Set the scale on this sheet first.");
    done();
  });
});
