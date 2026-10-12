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
  scheduleCrewDay:
    vi.fn<(formData: FormData) => Promise<{ ok: true; value: { message: string } } | { ok: false; error: string }>>(),
  unscheduleCrewDay: vi.fn(),
  saveCrew: vi.fn<(formData: FormData) => Promise<{ ok: true } | { ok: false; error: string }>>(),
};

vi.mock("@/lib/actions", () => ({
  scheduleCrewDay: fake.scheduleCrewDay,
  unscheduleCrewDay: fake.unscheduleCrewDay,
  saveCrew: fake.saveCrew,
  renameCrew: vi.fn(),
  archiveCrew: vi.fn(),
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

function workerBox(value: string) {
  const box = container.querySelector<HTMLInputElement>(`input[name="worker"][value="${value}"]`);
  if (!box) throw new Error(`no worker checkbox ${value}`);
  return box;
}

async function submitWith(values: Record<string, string>) {
  for (const [name, value] of Object.entries(values)) {
    if (name === "worker") workerBox(value).checked = true;
    else field(name).value = value;
  }
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
    expect(workerBox("crew:marco").checked).toBe(true);
    expect(field("workDate").value).toBe("2026-09-30");
    expect(field("craftClassificationId").value).toBe("craft-1");
    expect(field("note").value).toBe("Starts at the hoist");
  });

  it("sends what was on screen, and closes the form when it worked", async () => {
    fake.scheduleCrewDay.mockResolvedValue({ ok: true, value: { message: "saved" } });
    openForm();
    await submitWith(CHOICES);

    const sent = fake.scheduleCrewDay.mock.calls[0][0];
    expect(sent.get("jobId")).toBe("job-b");
    expect(sent.getAll("worker")).toEqual(["crew:marco"]);
    expect(sent.get("workDate")).toBe("2026-09-30");
    expect(container.querySelector("form")).toBeNull();
  });

  // ux medium-B #8: Enter after picking from a select saved the default
  // person on today, with nothing on screen to say so.
  it("does not submit when Enter is pressed in a select", () => {
    openForm();
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    act(() => {
      field("jobId").dispatchEvent(enter);
    });
    expect(enter.defaultPrevented, "Enter in the job select would submit the form").toBe(true);
  });

  // The other half of #8, and #10: say what was saved, and reopen on the
  // job just used rather than the first one in the list.
  it("says what it saved and reopens on the same job", async () => {
    fake.scheduleCrewDay.mockResolvedValue({
      ok: true,
      value: { message: "Marco Silva on Birch Court, Wed, Sep 30 — saved." },
    });
    openForm();
    await submitWith(CHOICES);

    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "Marco Silva on Birch Court, Wed, Sep 30 — saved.",
    );
    const open = [...container.querySelectorAll("button")].find((b) => b.textContent === "Put someone on");
    act(() => open!.click());
    expect(field("jobId").value).toBe("job-b");
  });
});

/**
 * Taking somebody off a day that has already gone by.
 *
 * Until this, Remove existed only on the next-two-weeks list, and the Ask
 * registry excluded `unscheduleCrewDay` on the grounds that removal "is
 * done on /schedule, where the day being removed is visible". Both are
 * reasonable and together they left a hole: a day in the PAST is visible
 * on /schedule — in the gap report — and could not be removed anywhere at
 * all. A plan entered by mistake, or one for a job that was called off,
 * was permanent.
 *
 * The control carries its own argument. This list is a gap report, so the
 * confirmation has to say what removal does NOT do — it unmakes the plan,
 * it does not log the hours — or the button becomes a way to make an
 * awkward gap disappear.
 */
const MISSED = {
  id: "day-7",
  workDate: "2026-09-18",
  jobId: "job-a",
  jobName: "Alder Street",
  worker: "Ana Reyes",
  craft: null,
  note: null,
};

function renderMissing(canWrite: boolean) {
  render(
    createElement(CrewScheduleBoard, {
      upcoming: [],
      missingHours: [MISSED],
      jobs: [{ id: "job-a", name: "Alder Street", clientName: null, status: null }],
      workers: [{ value: "user:ana", label: "Ana Reyes" }],
      crafts: [],
      canWrite,
    }),
  );
}

function buttonSaying(text: string) {
  return [...container.querySelectorAll("button")].find((b) => b.textContent === text);
}

