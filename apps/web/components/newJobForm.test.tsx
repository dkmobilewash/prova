// @vitest-environment happy-dom

/**
 * Enter in the GC picker, or in the add-a-GC boxes, must not start the job.
 * UX test 2026-10-11: pressing Enter to choose the GC submitted the whole
 * form. Enter in Job name still does — that is the normal way to submit.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions", () => ({ createJob: vi.fn() }));
const { NewJobForm } = await import("@/components/NewJobForm");

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
  act(() => root.render(<NewJobForm contacts={[{ id: "c1", name: "Turner", email: null, jobCount: 2 }]} />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** True when the keydown's default — implicit submission — was cancelled. */
function enterBlocked(selector: string): boolean {
  const el = container.querySelector(selector)!;
  const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  act(() => {
    el.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

describe("Enter on the new-job form", () => {
  it("does not submit from the GC picker", () => {
    expect(enterBlocked('select[name="contactId"]')).toBe(true);
  });

  it("does not submit from the add-a-GC boxes, but still presses the toggle button", () => {
    const toggle = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "+ Add a new GC")!;
    expect(enterBlocked("button[type=button]")).toBe(false);
    act(() => toggle.click());
    expect(enterBlocked('input[name="contactName"]')).toBe(true);
    expect(enterBlocked('input[name="contactEmail"]')).toBe(true);
  });

  it("still submits from Job name", () => {
    expect(enterBlocked('input[name="jobName"]')).toBe(false);
  });
});
