// @vitest-environment happy-dom

/**
 * DOES SAVING THE COMPANY RECORD STILL WORK?
 *
 * Nothing asked that until now. `companyPointer.test.ts` reads this file as
 * a STRING — it checks that the prose pointing people here still matches the
 * heading — and there is no e2e spec on this screen. So the only coverage
 * this form had could not tell a working save from a dead button.
 *
 * That mattered on 2026-09-25, when issue #311 rewired it. It submitted
 * through `<form action={handleSubmit}>`, and React 19 calls
 * `requestFormReset` UNCONDITIONALLY before running a form's `action` —
 * it does not wait to hear whether the save worked. So point 2 of
 * `CompanyProfileForm.tsx`'s own header was only half true: the refusal did
 * come back as data and was rendered, and by the time it rendered every
 * field it was about had snapped back to its placeholder. On THIS form that
 * is the EIN and the licence numbers somebody had just copied off an IRS
 * letter, wiped under a sentence saying one of them was wrong.
 *
 * It is `onSubmit` + `preventDefault()` + `new FormData(event.currentTarget)`
 * now, and the three ways a hand-rolled submit handler fails are all silent:
 * the FormData read after an `await` (by then `event.currentTarget` is
 * null), the call left outside the transition, the `preventDefault()` missed
 * so the browser does a full native POST that looks like a save. Each one
 * leaves every other check in this repo green — `formActionCensus.test.ts`
 * proves the `action` prop is gone and can prove nothing about what replaced
 * it. Hence four behavioural assertions: the action ran exactly once, it
 * received what was TYPED rather than the stored record, a refusal leaves
 * the typed values on screen, and the native navigation was prevented.
 *
 * WHY THE WHOLE RECORD IS ASSERTED, not just the field being edited. Every
 * value on this form prints somewhere outside the company — the legal name
 * as the contractor on a WH-347, the address as the employer on a union
 * remittance sheet. A submit handler that dropped one field would store a
 * blank onto a document a trust fund reads, and blank is exactly the state
 * this form exists to end.
 */

import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompanyProfile } from "@/lib/company-profile";

vi.mock("@/lib/actions", () => ({ updateCompanyProfile: vi.fn() }));

const actions = await import("@/lib/actions");
const { CompanyProfileForm } = await import("@/components/CompanyProfileForm");

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

/** A record with nothing on it, which is the state a real company starts in
 * — `name` is the generated "<Your Name>'s Company" and every other column
 * is null until somebody fills this form in. */
