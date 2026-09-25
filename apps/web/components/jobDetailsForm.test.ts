// @vitest-environment happy-dom

/**
 * On a contracted job the Client select is disabled — the client is who
 * signed. A disabled control is left out of a form's submitted data, so for
 * as long as that was the only `contactId` field, every "Save details" on a
 * contracted job reached the action without a client and was refused with
 * "A job needs a client." — no name, scope or site address could be saved.
 * Found clicking #344 on production.
 *
 * NOT `new FormData(form)`: happy-dom includes disabled controls in it, so a
 * test built on it passed against the broken form (checked). A browser sends
 * only ENABLED named controls, so that is the set this reads.
 */

import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions", () => ({ updateJobDetails: vi.fn(), deleteEstimateJob: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const actions = await import("@/lib/actions");
const { JobDetailsForm } = await import("@/components/JobDetailsForm");

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(actions.updateJobDetails).mockReset();
});

afterEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

function submitted(isEstimate: boolean) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      createElement(JobDetailsForm, {
        jobId: "job-1",
        name: "Riverside",
        scope: null,
        contactId: "contact-1",
        contacts: [
          { id: "contact-1", name: "Acme GC" },
          { id: "contact-2", name: "Other GC" },
        ],
        isEstimate,
        canRemove: false,
        siteAddress: null,
        grossAreaSqFt: null,
        siteStatus: "none",
      }),
    );
  });
  const form = container.querySelector("form");
  if (!form) throw new Error("no form rendered");
  // What a browser would submit: named, enabled controls only.
  const sent = [...form.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[name='contactId']")]
    .filter((el) => !el.disabled)
    .map((el) => el.value);
  act(() => root.unmount());
  container.remove();
  return sent;
}

describe("the job details form", () => {
  it("still sends the client on a contracted job, where the picker is disabled", () => {
    expect(submitted(false)).toEqual(["contact-1"]);
  });

  it("sends the picked client, once, on an estimate", () => {
    expect(submitted(true)).toEqual(["contact-1"]);
  });
});

/**
 * AND THE HALF THE TEST ABOVE CANNOT SEE: DOES SUBMITTING STILL SAVE?
 *
 * `submitted()` reads what a browser WOULD send off the rendered controls.
 * It never fires a submit, so it never runs the form's own handler — and on
 * 2026-09-25 that handler was rewritten. Issue #311: this form used
 * `<form action={save}>`, and React 19 calls `requestFormReset`
 * UNCONDITIONALLY before running a form's `action`, so every refusal
 * `updateJobDetails` returned arrived over fields that had already snapped
 * back to their defaults. It is `onSubmit` + `preventDefault()` +
 * `new FormData(event.currentTarget)` now.
 *
 * THAT REWRITE IS INVISIBLE TO EVERY OTHER CHECK IN THIS REPO.
 * `formActionCensus.test.ts` proves the `action` prop is gone; it cannot
 * prove the replacement works. The three ways a hand-rolled submit handler
 * fails are all silent — the FormData read after an `await` (by then
 * `event.currentTarget` is null), the call left outside the transition, the
 * `preventDefault()` missed so the browser does a full native POST that
 * looks like a save. Each one leaves a green suite and a form that has
 * stopped saving, which is this repo's defining failure mode.
 *
 * So these four assert the behaviour rather than the shape: the action ran
 * exactly once, it received what was TYPED rather than the defaults, a
 * refusal leaves the typed values on screen, and the native navigation was
 * prevented.
 */
