// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectGroup, ProjectQuestion } from "@/lib/plan-ingest/projectIdentity";

const choose = vi.fn(async () => ({ ok: true as const }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/lib/actions", () => ({
  advancePlanIngest: vi.fn(),
  startPlanIngest: vi.fn(),
  wholeSetTakeoffSummary: vi.fn(async () => ({ ok: true, value: [] })),
  chooseUploadProject: (...args: unknown[]) => choose(...(args as [])),
}));
const { WholeSetTakeoffPanel } = await import("./WholeSetTakeoffPanel");

/** One upload, two projects (`projectIdentity.ts`): the panel asks, never picks, and lets the user switch. */
const roots: Root[] = [];
afterEach(() => {
  act(() => roots.splice(0).forEach((r) => r.unmount()));
  document.body.innerHTML = "";
  choose.mockClear();
});

const group = (label: string, pages: number[]): ProjectGroup => ({ pages, label, name: null, number: null, lines: [label, "BROOKLYN PARK, MN"], counted: true });
const groups = [group("Project 2019015_EXC-6", [18, 26]), group("KURITA", [66, 67])];
const summary = [18, 26, 66, 67].map((pageNumber, i) => ({ pageNumber, label: `${["A001", "A111", "A101", "A102"][i]} — PLAN`, status: { kind: "pending" as const } }));

function paint(projects: ProjectQuestion | null) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(createElement(WholeSetTakeoffPanel, { planId: "p", existing: null, summary, projects })));
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
