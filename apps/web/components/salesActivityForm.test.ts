// @vitest-environment happy-dom

/**
 * `SalesActivityForm` — issue #163, "logging a sales activity looks like it
 * failed".
 *
 * WHAT WAS ACTUALLY WRONG, because the report and the defect are different
 * things. Two separate click-throughs filed this as a LOST UPDATE: you log a
 * call, the form disappears as though it saved, and the activity list behind
 * it still shows what was there before. Neither of them timed it. The row was
 * committed every time — measured in a real browser on production with the
 * clock started on the Save click (CLAUDE.md, "A successful write can show up
 * as an empty list"): the action resolved and the form closed at 1,251 ms,
 * and the list repainted with the new activity at 3,502 ms. So the data was
 * never lost; for 2.25 seconds the screen simply contradicted the thing it
 * had just told you.
 *
 * THE DISCRIMINATOR THIS FILE USES, and why it is the reset rather than the
 * close. `form.reset()` is a synchronous DOM call, so it is observable the
 * instant the old code made it — before any React commit and without
 * flushing an effect. The close is a state update inside a transition, which
 * React schedules; asserting on it alone would be asserting on React's
 * scheduler. So the test resolves the action, lets ONLY the microtask queue
 * run, and looks at what the person typed: still there means nothing has been
 * torn down yet. Against the pre-fix code the textarea is already blank at
 * that point and these tests go red.
 *
 * WHAT IT CANNOT SEE, stated because the distinction is the point — the same
 * bound `components/actionForm.test.ts` records for the shared component. The
 * 2.25-second window only exists when a Server Action's flight response drives
 * a re-render, and there is no server, no flight payload and no repaint in
 * happy-dom. What is pinned here is the ORDERING: nothing is reset and nothing
 * is closed until the transition's own re-render has committed. The browser is
 * the only instrument for the length of the gap, and the click-list step is
 * the proof of it.
 *
 * TWO HARNESS FAILURES ARE RECORDED IN THE SECOND TEST, because each one
 * produced a confident wrong answer first and neither was visible by
 * inspection. A per-batch DOM snapshot could not separate the two commits at
 * all and went red on working code; and the first ordering predicate matched
 * `aria-busy` being ADDED rather than cleared, which made it pass on the very
 * mutant it was written for. Both were settled by mutation — the fix in, then
 * each mutant back — rather than by reasoning about React's scheduler.
 *
 * Written with createElement rather than JSX because the suite's `include`
 * matches .test.ts — same reason as logTimeEntryForm.test.ts.
 */

import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Result = { ok: true } | { ok: false; error: string };

const fake = {
  createSalesActivity: vi.fn<(leadId: string, formData: FormData) => Promise<Result>>(),
  refresh: vi.fn(),
};

vi.mock("@/lib/actions", () => ({ createSalesActivity: fake.createSalesActivity }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: fake.refresh }) }));

const { SalesActivityForm } = await import("@/components/SalesActivityForm");

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
  fake.createSalesActivity.mockReset();
  fake.refresh.mockReset();
  fake.createSalesActivity.mockResolvedValue({ ok: true });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

const TYPED = "Spoke to the PM about the Baker job";

/** Render collapsed, open it with the button a person clicks, and fill in the
 * two fields the action requires. Returns live getters rather than nodes: the
 * form is replaced on every commit this file is about. */
function openForm() {
  act(() => {
    root.render(
      createElement(SalesActivityForm, {
        leadId: "lead-1",
        opportunityOptions: [{ id: "opp-1", label: "Baker Street — drywall" }],
      }),
    );
  });

  const opener = container.querySelector("button")!;
  expect(opener.textContent).toContain("Log an activity");
  act(() => {
    opener.dispatchEvent(new Event("click", { bubbles: true }));
  });

  const summary = container.querySelector<HTMLTextAreaElement>('textarea[name="summary"]')!;
  summary.value = TYPED;

  return {
    form: () => container.querySelector("form"),
    summary: () => container.querySelector<HTMLTextAreaElement>('textarea[name="summary"]'),
    submit: () => container.querySelector<HTMLButtonElement>('button[type="submit"]')!,
    cancel: () => Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Cancel")!,
  };
}