function renderJobDetails() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(
      createElement(JobDetailsForm, {
        jobId: "job-1",
        name: "Riverside",
        scope: "Level 3 drywall",
        contactId: "contact-1",
        contacts: [{ id: "contact-1", name: "Acme GC" }],
        isEstimate: true,
        canRemove: false,
        siteAddress: null,
        grossAreaSqFt: null,
        siteStatus: "none",
      }),
    );
  });
  const form = container.querySelector("form")!;
  const field = <T extends HTMLElement>(name: string) => form.querySelector<T>(`[name="${name}"]`)!;
  return {
    container,
    form,
    field,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

/** A real submit event, kept so the test can read `defaultPrevented` off the
 * very event the handler was given. `cancelable` is what makes that readable
 * at all — on a non-cancelable event `preventDefault()` is a no-op and the
 * assertion would pass without the handler doing anything. */
async function fireSubmit(form: HTMLFormElement) {
  const event = new Event("submit", { bubbles: true, cancelable: true });
  act(() => {
    form.dispatchEvent(event);
  });
  await act(async () => {});
  return event;
}

describe("submitting the job details form actually saves", () => {
  it("calls the action once, with what was TYPED, and prevents the native post", async () => {
    vi.mocked(actions.updateJobDetails).mockResolvedValue({ ok: true });
    const { form, field, cleanup } = renderJobDetails();

    field<HTMLInputElement>("name").value = "Riverside — corrected";
    field<HTMLTextAreaElement>("scope").value = "Level 5 drywall, corridor only";
    field<HTMLInputElement>("siteAddress").value = "123 Main St, Portland, OR";

    const event = await fireSubmit(form);

    // 4. A missed preventDefault() is a full page POST that looks like a save.
    expect(event.defaultPrevented).toBe(true);
    // 1. Once. No create action in this app is idempotent (#19).
    expect(vi.mocked(actions.updateJobDetails)).toHaveBeenCalledTimes(1);

    // 2. The whole point of `new FormData(event.currentTarget)`: the values
    // on screen, not the defaults the component was rendered with. Read
    // after an `await` this is null and none of these arrive.
    const [jobId, formData] = vi.mocked(actions.updateJobDetails).mock.calls[0]!;
    expect(jobId).toBe("job-1");
    expect(formData.get("name")).toBe("Riverside — corrected");
    expect(formData.get("scope")).toBe("Level 5 drywall, corridor only");
    expect(formData.get("siteAddress")).toBe("123 Main St, Portland, OR");
    // Present and empty rather than absent: updateJobDetails writes
    // grossAreaSqFt only when `formData.has` it, so a field that stopped
    // being submitted would silently stop being clearable.
    expect(formData.has("grossAreaSqFt")).toBe(true);

    cleanup();
  });

  it("keeps every typed value on screen when the save is REFUSED, and renders the reason", async () => {
    // The exact shape of #311, and the reason this file needed a submit at
    // all: a sentence about a field, printed over a field that no longer
    // holds what it is complaining about.
    vi.mocked(actions.updateJobDetails).mockResolvedValue({
      ok: false,
      error: 'Gross area needs a number — "abc" has no digits in it.',
    });
    const { container, form, field, cleanup } = renderJobDetails();

    field<HTMLInputElement>("name").value = "Riverside — corrected";
    field<HTMLTextAreaElement>("scope").value = "Level 5 drywall, corridor only";
    field<HTMLInputElement>("grossAreaSqFt").value = "abc";

    await fireSubmit(form);

    // 3a. The reason reached the screen.
    expect(container.textContent).toContain("has no digits in it");
    // 3b. …and it is standing next to the values it is about. Under the old
    // `action` prop these three had already snapped back to "Riverside",
    // "Level 3 drywall" and "".
    expect(field<HTMLInputElement>("name").value).toBe("Riverside — corrected");
    expect(field<HTMLTextAreaElement>("scope").value).toBe("Level 5 drywall, corridor only");
    expect(field<HTMLInputElement>("grossAreaSqFt").value).toBe("abc");
    // No "Saved." claim beside a refusal.
    expect(container.textContent).not.toContain("Saved.");

    cleanup();
  });

  it("says Saved. on success and does NOT reset — this is an edit form", async () => {
    vi.mocked(actions.updateJobDetails).mockResolvedValue({ ok: true });
    const { container, form, field, cleanup } = renderJobDetails();

    field<HTMLTextAreaElement>("scope").value = "Level 5 drywall, corridor only";
    await fireSubmit(form);

    expect(container.textContent).toContain("Saved.");
    // What was typed IS the saved record now, so putting the old value back
    // on screen would be showing stale data as if it had been kept.
    expect(field<HTMLTextAreaElement>("scope").value).toBe("Level 5 drywall, corridor only");

    cleanup();
  });

  it("disables Save details while the save is in flight, and frees it after", async () => {
    // #19 disabled 57 create buttons because a second click on a slow save
    // is a duplicate record with no error anywhere. The rewrite moved the
    // pending state out of React's own form handling and onto this
    // component's `useTransition`, so that it still drives the button is a
    // claim worth holding rather than assuming.
    let finish: (v: { ok: true }) => void = () => {};
    vi.mocked(actions.updateJobDetails).mockImplementation(
      () => new Promise<{ ok: true }>((resolve) => (finish = resolve)),
    );
    const { container, form, cleanup } = renderJobDetails();
    const button = () => container.querySelector<HTMLButtonElement>('button[type="submit"]')!;

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

    cleanup();
  });
});
