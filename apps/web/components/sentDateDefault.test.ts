// @vitest-environment happy-dom

/**
 * What the "Date sent" box says before anybody has typed in it.
 *
 * THE DEFECT. `RfiForm` opened with `sentOn: localToday()` and
 * `SubmittalForm` with `defaultValue={localToday()}`, and directly under
 * each field sat a sentence describing the opposite behaviour — "Blank keeps
 * it a draft", "Blank means it hasn't gone out yet". Blank was never the
 * state either form started in, so the draft path those sentences describe
 * was unreachable unless the user cleared a field they had no reason to
 * think was wrong.
 *
 * WHY IT IS NOT AN EXTRA CLICK. Saving an RFI with a sent date makes it
 * SENT, and both guards in lib/actions/rfis.ts are one-way on purpose:
 * `updateRfi` refuses SENT -> draft (clearing the date is how you would
 * otherwise walk round the delete rule) and `deleteRfi` takes drafts only.
 * So the row offers Record answer and Edit and nothing else, for good —
 * reproduced by clicking a preview on 2026-09-21, which is why RFI 1 on
 * Northgate Clinic TI is still in the demo database. Submittals are the
 * same shape one step along: a sent date creates revision 1, and only a
 * NOT_SENT submittal can be deleted. And the date itself is the evidence —
 * days-outstanding on a delay claim is computed from it, so an office
 * writing up a question on Monday that has not left the building starts a
 * clock on a day nothing happened.
 *
 * THE THIRD CASE IS THE POINT OF THE FILE. "No `localToday()` on a sent
 * date" is the WRONG rule and a blanket sweep would have shipped it.
 * `SubmittalRow`'s send form is reached by clicking "Record as sent" —
 * sending IS the action the user just chose, the field is `required`, and
 * today is the correct default there. Asserting all three together is what
 * stops the next person fixing this "properly" in both directions.
 *
 * The value is read off the rendered DOM rather than off the source, and
 * every query throws when it finds nothing: a test that silently matched no
 * input would pass on a form that had stopped rendering the field at all.
 *
 * createElement rather than JSX because the suite's `include` matches
 * .test.ts and not .test.tsx — same reason as logTimeEntryForm.test.ts.
 */

import { createElement, type ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const noop = vi.fn(async () => ({ ok: true as const }));

vi.mock("@/lib/actions", () => ({
  createRfi: noop,
  settleAskDraft: noop,
  createSubmittal: noop,
  updateRfi: noop,
  deleteRfi: noop,
  answerRfi: noop,
  markRfiSent: noop,
  setRfiClosed: noop,
  updateSubmittal: noop,
  deleteSubmittal: noop,
  recordSubmittalResponse: noop,
  sendSubmittalRevision: noop,
}));

const { RfiForm } = await import("@/components/RfiForm");
const { SubmittalForm } = await import("@/components/SubmittalForm");
const { RfiRow } = await import("@/components/RfiRow");
const { SubmittalRow } = await import("@/components/SubmittalRow");
const { localToday } = await import("@/components/localToday");

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
  // useFormDraft restores a stored draft when the form element attaches,
  // which would overwrite a default with whatever a previous case typed.
  window.localStorage.clear();
  window.sessionStorage.clear();
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

/** Throws rather than returning null — see the header. */
function sentDateInput(): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>('input[name="sentOn"]');
  if (!el) throw new Error('no input named "sentOn" rendered');
  return el;
}

/** The button whose visible text is exactly `label`. Throws if absent. */
function clickButton(label: string) {
  const button = [...container.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === label,
  );
  if (!button) {
    throw new Error(
      `no button labelled "${label}" — found: ${[...container.querySelectorAll("button")]
        .map((b) => `"${b.textContent?.trim()}"`)
        .join(", ")}`,
    );
  }
  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

const jobs = [{ id: "job-1", name: "Tower B", status: "ACTIVE", clientName: "Bell GC" }];

const rfi = {
  id: "rfi-1",
  number: 1,
  jobName: "Tower B",
  subject: "Head of wall at grid 4",
  question: "Which detail governs?",
  drawingReference: "A-501",
  specSection: "09 21 16",
  status: "SENT",
  sentOn: "2026-09-08",
  dueBy: "2026-09-15",
  answeredOn: "2026-09-11",
  answer: "Use detail 4/A-501.",
  costImpact: false,
  scheduleImpact: false,
  askedByName: "Tester",
};

const unsentSubmittal = {
  id: "sub-1",
  number: 1,
  jobName: "Tower B",
  title: "Track and stud data",
  description: null,
  specSection: "09 22 16",
  drawingReference: null,
  submittedByName: "Tester",
  revisions: [],
};

const sentSubmittal = {
  ...unsentSubmittal,
  id: "sub-2",
  number: 2,
  revisions: [
    {
      revisionNumber: 1,
      sentOn: "2026-09-01",
      dueBack: "2026-09-08",
      returnedOn: null,
      outcome: null,
      responseNotes: null,
    },
  ],
};

describe("a new record does not claim to have been sent", () => {
  it("opens the RFI form with Date sent blank", () => {
    render(createElement(RfiForm, { jobs }));
    clickButton("Raise an RFI");
    expect(sentDateInput().value).toBe("");
  });

  it("opens the submittal form with Date sent blank", () => {
    render(createElement(SubmittalForm, { jobs }));
    clickButton("Log a submittal");
    expect(sentDateInput().value).toBe("");
  });

  it("still defaults today when the user has explicitly chosen to send", () => {
    // The differential. Same field name, same component family, opposite
    // correct answer — this is "Record as sent" on a NOT_SENT submittal,
    // where the send is the action already chosen and the field is
    // `required`. A sweep that removed localToday() everywhere fails here.
    render(
      createElement(SubmittalRow, {
        submittal: unsentSubmittal,
        today: "2026-09-21",
        canDelete: true,
        showJob: false,
      }),
    );
    clickButton("Record as sent");
    const input = sentDateInput();
    expect(input.required).toBe(true);
    expect(input.value).toBe(localToday());
  });
});

describe("a stored calendar day reads the way the rest of the app writes one", () => {
  it("renders an RFI's dates as Sep 8, 2026 and not as 2026-09-08", () => {
    render(
      createElement(RfiRow, { rfi, today: "2026-09-21", canDelete: true, showJob: false }),
    );
    const text = container.textContent ?? "";
    expect(text).toContain("sent Sep 8, 2026");
    expect(text).toContain("due Sep 15, 2026");
    expect(text).toContain("answered Sep 11, 2026");
    // The raw ISO form is gone, not merely joined by a formatted one.
    expect(text).not.toContain("2026-09-08");
    expect(text).not.toContain("2026-09-15");
    expect(text).not.toContain("2026-09-11");
  });

  it("renders a submittal revision's dates the same way", () => {
    render(
      createElement(SubmittalRow, {
        submittal: sentSubmittal,
        today: "2026-09-21",
        canDelete: true,
        showJob: false,
      }),
    );
    const text = container.textContent ?? "";
    expect(text).toContain("sent Sep 1, 2026");
    expect(text).toContain("due back Sep 8, 2026");
    expect(text).not.toContain("2026-09-01");
    expect(text).not.toContain("2026-09-08");
  });
});
