// @vitest-environment happy-dom

/**
 * What survives a submit on the time-entry form, and what does not.
 *
 * Hours are entered one person at a time off one crew sheet. The form called
 * `form.reset()` on success, which put every field back to its
 * server-rendered default — and the employee select has no default, so it
 * snapped to whoever is first in the company list, while the date went
 * blank. Eight carpenters on a Tuesday meant being asked what day it was
 * eight times, and re-picking a name from a list that had helpfully moved
 * back to the top.
 *
 * Why nothing caught it: `form.reset()` is one call that does the right
 * thing for six fields and the wrong thing for two, and no test rendered
 * this form at all. The assertion that matters is the pair — kept AND
 * cleared — because a test that only checked the date would pass on a form
 * that had simply stopped resetting.
 *
 * Written with createElement rather than JSX because the suite's `include`
 * matches .test.ts and not .test.tsx — same reason as timeEntryRow.test.ts.
 */

import { createElement, type ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = {
  logTimeEntry:
    vi.fn<(jobId: string, formData: FormData) => Promise<{ ok: true } | { ok: false; error: string }>>(),
};

vi.mock("@/lib/actions", () => ({ logTimeEntry: fake.logTimeEntry }));

const { LogTimeEntryForm } = await import("@/components/LogTimeEntryForm");

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
  fake.logTimeEntry.mockReset();
  fake.logTimeEntry.mockResolvedValue({ ok: true });
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

/**
 * Teammates AND crew, which is the whole of the second thing this file now
 * pins. The dropdown used to be built from `User` rows alone, so a crew
 * member — somebody with no login, which is most of a drywall sub's payroll
 * — could not be chosen at all on the one screen the office types hours on.
 * `crew:` / `user:` is the value convention (lib/worker-select.ts).
 */
const workers = [
  { value: "user:ana", label: "Ana Reyes (signs in)" },
  { value: "user:marco", label: "Marco Silva (signs in)" },
  { value: "user:dee", label: "Dee Okonkwo (signs in)" },
  { value: "crew:luis", label: "Luis Ortega (crew)" },
];

function field(name: string) {
  const el = container.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`);
  if (!el) throw new Error(`no field named ${name}`);
  return el;
}

function renderForm() {
  render(
    createElement(LogTimeEntryForm, {
      jobId: "riverside",
      workers,
      lineItems: [{ id: "line-1", description: "05 40 00 — Framing" }],
      craftOptions: [{ id: "craft-1", label: "Carpenter — Journeyman" }],
    }),
  );
}

/** One crew member's day, entered the way a foreman enters it. */
async function logOne(values: Record<string, string>) {
  for (const [name, value] of Object.entries(values)) field(name).value = value;
  const form = container.querySelector("form");
  if (!form) throw new Error("no form");
  act(() => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await act(async () => {});
}

describe("after a time entry is logged", () => {
  it("keeps the employee and the day, and clears everything else", async () => {
    renderForm();
    await logOne({
      worker: "user:marco",
      date: "2026-09-14",
      hours: "8",
      payType: "OVERTIME",
      lineItemId: "line-1",
      craftClassificationId: "craft-1",
      perDiemAmount: "45",
      travelPayAmount: "20",
      note: "Rain hold until 9",
    });

    expect(fake.logTimeEntry).toHaveBeenCalledTimes(1);

    // Kept: the two things the next entry off the same sheet shares.
    expect(field("date").value).toBe("2026-09-14");
    // Not "ana" — which is what a full reset left behind, the first name in
    // the list wearing the confident face of a chosen answer.
    expect(field("worker").value).toBe("user:marco");

    // Cleared: an unseen 8 or a stale per diem carried into the next
    // person's entry is the error this must not make quietly.
    expect(field("hours").value).toBe("");
    expect(field("payType").value).toBe("STRAIGHT");
    expect(field("lineItemId").value).toBe("");
    expect(field("craftClassificationId").value).toBe("");
    expect(field("perDiemAmount").value).toBe("");
    expect(field("travelPayAmount").value).toBe("");
    expect(field("note").value).toBe("");
  });

  it("files the second crew member against the day still on screen", async () => {
    renderForm();
    await logOne({ worker: "user:marco", date: "2026-09-14", hours: "8" });
    // Only the two fields a foreman would actually touch for the next person.
    await logOne({ worker: "crew:luis", hours: "6.5" });

    expect(fake.logTimeEntry).toHaveBeenCalledTimes(2);
    const second = fake.logTimeEntry.mock.calls[1][1];
    expect(second.get("worker")).toBe("crew:luis");
    expect(second.get("date")).toBe("2026-09-14");
    expect(second.get("hours")).toBe("6.5");
  });

  it("keeps nothing when the action refused — the entry was not filed", async () => {
    fake.logTimeEntry.mockResolvedValue({ ok: false, error: "Hours must be a positive number" });
    renderForm();
    await logOne({ worker: "user:marco", date: "2026-09-14", hours: "0" });

    // The whole form stands as typed, with the reason next to it: nothing
    // was reset, so nothing has to be re-entered to fix one field.
    expect(field("hours").value).toBe("0");
    expect(field("worker").value).toBe("user:marco");
    expect(container.textContent).toContain("Hours must be a positive number");
  });
});

/**
 * WHO THE FORM WILL EVEN OFFER — the half nothing tested, and the half that
 * was wrong.
 *
 * The select was built from `User` rows and named `employeeUserId`, so the
 * only people the office could log hours for were people who had completed a
 * Clerk sign-up. A union drywall sub's fifteen to forty field workers have
 * none, and `TimeEntry` has been able to name a crew member since #292 — the
 * phone's API writes it. Hours for a crew member could be entered on site
 * and not from the office, which is where a certified payroll is typed up.
 *
 * Both assertions are needed. A crew option in a select still called
 * `employeeUserId` would post a crew id into a field the action looks up in
 * `User`, which fails as "Employee not found" — a fix that reads correct and
 * behaves exactly like the bug.
 */
describe("who the form offers", () => {
  it("offers crew members, under a field name that admits they are not users", () => {
    renderForm();
    const select = field("worker") as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.value)).toEqual([
      "user:ana",
      "user:marco",
      "user:dee",
      "crew:luis",
    ]);
    expect(container.querySelector('[name="employeeUserId"]')).toBeNull();
  });
});