const EMPTY: CompanyProfile = {
  name: "Cyrus's Company",
  dbaName: null,
  ein: null,
  hqAddressLine1: null,
  hqAddressLine2: null,
  hqCity: null,
  hqState: null,
  hqZip: null,
  phone: null,
  website: null,
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(actions.updateCompanyProfile).mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

function render() {
  act(() => {
    root.render(createElement(CompanyProfileForm, { company: EMPTY, gaps: [] }));
  });
  const form = container.querySelector("form")!;
  return {
    form,
    field: <T extends HTMLElement>(name: string) => form.querySelector<T>(`[name="${name}"]`)!,
    button: () => container.querySelector<HTMLButtonElement>('button[type="submit"]')!,
  };
}

/** A real submit event, kept so the test can read `defaultPrevented` off the
 * very event the handler was given. `cancelable` is what makes that readable
 * at all — on a non-cancelable event `preventDefault()` is a no-op and the
 * assertion would pass while the handler did nothing. */
async function fireSubmit(form: HTMLFormElement) {
  const event = new Event("submit", { bubbles: true, cancelable: true });
  act(() => {
    form.dispatchEvent(event);
  });
  await act(async () => {});
  return event;
}

/** What a person filling this in for the first time types. */
const TYPED: Record<string, string> = {
  name: "Obiz Wall & Ceiling, Inc.",
  dbaName: "Obiz Drywall",
  ein: "12-3456789",
  hqAddressLine1: "1400 SE Industrial Way",
  hqAddressLine2: "Suite 200",
  hqCity: "Portland",
  hqState: "or",
  hqZip: "97202",
  phone: "(503) 555-0142",
  website: "obizwall.com",
};

describe("submitting the company record actually saves", () => {
  it("calls the action once, carrying every field as TYPED, and prevents the native post", async () => {
    vi.mocked(actions.updateCompanyProfile).mockResolvedValue({ ok: true });
    const { form, field } = render();

    for (const [name, value] of Object.entries(TYPED)) {
      field<HTMLInputElement>(name).value = value;
    }

    const event = await fireSubmit(form);

    // 4. A missed preventDefault() is a full page POST that looks like a save.
    expect(event.defaultPrevented).toBe(true);
    // 1. Once.
    expect(vi.mocked(actions.updateCompanyProfile)).toHaveBeenCalledTimes(1);

    // 2. Every field, as typed — not the stored record the component was
    // rendered with. Read after an `await` this is null and none arrive.
    const [formData] = vi.mocked(actions.updateCompanyProfile).mock.calls[0]!;
    for (const [name, value] of Object.entries(TYPED)) {
      expect(formData.get(name), `${name} did not reach the action as typed`).toBe(value);
    }
    // The count is asserted too, so a handler that started sending something
    // extra — or a field that quietly left the form — fails here rather than
    // being missed by a loop over a list this file wrote.
    expect([...formData.keys()].sort()).toEqual(Object.keys(TYPED).sort());
  });

  it("keeps every typed value on screen when the save is REFUSED, and renders the reason", async () => {
    // The exact shape of #311. `updateCompanyProfile` refuses a letter in
    // the EIN because a letter there is a different number entirely — and
    // the old form answered that by clearing the nine digits next to it.
    vi.mocked(actions.updateCompanyProfile).mockResolvedValue({
      ok: false,
      error: "An EIN is digits only, usually written 12-3456789.",
    });
    const { form, field } = render();

    for (const [name, value] of Object.entries(TYPED)) {
      field<HTMLInputElement>(name).value = value;
    }
    field<HTMLInputElement>("ein").value = "12-345678X";

    await fireSubmit(form);

    // 3a. The reason reached the screen.
    expect(container.textContent).toContain("An EIN is digits only");
    // 3b. …standing next to everything it is about. Under the old `action`
    // prop all ten of these had snapped back to "Not recorded".
    expect(field<HTMLInputElement>("ein").value).toBe("12-345678X");
    for (const [name, value] of Object.entries(TYPED)) {
      if (name === "ein") continue;
      expect(field<HTMLInputElement>(name).value, `${name} was wiped by the refusal`).toBe(value);
    }
    expect(container.textContent).not.toContain("Saved.");
  });

  it("says Saved. on success and does NOT reset — this is an edit form", async () => {
    vi.mocked(actions.updateCompanyProfile).mockResolvedValue({ ok: true });
    const { form, field } = render();

    field<HTMLInputElement>("ein").value = "12-3456789";
    await fireSubmit(form);

    expect(container.textContent).toContain("Saved.");
    // What is on screen IS the saved record now. Putting "Not recorded"
    // back would read as the save having been thrown away.
    expect(field<HTMLInputElement>("ein").value).toBe("12-3456789");
  });

  it("disables Save company record while in flight, and frees it after", async () => {
    // The pending state moved out of React's own form handling and onto this
    // component's `useTransition` when the form was rewired, so that it
    // still drives the button is a claim rather than an assumption.
    let finish: (v: { ok: true }) => void = () => {};
    vi.mocked(actions.updateCompanyProfile).mockImplementation(
      () => new Promise<{ ok: true }>((resolve) => (finish = resolve)),
    );
    const { form, button } = render();

    expect(button().disabled).toBe(false);

    act(() => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(button().disabled).toBe(true);
    expect(button().textContent).toContain("Saving");

    await act(async () => {
      finish({ ok: true });
    });
    expect(button().disabled).toBe(false);
  });
});