describe("a planned day in the past that nobody logged hours against", () => {
  beforeEach(() => fake.unscheduleCrewDay.mockReset());

  it("can be taken off the schedule, in two steps", async () => {
    fake.unscheduleCrewDay.mockResolvedValue({ ok: true });
    renderMissing(true);

    const remove = buttonSaying("Remove");
    expect(remove, "no way to remove a past planned day").toBeTruthy();
    act(() => remove!.click());

    // Armed, not done: the confirm is a second, different button.
    expect(fake.unscheduleCrewDay).not.toHaveBeenCalled();
    const confirm = buttonSaying("Remove it");
    expect(confirm).toBeTruthy();

    act(() => confirm!.click());
    await act(async () => {});
    expect(fake.unscheduleCrewDay).toHaveBeenCalledWith("day-7");
  });

  it("says what removing it does not do, because this list is a gap report", async () => {
    renderMissing(true);
    // The hint sits on the unarmed control (`describe` -> Hint -> the
    // tooltip node, present in the DOM and revealed on hover or focus),
    // so it is read BEFORE the two-step arms.
    const said = container.querySelector('[role="tooltip"]')?.textContent ?? "";
    expect(said).toContain("Ana Reyes");
    // "Fri, Sep 18", never the raw ISO the row used to print (ux C2).
    expect(said).toContain("Fri, Sep 18");
    // The sentence that keeps this button honest.
    expect(said).toMatch(/records no hours/);
    expect(said).toMatch(/not because the hours were logged/);
  });

  it("is not offered to somebody who cannot change the schedule", () => {
    renderMissing(false);
    expect(buttonSaying("Remove")).toBeFalsy();
    expect(container.textContent).toContain("Ana Reyes");
  });
});

/**
 * A job and nobody to put on it — the dead end getting-started step 5 used
 * to land on. The page hides "Put someone on" while the company has no
 * people (schedule/page.tsx passes canWrite false), so the empty box has to
 * carry the way forward itself: to Team, where crew is added.
 */
describe("the schedule with a job and nobody to put on it", () => {
  function renderEmpty(workers: { value: string; label: string }[]) {
    render(
      createElement(CrewScheduleBoard, {
        upcoming: [],
        missingHours: [],
        jobs: [{ id: "job-a", name: "Alder Street", clientName: null, status: null }],
        workers,
        crafts: [],
        canWrite: workers.length > 0,
      }),
    );
  }

  it("links to Team, where crew is added, instead of ending in a box with nothing to press", () => {
    renderEmpty([]);
    // Anti-vacuity: the empty box itself rendered.
    expect(container.textContent).toContain("Nobody is on the schedule for the next two weeks.");
    const link = container.querySelector<HTMLAnchorElement>('a[href="/team"]');
    expect(link, "no way from the empty schedule to where crew is added").toBeTruthy();
    expect(link!.textContent).toBe("Add your crew on Team");
    expect(buttonSaying("Put someone on")).toBeUndefined();
  });

  it("does not send somebody who already has crew off to Team — they get the button", () => {
    renderEmpty([{ value: "crew:marco", label: "Marco Silva" }]);
    expect(container.textContent).toContain("Nobody is on the schedule for the next two weeks.");
    expect(container.querySelector('a[href="/team"]')).toBeNull();
    expect(buttonSaying("Put someone on")).toBeTruthy();
  });
});

describe("saved crews on the put-someone-on form", () => {
  function openWithCrews() {
    render(
      createElement(CrewScheduleBoard, {
        upcoming: [],
        missingHours: [],
        jobs: [{ id: "job-a", name: "Alder Street", clientName: null, status: null }],
        workers: [
          { value: "user:ana", label: "Ana Reyes" },
          { value: "crew:marco", label: "Marco Silva" },
          { value: "crew:lu", label: "Lu Chen" },
        ],
        crafts: [],
        canWrite: true,
        // "crew:gone" was archived since the crew was saved: it has no box.
        crews: [{ id: "c1", name: "Hangers", members: ["crew:marco", "crew:lu", "crew:gone"] }],
      }),
    );
    const open = [...container.querySelectorAll("button")].find((b) => b.textContent === "Put someone on")!;
    act(() => open.click());
  }

  it("picking a crew ticks exactly its people, and nobody else", () => {
    openWithCrews();
    workerBox("user:ana").checked = true; // ticked by hand before the pick
    const picker = container.querySelector<HTMLSelectElement>('select[aria-label="Crew"]')!;
    act(() => {
      picker.value = "c1";
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(workerBox("crew:marco").checked).toBe(true);
    expect(workerBox("crew:lu").checked).toBe(true);
    expect(workerBox("user:ana").checked).toBe(false);
  });

  it("saves the ticked people under the typed name", async () => {
    fake.saveCrew.mockResolvedValue({ ok: true });
    openWithCrews();
    workerBox("user:ana").checked = true;
    workerBox("crew:lu").checked = true;
    field("crewName").value = "Tapers";
    const save = [...container.querySelectorAll("button")].find((b) => b.textContent === "Save these people as a crew")!;
    await act(async () => save.click());

    const sent = fake.saveCrew.mock.calls[0][0];
    expect(sent.get("crewName")).toBe("Tapers");
    expect(sent.getAll("worker")).toEqual(["user:ana", "crew:lu"]);
    expect(fake.scheduleCrewDay).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Saved crew "Tapers".');
  });
});
