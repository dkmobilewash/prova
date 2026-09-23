// @vitest-environment happy-dom

/**
 * What the first screen shows when Save goes wrong.
 *
 * `/welcome` sits OUTSIDE `app/(app)/`, so until this change nothing stood
 * between an error escaping this component and Next's stock "Application
 * error" page. `CompanySetupGate` awaited `saveBusinessScope` with no
 * try/catch, and that action could throw on an empty submit (see
 * lib/businessScope-save.test.ts). The action is fixed; this file pins the
 * OTHER half — that even if an action throws again (a dropped connection,
 * a redacted bug), this screen turns it into a sentence and stays on
 * screen, rather than needing a boundary above it to catch the pieces.
 *
 * Both halves are asserted: a rejection renders a sentence; a returned
 * refusal renders THAT sentence verbatim. A component that swallowed
 * everything into one generic line would fail the second.
 *
 * Also pinned: every radio is `required`, so the browser refuses an empty
 * Save before the action is ever called — the cheapest possible version of
 * "cannot throw on an empty submit". Note a dispatched `submit` event
 * bypasses constraint validation, which is why the action-level refusal
 * above is not redundant with it.
 *
 * Written with createElement rather than JSX because the suite's `include`
 * matches .test.ts and not .test.tsx — same reason as logTimeEntryForm.test.ts.
 */

import { createElement, type ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Result = { ok: true } | { ok: false; error: string };

const fake = {
  saveBusinessScope: vi.fn<(formData: FormData) => Promise<Result>>(),
  skipBusinessScopeQuestions: vi.fn<() => Promise<Result>>(),
  replace: vi.fn(),
};

vi.mock("@/lib/actions", () => ({
  saveBusinessScope: fake.saveBusinessScope,
  skipBusinessScopeQuestions: fake.skipBusinessScopeQuestions,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: fake.replace, refresh: vi.fn(), push: vi.fn() }),
}));

const { CompanySetupGate } = await import("@/components/CompanySetupGate");

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
  fake.saveBusinessScope.mockReset();
  fake.skipBusinessScopeQuestions.mockReset();
  fake.replace.mockReset();
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

async function pressSave() {
  const form = container.querySelector("form");
  if (!form) throw new Error("no form");
  act(() => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  // The transition's async work settles over a few microtasks.
  await act(async () => {});
  await act(async () => {});
}

function alertText(): string | null {
  return container.querySelector('[role="alert"]')?.textContent ?? null;
}

describe("Save on /welcome when the action throws", () => {
  it("shows a sentence and stays on the screen, rather than escaping", async () => {
    // What a production throw looks like from the client: an Error whose
    // message is a digest, not a sentence. Whatever the component says
    // must not depend on it.
    fake.saveBusinessScope.mockRejectedValue(new Error("446730191"));
    render(createElement(CompanySetupGate));

    await pressSave();

    const text = alertText();
    expect(text, "an alert is rendered").not.toBeNull();
    expect(text ?? "").toMatch(/save/i);
    expect(text ?? "").not.toContain("446730191");
    // The questions are still there to answer — nothing was torn down.
    expect(container.querySelectorAll('input[type="radio"]').length).toBeGreaterThan(0);
    expect(fake.replace).not.toHaveBeenCalled();
  });

  it("shows a returned refusal verbatim — the action's words, not a generic line", async () => {
    fake.saveBusinessScope.mockResolvedValue({ ok: false, error: "Answer all three questions to save." });
    render(createElement(CompanySetupGate));

    await pressSave();

    expect(alertText()).toBe("Answer all three questions to save.");
    expect(fake.replace).not.toHaveBeenCalled();
  });

  it("leaves for the dashboard only when the save succeeded", async () => {
    fake.saveBusinessScope.mockResolvedValue({ ok: true });
    render(createElement(CompanySetupGate));

    await pressSave();

    expect(alertText()).toBeNull();
    expect(fake.replace).toHaveBeenCalledWith("/dashboard");
  });
});

describe("Skip on /welcome when the action throws", () => {
  it("shows a sentence and stays, same as Save", async () => {
    fake.skipBusinessScopeQuestions.mockRejectedValue(new Error("446730191"));
    render(createElement(CompanySetupGate));

    const skip = Array.from(container.querySelectorAll("button")).find((b) => /skip/i.test(b.textContent ?? ""));
    if (!skip) throw new Error("no Skip button");
    act(() => {
      skip.click();
    });
    await act(async () => {});
    await act(async () => {});

    expect(alertText()).not.toBeNull();
    expect(fake.replace).not.toHaveBeenCalled();
  });
});

describe("the three questions refuse an empty Save in the browser first", () => {
  it("every radio is required, so the form cannot post with a group unanswered", () => {
    render(createElement(CompanySetupGate));
    const radios = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    // Three questions: three relationship options plus two yes/no pairs.
    expect(radios.length).toBe(7);
    expect(radios.filter((r) => r.required).length).toBe(radios.length);
    expect(new Set(radios.map((r) => r.name))).toEqual(
      new Set(["contractingRelationship", "doesPublicWork", "filesMonthlyPayApps"]),
    );
  });
});