function fireSubmit() {
  act(() => {
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

describe("the form waits for the data, not for the action", () => {
  it("is still open, still holding what was typed, at the moment the action resolves", async () => {
    let finish: (v: Result) => void = () => {};
    fake.createSalesActivity.mockImplementation(
      () => new Promise<Result>((resolve) => (finish = resolve)),
    );

    const ui = openForm();
    fireSubmit();

    // In flight: the form is on screen and the button says so.
    expect(ui.form()).not.toBeNull();
    expect(ui.summary()!.value).toBe(TYPED);

    // Resolve the action and let ONLY the microtask queue run — no React
    // effects flushed. The pre-fix code called reset() and closed the form
    // here, inside the transition body, 2.25 seconds before the saved
    // activity reached the list.
    finish({ ok: true });
    await Promise.resolve();
    await Promise.resolve();
    expect(ui.form(), "closed before the transition settled").not.toBeNull();
    expect(ui.summary()!.value, "cleared before the transition settled").toBe(TYPED);

    // Now settle the transition. This is where the teardown belongs.
    await act(async () => {});
    expect(ui.form()).toBeNull();
    expect(container.querySelector("button")!.textContent).toContain("Log an activity");
  });

  /**
   * THE NARROWER MUTATION THIS CATCHES AND THE RESET ABOVE DOES NOT.
   *
   * The assertion above reads the reset, which is synchronous DOM and so is
   * observable the moment the pre-fix code made it. Moving ONLY the close
   * back inside the transition body — leaving the reset queued — is invisible
   * to it, and was verified to be: that mutation passed every other test in
   * this file. It is not a theoretical shape either. It is what the close
   * being "fixed" by someone who kept the settle ref but wanted the form gone
   * sooner would look like, and in happy-dom it has no other symptom (once
   * the form unmounts `formRef.current` is null, so the queued reset silently
   * stops happening and the remounted textarea is empty regardless).
   *
   * So this reads the COMMIT ORDER instead, which is the user-visible
   * contract: the save finishes — the button stops being busy — while the
   * form is still on screen, and the form closes in a LATER commit. A close
   * fired from inside the transition lands in the same commit that clears
   * `isPending`, so that intermediate frame never exists.
   */
  it("stops being busy while still open, and closes in a later commit", async () => {
    const ui = openForm();

    const form = ui.form()!;
    const save = ui.submit();

    /* The RECORDS, not a snapshot of the DOM after each batch. Inside `act`
       React flushes the passive effect in the same task as the commit that
       triggered it, so both commits are delivered in ONE observer callback —
       a post-state snapshot per batch sees only the end of it, which is how
       the first version of this test failed on working code. The records
       inside a batch are in order, which is the thing being asserted. */
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((batch) => records.push(...batch));
    observer.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeOldValue: true,
    });

    fireSubmit();
    await act(async () => {});
    observer.disconnect();

    expect(ui.form()).toBeNull();

    const closedAt = records.findIndex((r) =>
      Array.from(r.removedNodes).some((n) => n === form || n.contains(form)),
    );
    /* `oldValue === "true"` is load-bearing: the FIRST aria-busy record is the
       attribute being ADDED as the save starts, which sits before the form's
       removal in every arm and made the first version of this assertion pass
       on a mutant. This is the record where it goes away again. */
    const unbusiedAt = records.findIndex(
      (r) =>
        r.type === "attributes" &&
        r.attributeName === "aria-busy" &&
        r.target === save &&
        r.oldValue === "true",
    );

    expect(closedAt, "no mutation ever removed the form").toBeGreaterThan(-1);
    expect(
      unbusiedAt,
      "the save button never stopped being busy while the form was still mounted — " +
        "the form closed in the same commit that ended the transition",
    ).toBeGreaterThan(-1);
    expect(unbusiedAt).toBeLessThan(closedAt);
  });

  it("reopens empty rather than holding the last activity typed", async () => {
    const ui = openForm();
    fireSubmit();
    await act(async () => {});
    expect(ui.form()).toBeNull();

    act(() => {
      container.querySelector("button")!.dispatchEvent(new Event("click", { bubbles: true }));
    });
    expect(ui.summary()!.value).toBe("");
  });

  it("sends what was typed, and refreshes the page it is on", async () => {
    const ui = openForm();
    ui.summary()!.value = "Left a voicemail";
    fireSubmit();
    await act(async () => {});

    expect(fake.createSalesActivity).toHaveBeenCalledTimes(1);
    const [leadId, formData] = fake.createSalesActivity.mock.calls[0]!;
    expect(leadId).toBe("lead-1");
    expect(formData.get("summary")).toBe("Left a voicemail");
    expect(fake.refresh).toHaveBeenCalledTimes(1);
  });
});

describe("the save button, for the whole round trip", () => {
  it("is disabled and aria-busy in flight, and so is Cancel", async () => {
    let finish: (v: Result) => void = () => {};
    fake.createSalesActivity.mockImplementation(
      () => new Promise<Result>((resolve) => (finish = resolve)),
    );

    const ui = openForm();
    expect(ui.submit().disabled).toBe(false);
    expect(ui.submit().getAttribute("aria-busy")).toBeNull();

    fireSubmit();

    // The duplicate-record guard (#19): a second click here is what that
    // change exists to stop, and no create action in this app is idempotent.
    // The two extra seconds the settle gate adds are two more seconds of
    // this button being the only thing standing in the way.
    expect(ui.submit().disabled).toBe(true);
    expect(ui.submit().getAttribute("aria-busy")).toBe("true");
    expect(ui.submit().textContent).toContain("Saving");
    // Cancel too: a Cancel clicked mid-flight would close the form onto
    // stale data by hand, which is the defect through a different door.
    expect(ui.cancel().disabled).toBe(true);

    finish({ ok: true });
    await Promise.resolve();
    await Promise.resolve();
    // Still disabled while the transition settles — the spinner covers the
    // whole gap rather than stopping when the action resolved.
    expect(ui.submit().disabled).toBe(true);
    expect(ui.submit().getAttribute("aria-busy")).toBe("true");

    await act(async () => {});
    expect(ui.form()).toBeNull();
  });
});

describe("a refusal arrives over the fields the person typed", () => {
  it("renders the reason, keeps every field, and stays open", async () => {
    fake.createSalesActivity.mockResolvedValue({
      ok: false,
      error: "The date it happened can't be in the future.",
    });

    const ui = openForm();
    fireSubmit();
    await act(async () => {});

    expect(container.textContent).toContain("can't be in the future");
    expect(ui.form()).not.toBeNull();
    expect(ui.summary()!.value).toBe(TYPED);
    expect(ui.submit().disabled).toBe(false);
    // Nothing was refreshed and nothing closed: there is nothing new to show.
    expect(fake.refresh).not.toHaveBeenCalled();
  });

  it("says something legible when the action throws, and still keeps the fields", async () => {
    fake.createSalesActivity.mockImplementation(async () => {
      throw new Error("boom");
    });

    const ui = openForm();
    fireSubmit();
    await act(async () => {});

    expect(container.textContent).toContain("Could not log this activity");
    expect(container.textContent).not.toContain("boom");
    expect(ui.form()).not.toBeNull();
    expect(ui.summary()!.value).toBe(TYPED);
  });

  it("clears a refusal left over from last time when the retry works", async () => {
    fake.createSalesActivity.mockResolvedValue({ ok: false, error: "A summary is required." });
    const ui = openForm();
    fireSubmit();
    await act(async () => {});
    expect(container.textContent).toContain("A summary is required");

    fake.createSalesActivity.mockResolvedValue({ ok: true });
    fireSubmit();
    await act(async () => {});
    expect(container.textContent).not.toContain("A summary is required");
    expect(ui.form()).toBeNull();
  });
});
