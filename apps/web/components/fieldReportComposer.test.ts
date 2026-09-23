// @vitest-environment happy-dom

/**
 * What the job select is actually set to when a foreman opens "Log a day".
 *
 * field-report-jobs.test.ts pins the RULE; this pins that the component
 * obeys it, which is the claim that was false for as long as the rule lived
 * as `jobs[0]?.id` inside the component. Rendering it is the only way to see
 * the select's value: the default is state, not markup a source scan can
 * read, and the option that is selected is decided at runtime.
 *
 * Written with createElement rather than JSX because the suite's `include`
 * matches .test.ts and not .test.tsx — same reason as timeEntryRow.test.ts.
 *
 * What this cannot see: layout, and what the browser does with `required` on
 * a select whose selected option has an empty value. happy-dom does not run
 * constraint validation on submit, so the placeholder's blocking behaviour
 * is asserted here through the component's own guard (the error sentence),
 * not through the browser's.
 */

import { createElement, type ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = {
  createDailyFieldReport:
    vi.fn<(jobId: string, formData: FormData) => Promise<{ ok: true } | { ok: false; error: string }>>(),
};

vi.mock("@/lib/actions", () => ({ createDailyFieldReport: fake.createDailyFieldReport }));

const { FieldReportComposer } = await import("@/components/FieldReportComposer");
type JobChoice = import("@/components/FieldReportComposer").JobChoice;

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  fake.createDailyFieldReport.mockReset();
  fake.createDailyFieldReport.mockResolvedValue({ ok: true });
  sessionStorage.clear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

function render(node: ReactNode) {
  act(() => {
    root.render(node);
  });
}

const job = (id: string, name: string, status: string): JobChoice => ({
  id,
  name,
  status,
  clientName: "Brackett Construction",
});

/** The alphabetical trap, in the order the page supplies it (name asc): an
 * estimate sorts first, the job the crew is actually on sorts second. */
const ALPHABETICAL_TRAP = [
  job("aspen", "Aspen Court — estimate", "ESTIMATE"),
  job("riverside", "Riverside Tower", "IN_PROGRESS"),
  job("zinc", "Zinc Building", "COMPLETE"),
];

/** Opens the collapsed form and returns the job select. */
function openComposer(jobs: JobChoice[], defaultJobId?: string) {
  render(createElement(FieldReportComposer, { jobs, defaultJobId }));
  const button = container.querySelector("button");
  act(() => {
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  const select = container.querySelector<HTMLSelectElement>('select[name="jobId"]');
  if (!select) throw new Error("no job select rendered");
  return select;
}

describe("the job the form opens on", () => {
  it("is the one active job, not the alphabetically first one", () => {
    const select = openComposer(ALPHABETICAL_TRAP);
    expect(select.value).toBe("riverside");
  });

  it("is blank when two jobs are running, and says why", () => {
    const select = openComposer([
      job("riverside", "Riverside Tower", "IN_PROGRESS"),
      job("lakeshore", "Lakeshore Phase 2", "CONTRACTED"),
    ]);
    expect(select.value).toBe("");
    expect(select.querySelector("option")?.textContent).toContain("Choose a job");
    expect(container.textContent).toContain("Nothing is preselected");
  });

  it("is blank when nothing is running, rather than a closed job", () => {
    const select = openComposer([
      job("aspen", "Aspen Court", "ESTIMATE"),
      job("zinc", "Zinc Building", "COMPLETE"),
    ]);
    expect(select.value).toBe("");
  });

  it("offers no placeholder option once a job could be chosen for you", () => {
    const select = openComposer(ALPHABETICAL_TRAP);
    expect([...select.options].map((o) => o.value)).toEqual(["aspen", "riverside", "zinc"]);
  });

  it("starts on the page's filtered job, whatever its status", () => {
    const select = openComposer(ALPHABETICAL_TRAP, "zinc");
    expect(select.value).toBe("zinc");
  });

  it("still lists every job, so a late report can be filed against a closed one", () => {
    const select = openComposer(ALPHABETICAL_TRAP);
    expect([...select.options].map((o) => o.value)).toContain("zinc");
  });
});

describe("filing it", () => {
  function fillAndSubmit(select: HTMLSelectElement) {
    const form = select.closest("form");
    if (!form) throw new Error("select is not in a form");
    const work = form.querySelector<HTMLTextAreaElement>('[name="workPerformed"]');
    if (work) work.value = "Hung rock, levels 3 and 4";
    act(() => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    return form;
  }

  it("files against the job on screen", async () => {
    const select = openComposer(ALPHABETICAL_TRAP);
    fillAndSubmit(select);
    await act(async () => {});
    expect(fake.createDailyFieldReport).toHaveBeenCalledTimes(1);
    expect(fake.createDailyFieldReport.mock.calls[0][0]).toBe("riverside");
  });

  it("refuses to file at all when no job was chosen", async () => {
    const select = openComposer([
      job("riverside", "Riverside Tower", "IN_PROGRESS"),
      job("lakeshore", "Lakeshore Phase 2", "CONTRACTED"),
    ]);
    fillAndSubmit(select);
    await act(async () => {});
    // Not "filed against the first job" and not a thrown error the browser
    // would redact — a sentence, and nothing sent.
    expect(fake.createDailyFieldReport).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Choose which job this report is for.");
  });
});
