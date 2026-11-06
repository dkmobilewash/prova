// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The welcome screen's AI plan reading switch: it says what reading costs, it
 * starts in the stored state, and a tap posts the same field Settings' takeoff
 * list posts — off sends no field, on sends "on" — and only flips once the
 * action said ok.
 */
const setWallTypesFromDrawings = vi.fn();
vi.mock("@/lib/actions", () => ({ setWallTypesFromDrawings: (form: FormData) => setWallTypesFromDrawings(form) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { PlanReadingSwitch } = await import("./PlanReadingSwitch");
const { PLAN_READING_SENTENCE } = await import("@/lib/ai/features");

let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  setWallTypesFromDrawings.mockReset();
});
afterEach(() => host.remove());

async function render(initialOn: boolean) {
  const root = createRoot(host);
  await act(async () => root.render(createElement(PlanReadingSwitch, { initialOn })));
  return host.querySelector<HTMLButtonElement>('[role="switch"]')!;
}

describe("AI plan reading on the welcome screen", () => {
  it("says what it does and what it costs, with a measured dollar figure", async () => {
    await render(true);
    expect(host.textContent).toContain(PLAN_READING_SENTENCE);
    expect(PLAN_READING_SENTENCE).toMatch(/title blocks and wall legends with AI; about \$\d+\.\d\d per plan set/);
  });

  it("starts on for a new company, and a tap turns it off through the Settings action", async () => {
    setWallTypesFromDrawings.mockResolvedValue({ ok: true });
    const button = await render(true);
    expect(button.getAttribute("aria-checked")).toBe("true");
    await act(async () => button.click());
    const form = setWallTypesFromDrawings.mock.calls[0][0] as FormData;
    expect(form.get("wallTypesFromDrawings")).toBeNull();
    expect(button.getAttribute("aria-checked")).toBe("false");
  });

  it("turning it on posts 'on'; a refusal leaves it where it was and says why", async () => {
    setWallTypesFromDrawings.mockResolvedValue({ ok: false, error: "Only the account owner can turn it on or off." });
    const button = await render(false);
    await act(async () => button.click());
    expect((setWallTypesFromDrawings.mock.calls[0][0] as FormData).get("wallTypesFromDrawings")).toBe("on");
    expect(button.getAttribute("aria-checked")).toBe("false");
    expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/account owner/);
  });
});
