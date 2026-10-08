// @vitest-environment happy-dom

/**
 * THE ADD-A-CONTACT FORM MUST NOT CLOSE BEFORE THE CONTACT IS ON SCREEN (#163).
 *
 * Measured on production with the clock started on the Save click: the
 * action resolved and the form closed at 1,251 ms, and the row behind it
 * repainted with the saved value at 3,502 ms. For 2.25 seconds the form
 * was gone — which reads as "it saved" — while the list behind it still
 * showed the old contacts. Two separate click-throughs reported that as a
 * lost update. Nothing is ever lost; the screen contradicts itself. The
 * standing-terms half of this form makes a re-submit expensive: #218 put
 * a GC's retainage percent and payment terms on it, and no create action
 * in this app is idempotent.
 *
 * WHAT THIS TEST ASSERTS, AND WHY IT IS COMMIT ORDER RATHER THAN A CALL
 * COUNT. Reverting the whole fix reds any obvious test. Moving back ONLY
 * `setIsOpen(false)` — leaving the reset queued — passes everything written
 * the obvious way, because once the form unmounts `formRef.current` is null,
 * so the queued reset silently stops happening and the remounted fields are
 * empty regardless. There is no symptom to assert in happy-dom.
 *
 * What does separate them is the ORDER OF THE COMMITS, read off
 * `MutationObserver` records. With the gate in place the transition ends
 * first — `aria-busy` is cleared on the submit button while the form is
 * still mounted — and only the settle effect after it takes the form away.
 * Without it the close rides inside the transition, so the form is removed
 * in the same commit that ends it and the button's `aria-busy` is never
 * cleared at all: the node is gone instead. The discriminator is therefore
 * that a record CLEARING `aria-busy` exists, and precedes the record
 * removing the form.
 *
 * `oldValue === "true"` is load-bearing on that predicate. A record for
 * `aria-busy` being ADDED also matches `attributeName === "aria-busy"`, and
 * a predicate without the direction check passes on the very mutant it was
 * written for. Hence `attributeOldValue: true`, plus an explicit assertion
 * that the ADD is seen and comes first — so the instrument is proved able
 * to tell the two directions apart in the same run that reads them.
 *
 * The second test catches the mirror-image mutant the ordering test cannot:
 * the reset left inline while the close is queued. That blanks the fields
 * at 1.25 s with the form still on screen until 3.5 s, which trades one
 * wrong frame for another.
 *
 * WHAT IT CANNOT SEE. The 2.25-second window itself. That gap exists only
 * when a Server Action's flight response drives a re-render, and there is
 * no server, no flight payload and no repaint in happy-dom. This pins WHERE
 * the side-effects run; the browser is the only instrument for how long the
 * wait is.
 */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions", () => ({ createContact: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const actions = await import("@/lib/actions");
const { ContactForm } = await import("@/components/ContactForm");

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let container: HTMLDivElement;
let root: Root;
let observer: MutationObserver;
let records: MutationRecord[] = [];

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(actions.createContact).mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  records = [];
  // One flat, ordered list rather than a per-batch snapshot: the two commits
  // may or may not land in the same microtask, and a per-batch reading
  // cannot order them when they do.
  observer = new MutationObserver((rs) => records.push(...rs));
});

afterEach(() => {
  observer.disconnect();
  act(() => root.unmount());
  container.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

function open() {
  act(() => root.render(createElement(ContactForm)));
  act(() => container.querySelector("button")!.click());
}

function form() {
  return container.querySelector("form");
}
function submitButton() {
  return container.querySelector<HTMLButtonElement>('button[type="submit"]');
}
function typed() {
  return container.querySelector<HTMLInputElement>('input[name="name"]')!;
}

function watch() {
  observer.observe(container, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["aria-busy"],
    attributeOldValue: true,
  });
}

/** Everything the observer has, in order, including anything still queued. */
function seen() {
  records.push(...observer.takeRecords());
  return records;
}

const busyAdded = (r: MutationRecord) =>
  r.type === "attributes" && r.attributeName === "aria-busy" && r.oldValue === null;
const busyCleared = (r: MutationRecord) =>
  r.type === "attributes" && r.attributeName === "aria-busy" && r.oldValue === "true";
const formRemoved = (r: MutationRecord) =>
  r.type === "childList" &&
  Array.from(r.removedNodes).some((n) => (n as HTMLElement).tagName === "FORM");

function fire() {
  form()!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

describe("the add-a-contact form's success side-effects", () => {
  it("clears aria-busy while the form is still mounted, and only then closes it", async () => {
    vi.mocked(actions.createContact).mockResolvedValue({ ok: true });
    open();
    typed().value = "Northgate Construction";
    watch();

    await act(async () => fire());
    await act(async () => {});

    const rs = seen();
    const added = rs.findIndex(busyAdded);
    const cleared = rs.findIndex(busyCleared);
    const closed = rs.findIndex(formRemoved);

    // The instrument's own controls. A run that saw neither event would
    // otherwise satisfy any ordering claim made about them.
    expect(added, "aria-busy was never set — the button is not wired").toBeGreaterThanOrEqual(0);
    expect(closed, "the form never closed — the save did not succeed").toBeGreaterThanOrEqual(0);
    expect(cleared, "aria-busy never cleared: the form was removed inside the transition").toBeGreaterThanOrEqual(0);

    // The direction check, proved rather than assumed: the ADD is a
    // different record from the CLEAR and comes first.
    expect(added).toBeLessThan(cleared);
    // The fix: the transition ended before the form was taken away.
    expect(cleared).toBeLessThan(closed);
  });

  it("has run no side-effect at the moment the action resolves", async () => {
    let finish: (v: { ok: true }) => void = () => {};
    vi.mocked(actions.createContact).mockImplementation(
      () => new Promise<{ ok: true }>((resolve) => (finish = resolve)),
    );
    open();
    typed().value = "Northgate Construction";

    act(() => fire());
    expect(submitButton()!.getAttribute("aria-busy")).toBe("true");

    // Resolve the action and let only the microtask queue run — no React
    // commit, no effects. The old code reset and closed here.
    finish({ ok: true });
    await Promise.resolve();
    await Promise.resolve();
    expect(form(), "the form closed inside the transition body").not.toBeNull();
    expect(
      typed().value,
      "the fields were blanked while the form was still on screen",
    ).toBe("Northgate Construction");

    // Now settle the transition. This is where both belong.
    await act(async () => {});
    expect(form()).toBeNull();
  });

  it("keeps the form open and the typed values when the action refuses", async () => {
    vi.mocked(actions.createContact).mockResolvedValue({ ok: false, error: "A contact needs a name." });
    open();
    typed().value = "Northgate Construction";

    await act(async () => fire());
    await act(async () => {});

    expect(container.textContent).toContain("A contact needs a name.");
    expect(form()).not.toBeNull();
    expect(typed().value).toBe("Northgate Construction");
    expect(submitButton()!.getAttribute("aria-busy")).toBeNull();
  });
});
