// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectGroup, ProjectQuestion } from "@/lib/plan-ingest/projectIdentity";
import type { PlanOfWorkQuestion } from "@/lib/plan-ingest/walls";

const choose = vi.fn(async () => ({ ok: true as const }));
const choosePlan = vi.fn(async () => ({ ok: true as const }));
const requested: number[] = [];
vi.mock("@/components/TakeoffSheetTree", () => ({ useThumbnails: () => ({ get: () => undefined, request: (page: number) => requested.push(page) }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/lib/actions", () => ({
  advancePlanIngest: vi.fn(),
  startPlanIngest: vi.fn(),
  wholeSetTakeoffSummary: vi.fn(async () => ({ ok: true, value: [] })),
  chooseUploadProject: (...args: unknown[]) => choose(...(args as [])),
  choosePlanOfWork: (...args: unknown[]) => choosePlan(...(args as [])),
}));
const { WholeSetTakeoffPanel } = await import("./WholeSetTakeoffPanel");

/** One upload, two projects (`projectIdentity.ts`): the panel asks, never picks, and lets the user switch. */
const roots: Root[] = [];
afterEach(() => {
  act(() => roots.splice(0).forEach((r) => r.unmount()));
  document.body.innerHTML = "";
  choose.mockClear();
  choosePlan.mockClear();
  requested.length = 0;
});

const group = (label: string, pages: number[]): ProjectGroup => ({ pages, label, name: null, number: null, lines: [label, "BROOKLYN PARK, MN"], counted: true });
const groups = [group("Project 2019015_EXC-6", [18, 26]), group("KURITA", [66, 67])];
const summary = [18, 26, 66, 67].map((pageNumber, i) => ({ pageNumber, label: `${["A001", "A111", "A101", "A102"][i]} — PLAN`, status: { kind: "pending" as const } }));

function paint(projects: ProjectQuestion | null, planQuestion: PlanOfWorkQuestion | null = null) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(createElement(WholeSetTakeoffPanel, { planId: "p", existing: null, summary, projects, planQuestion })));
  return host;
}

describe("the whole-set panel when one upload holds two projects", () => {
  it("asks which project, offers each with its sheets, pre-selects none, and hides the run until answered", () => {
    const host = paint({ groups, chosen: null });
    expect(host.querySelector('[data-takeoff="which-project"]')?.textContent).toContain("Which one are you bidding?");
    const options = [...host.querySelectorAll('[data-takeoff="choose-project"]')];
    expect(options.map((b) => b.textContent)).toEqual(["Project 2019015_EXC-6BROOKLYN PARK, MN2 sheets: A001, A111", "KURITABROOKLYN PARK, MN2 sheets: A101, A102"]);
    expect(host.querySelector('[data-takeoff="find-walls-everywhere"]')).toBeNull();
    expect(host.querySelector('[aria-pressed="true"], [aria-checked="true"]')).toBeNull();
  });

  it("pressing a project stores THAT project, named by one of its own pages", async () => {
    const host = paint({ groups, chosen: null });
    await act(async () => (host.querySelectorAll('[data-takeoff="choose-project"]')[1] as HTMLButtonElement).click());
    expect(choose).toHaveBeenCalledWith("p", 66);
  });

  it("once answered, the run is back, the choice is said, and the other project can be switched to", async () => {
    const host = paint({ groups, chosen: 0 });
    expect(host.querySelector('[data-takeoff="find-walls-everywhere"]')).not.toBeNull();
    expect(host.querySelector('[data-takeoff="chosen-project"]')?.textContent).toContain("Taking off Project 2019015_EXC-6.");
    expect(host.querySelector('[data-takeoff="chosen-project"]')?.textContent).toContain("KURITA is another project in this upload and is not counted.");
    await act(async () => (host.querySelector('[data-takeoff="switch-project"]') as HTMLButtonElement).click());
    expect(choose).toHaveBeenCalledWith("p", 66);
  });

  it("with no question (flag off, or one project) the panel is today's panel", () => {
    const host = paint(null);
    expect(host.querySelector('[data-takeoff="which-project"]')).toBeNull();
    expect(host.querySelector('[data-takeoff="chosen-project"]')).toBeNull();
    expect(host.querySelector('[data-takeoff="find-walls-everywhere"]')).not.toBeNull();
  });
});

describe("the whole-set panel when the run has no floor plan to count", () => {
  const box = (host: HTMLElement, page: number) => host.querySelector(`[data-takeoff="plan-candidate"][data-page="${page}"]`) as HTMLInputElement;

  it("asks which sheet shows the work, offers each candidate with its picture, ticks none, and hides the run", () => {
    const host = paint({ groups, chosen: 0 }, { candidates: [18, 26], chosen: [] });
    expect(host.querySelector('[data-takeoff="which-plan"]')?.textContent).toContain("Which sheet shows the work?");
    expect([...host.querySelectorAll('[data-takeoff="plan-candidate"]')].map((b) => (b as HTMLInputElement).checked)).toEqual([false, false]);
    expect(host.querySelector('[data-takeoff="which-plan"]')?.textContent).toContain("A111 — PLAN");
    expect(requested.sort()).toEqual([18, 26]);
    expect(host.querySelector('[data-takeoff="find-walls-everywhere"]')).toBeNull();
    expect((host.querySelector('[data-takeoff="count-plan"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it("stores exactly the sheets ticked", async () => {
    const host = paint(null, { candidates: [18, 26], chosen: [] });
    await act(async () => box(host, 26).click());
    await act(async () => (host.querySelector('[data-takeoff="count-plan"]') as HTMLButtonElement).click());
    expect(choosePlan).toHaveBeenCalledWith("p", [26]);
  });

  it("waits while the which-project question is unanswered", () => {
    const host = paint({ groups, chosen: null }, { candidates: [18, 26], chosen: [] });
    expect(host.querySelector('[data-takeoff="which-plan"]')).toBeNull();
    expect(host.querySelector('[data-takeoff="which-project"]')).not.toBeNull();
  });

  it("once answered, says what it counts, brings the run back, and Change reopens the choice with theirs ticked", async () => {
    const host = paint(null, { candidates: [18, 26], chosen: [26] });
    expect(host.querySelector('[data-takeoff="chosen-plan"]')?.textContent).toContain("Counting A111: you named it the plan of the work.");
    expect(host.querySelector('[data-takeoff="find-walls-everywhere"]')).not.toBeNull();
    await act(async () => (host.querySelector('[data-takeoff="change-plan"]') as HTMLButtonElement).click());
    expect(box(host, 26).checked).toBe(true);
    expect(box(host, 18).checked).toBe(false);
  });
});
