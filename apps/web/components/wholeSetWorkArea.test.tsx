// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

/** Diego's audit order (2026-11-25), coordination/work-area-first.md W5: the whole-set flow asks the same, per sheet. */
const whole = vi.fn(async () => ({ ok: true as const }));
vi.mock("@/components/TakeoffSheetTree", () => ({ useThumbnails: () => ({ get: () => undefined, request: () => {} }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/lib/actions", () => ({
  advancePlanIngest: vi.fn(),
  startPlanIngest: vi.fn(),
  wholeSetTakeoffSummary: vi.fn(async () => ({ ok: true, value: [] })),
  chooseUploadProject: vi.fn(),
  choosePlanOfWork: vi.fn(),
  markWholeSheetNewWork: (...args: unknown[]) => whole(...(args as [])),
}));
const { WholeSetTakeoffPanel } = await import("./WholeSetTakeoffPanel");

const WORDS = "Draw your work area: walls outside it won't be counted";
const walls = { kind: "walls" as const, groups: 4, feet: 300 };
const summary = [
  { pageNumber: 3, label: "A-101 — FLOOR PLAN", renovation: ["(E)"], status: walls },
  { pageNumber: 4, label: "A-102 — FLOOR PLAN", renovation: ["DEMO"], workArea: true, status: walls },
  { pageNumber: 5, label: "A-103 — FLOOR PLAN", status: walls },
];
const roots: Root[] = [];
afterEach(() => {
  act(() => roots.splice(0).forEach((r) => r.unmount()));
  document.body.innerHTML = "";
  whole.mockClear();
});
function paint() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(createElement(WholeSetTakeoffPanel, { planId: "plan_1", jobId: "job_1", existing: null, summary } as never)));
  return host;
}
const row = (host: HTMLElement, page: number) => host.querySelector<HTMLElement>(`[data-takeoff="whole-set-sheet"][data-page="${page}"]`)!;

describe("W5: the whole set asks for each renovation sheet's work area", () => {
  it("an unanswered renovation sheet carries the prompt and both exits; the answered and the new-build ones do not", () => {
    const host = paint();
    const asked = row(host, 3).querySelector<HTMLElement>('[data-takeoff="whole-set-work-area"]');
    expect(asked?.textContent).toContain(WORDS);
    expect(asked?.querySelector("a")?.getAttribute("href")).toBe("/takeoff/job_1?page=3");
    expect(asked?.querySelector("a")?.textContent).toBe("Draw work area");
    expect(asked?.querySelector("button")?.textContent).toBe("Whole sheet is new work");
    expect(row(host, 4).querySelector('[data-takeoff="whole-set-work-area"]')).toBeNull();
    expect(row(host, 5).querySelector('[data-takeoff="whole-set-work-area"]')).toBeNull();
  });
  it("the summary names only the sheets still unanswered", () => {
    const line = paint().querySelector('[data-takeoff="whole-set-renovation"]')?.textContent ?? "";
    expect(line).toContain("A-101");
    expect(line).not.toContain("A-102");
  });
  it("Whole sheet is new work answers that sheet, and its prompt goes", async () => {
    const host = paint();
    await act(async () => void row(host, 3).querySelector<HTMLButtonElement>('[data-takeoff="whole-set-work-area"] button')!.click());
    expect(whole).toHaveBeenCalledWith("plan_1", 3);
    expect(row(host, 3).querySelector('[data-takeoff="whole-set-work-area"]')).toBeNull();
  });
});

describe("W5 follow-up: the row's Whole sheet button says it is working", () => {
  it("disables and reads Saving… while the save runs", async () => {
    let finish: (v: unknown) => void = () => {};
    whole.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)) as never);
    const host = paint();
    await act(async () => void row(host, 3).querySelector<HTMLButtonElement>('[data-takeoff="whole-set-work-area"] button')!.click());
    const busy = row(host, 3).querySelector<HTMLButtonElement>('[data-takeoff="whole-set-work-area"] button')!;
    expect(busy.disabled).toBe(true);
    expect(busy.textContent).toContain("Saving…");
    await act(async () => finish({ ok: true }));
  });
});
