// @vitest-environment happy-dom

/**
 * THE INVITE FORM MUST NOT CLEAR THE BOX BEFORE THE INVITE IS ON SCREEN (#163).
 *
 * This form is the odd one on the #163 sweep and it needed a different
 * instrument, so read the shape before the assertions.
 *
 * It has nothing to close. It sits permanently above the pending-invite
 * list on `/settings`, so there is no collapsible panel and no
 * `setIsOpen(false)` — the CLEARED FIELD IS THE ENTIRE SUCCESS SIGNAL. That
 * makes the early side-effect worse here rather than better: clearing the
 * box when the action resolves says "sent" while the list below it has not
 * grown, and this component's own header records that exact reading going
 * wrong before ("the form reset and the pending list did not grow, with
 * nothing anywhere saying which of the three it was").
 *
 * Production measured the two moments 2.25 s apart — action resolved at
 * 1,251 ms, the row repainted at 3,502 ms.
 *
 * WHY THE INSTRUMENT IS DIFFERENT FROM THE OTHER FIVE. Those read commit
 * ORDER off `MutationObserver` records: `aria-busy` clearing before the
 * record that removes the form. Nothing is removed here, and a form reset
 * is not a mutation record at all — `input.value` is a property, not an
 * attribute, so `MutationObserver` cannot see it in either order.
 *
 * So the ordering is read the other way round: the test asks what
 * `aria-busy` said ON THE DOM at the instant `reset()` was called, by
 * spying on `HTMLFormElement.prototype.reset` and reading the live
 * attribute from inside it. With the gate in place the reset runs from the
 * settle effect, after the commit that ended the transition, so the
 * attribute is already gone. Without it the reset runs inside the
 * transition body while the button is still busy, so the attribute reads
 * `"true"`. One synchronous reading, no mock in the assertion path, and
 * "reset was never called at all" is its own failure rather than a pass.
 *
 * WHAT IT CANNOT SEE. The 2.25-second window itself: that gap exists only
 * when a Server Action's flight response drives a re-render, and there is
 * no server, no flight payload and no repaint in happy-dom. This pins WHERE
 * the reset runs; the browser is the only instrument for how long the wait
 * is.
 */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions", () => ({ inviteTeamMember: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const actions = await import("@/lib/actions");
const { InviteTeamMemberForm } = await import("@/components/InviteTeamMemberForm");

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let container: HTMLDivElement;
let root: Root;
const nativeReset = HTMLFormElement.prototype.reset;

/** What `aria-busy` said at the moment `reset()` ran. `"never"` means it
 * never ran, which is a failure of its own and not a pass. */
let busyAtReset: string | null | "never";

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(actions.inviteTeamMember).mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  busyAtReset = "never";
  HTMLFormElement.prototype.reset = function reset(this: HTMLFormElement) {
    busyAtReset = submitButton()?.getAttribute("aria-busy") ?? null;
    return nativeReset.call(this);
  };
});

afterEach(() => {
  HTMLFormElement.prototype.reset = nativeReset;
  act(() => root.unmount());
  container.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

function render() {
  act(() => root.render(createElement(InviteTeamMemberForm)));
}
function form() {
  return container.querySelector("form")!;
}
function submitButton() {
  return container.querySelector<HTMLButtonElement>('button[type="submit"]');
}
function email() {
  return container.querySelector<HTMLInputElement>('input[name="email"]')!;
}
function fire() {
  form().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

describe("the invite form's reset", () => {
  it("runs after the transition ended, not while the button is still busy", async () => {
    let finish: (v: { ok: true }) => void = () => {};
    vi.mocked(actions.inviteTeamMember).mockImplementation(
      () => new Promise<{ ok: true }>((resolve) => (finish = resolve)),
    );
    render();
    email().value = "dana@northgate.example";

    act(() => fire());
    // The first control, and the reason it is here: `busyAtReset` reads
    // `null` both when the attribute was already cleared and when the
    // button never carried one at all, so without this the assertion below
    // passes on a button with no `aria-busy` on it.
    expect(submitButton()!.getAttribute("aria-busy"), "aria-busy is never set").toBe("true");

    await act(async () => finish({ ok: true }));
    await act(async () => {});

    // The second control: a run where reset never happened would satisfy
    // any claim made about when it happened.
    expect(busyAtReset, "reset() was never called — the invite did not succeed").not.toBe("never");
    // The fix: the attribute was already gone, so the refreshed list had
    // committed before the box was emptied.
    expect(busyAtReset, "reset() ran inside the transition, while the button was still busy").toBeNull();
    expect(email().value).toBe("");
  });

  it("still holds what was typed at the moment the action resolves", async () => {
    let finish: (v: { ok: true }) => void = () => {};
    vi.mocked(actions.inviteTeamMember).mockImplementation(
      () => new Promise<{ ok: true }>((resolve) => (finish = resolve)),
    );
    render();
    email().value = "dana@northgate.example";

    act(() => fire());
    expect(submitButton()!.getAttribute("aria-busy")).toBe("true");
    expect(submitButton()!.disabled).toBe(true);

    // Resolve the action and let only the microtask queue run — no React
    // commit, no effects. The old code cleared the box here.
    finish({ ok: true });
    await Promise.resolve();
    await Promise.resolve();
    expect(
      email().value,
      "the box was emptied while the pending list below it had not grown",
    ).toBe("dana@northgate.example");

    // Now settle the transition. This is where the reset belongs.
    await act(async () => {});
    expect(email().value).toBe("");
  });

  it("keeps the address and says why when the invite is refused", async () => {
    vi.mocked(actions.inviteTeamMember).mockResolvedValue({
      ok: false,
      error: "dana@northgate.example has already been invited.",
    });
    render();
    email().value = "dana@northgate.example";

    await act(async () => fire());
    await act(async () => {});

    expect(container.textContent).toContain("already been invited");
    // Being told what is wrong with a field that has been emptied is the
    // trap `formActionCensus.test.ts` exists for.
    expect(email().value).toBe("dana@northgate.example");
    expect(busyAtReset).toBe("never");
    expect(submitButton()!.getAttribute("aria-busy")).toBeNull();
  });
});
