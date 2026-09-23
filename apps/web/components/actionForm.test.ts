// @vitest-environment happy-dom

/**
 * `ActionForm` — the wrapper that gave six server-component pages somewhere
 * to render a refusal.
 *
 * THE FIRST TEST HERE IS NOT ABOUT ERRORS AT ALL, and it is the one worth
 * reading. Replacing `<form action={serverAction}>` with `onSubmit` +
 * `startTransition` looked like it must break `SubmitButton`, whose whole
 * job is disabling itself while a create is in flight — `useFormStatus` is
 * documented as reporting the status of a form submitted through the
 * `action` prop, and this form does not use it. That matters more than it
 * sounds: #19 disabled 57 create buttons precisely because a second click
 * on a slow save produces a duplicate record with no error anywhere, and
 * quietly re-opening that on six money forms would have been a worse bug
 * than the one this change set out to fix.
 *
 * Measured instead of assumed, and it holds — React 19 tracks a transition
 * started inside the form's own submit handler, so `pending` is true for
 * the round trip. This test exists so that stays true rather than being
 * rediscovered.
 */

import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";

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
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

/** A form holding one field and one SubmitButton, plus a handle to finish
 * the action whenever the test wants to look at the in-flight state. */
function renderForm(action: (formData: FormData) => Promise<{ ok: true } | { ok: false; error: string } | void>) {
  act(() => {
    root.render(
      createElement(
        ActionForm,
        { action },
        createElement("input", { key: "q", name: "quantity", defaultValue: "2,800" }),
        createElement(SubmitButton, { key: "b", type: "submit" }, "Add line"),
      ),
    );
  });
  return {
    form: container.querySelector("form")!,
    button: () => container.querySelector("button")!,
    input: () => container.querySelector<HTMLInputElement>('input[name="quantity"]')!,
  };
}

async function submit(form: HTMLFormElement) {
  act(() => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await act(async () => {});
}

describe("the submit button still disables itself", () => {
  it("is disabled for the whole round trip, then clickable again", async () => {
    let finish: (v: { ok: true }) => void = () => {};
    const action = () => new Promise<{ ok: true }>((resolve) => (finish = resolve));
    const { form, button } = renderForm(action);

    expect(button().disabled).toBe(false);

    act(() => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    // The duplicate-record guard: a second click here is what #19 exists
    // to stop, and no create action in this app is idempotent.
    expect(button().disabled).toBe(true);
    expect(button().getAttribute("aria-busy")).toBe("true");

    await act(async () => {
      finish({ ok: true });
    });
    expect(button().disabled).toBe(false);
  });
});

describe("what the form does with what the action returned", () => {
  it("renders a returned refusal and keeps every field", async () => {
    const { form, input } = renderForm(async () => ({
      ok: false as const,
      error: "Quantity: “two thousand” isn't a number.",
    }));

    await submit(form);

    expect(container.textContent).toContain("isn't a number");
    // Not reset: being told what is wrong with fields that are gone is the
    // trap formActionCensus.test.ts exists for.
    expect(input().value).toBe("2,800");
  });

  it("resets on success, and clears a refusal left over from last time", async () => {
    let fail = true;
    const { form, input } = renderForm(async () =>
      fail ? { ok: false as const, error: "Nope" } : { ok: true as const },
    );

    await submit(form);
    expect(container.textContent).toContain("Nope");

    fail = false;
    input().value = "480";
    await submit(form);
    expect(container.textContent).not.toContain("Nope");
    // reset() restores the DEFAULT, which on a create form is the starting
    // quantity — not an empty box. That is what a fresh row wants.
    expect(input().value).toBe("2,800");
  });

  it("treats an action that returns nothing as a success", async () => {
    // Several of these actions are still throw-style for their other
    // guards and simply return undefined. Converting a page must not
    // require converting every guard behind it on the same day.
    const { form, input } = renderForm(async () => undefined);
    input().value = "480";
    await submit(form);
    expect(input().value).toBe("2,800");
  });

  it("keeps the fields when resetOnSuccess is off — an edit form, not a create", async () => {
    let seen: FormData | null = null;
    act(() => {
      root.render(
        createElement(
          ActionForm,
          {
            action: async (formData: FormData) => {
              seen = formData;
              return { ok: true as const };
            },
            resetOnSuccess: false,
          },
          createElement("input", { key: "q", name: "retainagePercent", defaultValue: "10" }),
          createElement(SubmitButton, { key: "b", type: "submit" }, "Save"),
        ),
      );
    });
    await submit(container.querySelector("form")!);
    expect(container.querySelector<HTMLInputElement>("input")!.value).toBe("10");
    expect(seen!.get("retainagePercent")).toBe("10");
  });

  it("sends what was typed, comma and all, rather than anything the box rewrote", async () => {
    let seen: FormData | null = null;
    const { form } = renderForm(async (formData) => {
      seen = formData;
      return { ok: true as const };
    });
    await submit(form);
    expect(seen!.get("quantity")).toBe("2,800");
  });

  it("says something legible when the action throws, rather than nothing", async () => {
    // A throw at this point is a genuine bug and production redacts its
    // message, so the form says what to DO instead of repeating a digest.
    const { form } = renderForm(async () => {
      throw new Error("boom");
    });
    await submit(form);
    expect(container.textContent).toContain("Reload the page");
    expect(container.textContent).not.toContain("boom");
  });
});
