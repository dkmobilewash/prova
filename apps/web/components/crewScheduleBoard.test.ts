// @vitest-environment happy-dom

/**
 * A refused save on the crew schedule must leave the form as the person
 * filled it in.
 *
 * The form was `<form action={(formData) => ...}>`. In React 19 a form
 * `action` resets the form UNCONDITIONALLY, before the action has even run
 * (`startHostTransition` calls `requestFormReset` on the way in, in
 * react-dom-client) — so "they are already on that job that day" arrived
 * next to a form that had snapped back to the first job, the first worker
 * and today. The sentence told you what was wrong with choices that were no
 * longer on screen.
 *
 * Written with createElement rather than JSX because the suite's `include`
 * matches .test.ts and not .test.tsx — same reason as logTimeEntryForm.test.ts.
 */

import { createElement, type ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = {
  scheduleCrewDay: vi.fn<(formData: FormData) => Promise<{ ok: true } | { ok: false; error: string }>>(),
  unscheduleCrewDay: vi.fn(),
};

vi.mock("@/lib/actions", () => ({
  scheduleCrewDay: fake.scheduleCrewDay,
  unscheduleCrewDay: fake.unscheduleCrewDay,
}));

const { CrewScheduleBoard } = await import("@/components/CrewScheduleBoard");

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
  fake.scheduleCrewDay.mockReset();
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

function field(name: string) {
  const el = container.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`);
  if (!el) throw new Error(`no field named ${name}`);
  return el;
}

function openForm() {
  render(
    createElement(CrewScheduleBoard, {
      upcoming: [],
      missingHours: [],
      jobs: [
        { id: "job-a", name: "Alder Street", clientName: null, status: null },
        { id: "job-b", name: "Birch Court", clientName: null, status: null },
      ],
      workers: [
        { value: "user:ana", label: "Ana Reyes" },
        { value: "crew:marco", label: "Marco Silva" },
      ],
      crafts: [{ id: "craft-1", name: "Carpenter" }],
      canWrite: true,
    }),
  );
  const open = [...container.querySelectorAll("button")].find((b) => b.textContent === "Put someone on");
  if (!open) throw new Error("no open button");
  act(() => open.click());
}

async function submitWith(values: Record<string, string>) {
  for (const [name, value] of Object.entries(values)) field(name).value = value;
  const form = container.querySelector("form");
  if (!form) throw new Error("no form");
  act(() => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await act(async () => {});
}

const CHOICES = {
  jobId: "job-b",
  worker: "crew:marco",
  workDate: "2026-09-30",
  craftClassificationId: "craft-1",
  note: "Starts at the hoist",
};

describe("putting someone on the crew schedule", () => {
  it("keeps every choice on screen when the save is refused", async () => {
    fake.scheduleCrewDay.mockResolvedValue({
      ok: false,
      error: "Marco Silva is already on Birch Court that day",
    });
    openForm();
    await submitWith(CHOICES);

    expect(fake.scheduleCrewDay).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Marco Silva is already on Birch Court that day");
    // Each of these is what a reset would have put back: the first job, the
    // first worker, today's date, "Not said", an empty note.
    expect(field("jobId").value).toBe("job-b");
    expect(field("worker").value).toBe("crew:marco");
    expect(field("workDate").value).toBe("2026-09-30");
    expect(field("craftClassificationId").value).toBe("craft-1");
    expect(field("note").value).toBe("Starts at the hoist");
  });

  it("sends what was on screen, and closes the form when it worked", async () => {
    fake.scheduleCrewDay.mockResolvedValue({ ok: true });
    openForm();
    await submitWith(CHOICES);

    const sent = fake.scheduleCrewDay.mock.calls[0][0];
    expect(sent.get("jobId")).toBe("job-b");
    expect(sent.get("worker")).toBe("crew:marco");
    expect(sent.get("workDate")).toBe("2026-09-30");
    expect(container.querySelector("form")).toBeNull();
  });
});
