// @vitest-environment happy-dom

/**
 * What a person sees on /pipeline's chase list when a save goes wrong, or
 * has not come back yet.
 *
 *   1. A REFUSED SAVE KEEPS WHAT THEY TYPED. The three forms were
 *      `<form action={(formData) => …}>`, and React's form-action path calls
 *      `requestFormReset` UNCONDITIONALLY before the action runs (installed
 *      react-dom, `startHostTransition`) — so "Estimated value must be a
 *      number" arrived on a form that had just been wiped. The repo's
 *      reference (LogTimeEntryForm, InviteTeamMemberForm) is `onSubmit` with
 *      `preventDefault()`, which never hands React the form to reset.
 *   2. THE STAGE DROPDOWN SHOWS THE CHOICE AT ONCE. It was `value={stage}`
 *      with no local state, so React put the old stage straight back and it
 *      sat there, disabled, for the 1.5-4.4s the refreshed page takes to
 *      arrive — which reads as a change that failed, and invites a second
 *      one. A refusal must put the saved stage back and say why.
 *
 * createElement rather than JSX for the same reason as logTimeEntryForm.test.ts:
 * the suite's `include` matches .test.ts only.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PursuitRow } from "@/lib/bid-pursuits-query";

type Result = { ok: true } | { ok: false; error: string };

const fake = {
  createBidPursuit: vi.fn<(formData: FormData) => Promise<Result>>(),
  updateBidPursuit: vi.fn<(id: string, formData: FormData) => Promise<Result>>(),
  setBidPursuitStage: vi.fn<(id: string, stage: string) => Promise<Result>>(),
  linkBidPursuitToInvitation: vi.fn<(id: string, invitationId: string) => Promise<Result>>(),
  deleteBidPursuit: vi.fn<(id: string) => Promise<Result>>(),
};

vi.mock("@/lib/actions", () => fake);

const { BidPursuitList } = await import("@/components/BidPursuitList");

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
  for (const fn of Object.values(fake)) fn.mockReset();
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

const pursuit: PursuitRow = {
  id: "p1",
  projectName: "St. Mary's east wing",
  owner: null,
  architect: null,
  expectedGcs: null,
  note: null,
  stage: "WATCHING",
  expectedBidDate: null,
  lastUpdated: "2026-09-10",
  estimatedValue: null,
  open: true,
  goneQuiet: false,
  bidDateComingUp: false,
  bidDatePassed: false,
  daysSinceUpdate: 7,
  invitation: null,
};

function renderList(rows: PursuitRow[] = [pursuit]) {
  render(createElement(BidPursuitList, { pursuits: rows, invitations: [], isOwner: true }));
}

function field<T extends HTMLInputElement | HTMLSelectElement>(selector: string): T {
  const el = container.querySelector<T>(selector);
  if (!el) throw new Error(`nothing matches ${selector}`);
  return el;
}

function click(text: string) {
  const button = [...container.querySelectorAll("button")].find((b) => b.textContent === text);
  if (!button) throw new Error(`no button reading ${text}`);
  act(() => {
    button.click();
  });
}

async function submit(form: HTMLFormElement) {
  act(() => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await act(async () => {});
}

describe("a refused save keeps what the person typed", () => {
  it("the create form", async () => {
    fake.createBidPursuit.mockResolvedValue({
      ok: false,
      error: "Estimated value must be a number, like 250000 or 250,000.00",
    });
    renderList([]);
    click("Add a pursuit");
    field<HTMLInputElement>('[name="projectName"]').value = "Harbor lofts";
    field<HTMLInputElement>('[name="estimatedValue"]').value = "a lot";
    field<HTMLInputElement>('[name="note"]').value = "Met their PM at the AGC dinner";
    await submit(container.querySelector<HTMLFormElement>('[data-testid="bid-pursuit-form"]')!);

    expect(fake.createBidPursuit).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Estimated value must be a number");
    expect(field<HTMLInputElement>('[name="projectName"]').value).toBe("Harbor lofts");
    expect(field<HTMLInputElement>('[name="estimatedValue"]').value).toBe("a lot");
    expect(field<HTMLInputElement>('[name="note"]').value).toBe("Met their PM at the AGC dinner");
  });

  it("the edit form", async () => {
    fake.updateBidPursuit.mockResolvedValue({ ok: false, error: "That bid date is not valid" });
    renderList();
    click("Edit");
    field<HTMLInputElement>('[name="projectName"]').value = "St. Mary's east wing, phase 2";
    field<HTMLInputElement>('[name="estimatedValue"]').value = "1,2,3";
    await submit(container.querySelector("form") as HTMLFormElement);

    expect(fake.updateBidPursuit).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("That bid date is not valid");
    expect(field<HTMLInputElement>('[name="projectName"]').value).toBe("St. Mary's east wing, phase 2");
    expect(field<HTMLInputElement>('[name="estimatedValue"]').value).toBe("1,2,3");
  });

  it("still sends what was typed, and closes the form on success", async () => {
    fake.createBidPursuit.mockResolvedValue({ ok: true });
    renderList([]);
    click("Add a pursuit");
    field<HTMLInputElement>('[name="projectName"]').value = "Harbor lofts";
    await submit(container.querySelector<HTMLFormElement>('[data-testid="bid-pursuit-form"]')!);
    expect(fake.createBidPursuit.mock.calls[0][0].get("projectName")).toBe("Harbor lofts");
    expect(container.querySelector('[data-testid="bid-pursuit-form"]')).toBeNull();
  });
});

describe("the source keeps the pattern that makes that true", () => {
  const source = readFileSync(join(__dirname, "BidPursuitList.tsx"), "utf8");

  it("read the file it is asserting about", () => {
    expect(source).toContain("export function BidPursuitList");
  });

  it("no form hands React an action to reset around", () => {
    expect(source).not.toMatch(/action=\{\s*\(?\s*formData/);
    expect(source).not.toMatch(/<form[^>]*\saction=/);
  });

  it("every form submits through onSubmit with preventDefault", () => {
    const forms = source.match(/<form\b/g) ?? [];
    expect(forms.length).toBe(3);
    const handlers = source.match(/onSubmit=\{\(event\) => \{\s*event\.preventDefault\(\);/g) ?? [];
    expect(handlers.length).toBe(forms.length);
  });
});

describe("the stage dropdown", () => {
  function stageSelect() {
    return field<HTMLSelectElement>(`#stage-${pursuit.id}`);
  }

  function choose(value: string) {
    const select = stageSelect();
    act(() => {
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  it("shows the new stage while the save is in flight", async () => {
    let finish: (result: Result) => void = () => {};
    fake.setBidPursuitStage.mockReturnValue(new Promise<Result>((resolve) => (finish = resolve)));
    renderList();
    choose("CONTACTED");
    expect(fake.setBidPursuitStage).toHaveBeenCalledWith("p1", "CONTACTED");
    expect(stageSelect().value).toBe("CONTACTED");
    await act(async () => finish({ ok: true }));
  });

  it("puts the saved stage back, and says why, when the save is refused", async () => {
    fake.setBidPursuitStage.mockResolvedValue({
      ok: false,
      error: "That pursuit is no longer on your list.",
    });
    renderList();
    choose("DROPPED");
    await act(async () => {});
    expect(stageSelect().value).toBe("WATCHING");
    expect(container.textContent).toContain("That pursuit is no longer on your list.");
  });

  it("follows the saved stage when the refreshed page arrives", async () => {
    fake.setBidPursuitStage.mockResolvedValue({ ok: true });
    renderList();
    choose("CONTACTED");
    await act(async () => {});
    renderList([{ ...pursuit, stage: "CONTACTED" }]);
    expect(stageSelect().value).toBe("CONTACTED");
    // And a later refresh from elsewhere (another user's change) is shown too.
    renderList([{ ...pursuit, stage: "EXPECTING_INVITE" }]);
    expect(stageSelect().value).toBe("EXPECTING_INVITE");
  });
});

describe("the open total under the heading", () => {
  it("shows the open total and names the pursuit with no value; closed ones are left out", () => {
    renderList([
      { ...pursuit, id: "a", estimatedValue: 250_000 },
      { ...pursuit, id: "b", stage: "CONTACTED", estimatedValue: 100_000.5 },
      { ...pursuit, id: "c", stage: "EXPECTING_INVITE", estimatedValue: null },
      { ...pursuit, id: "d", stage: "DROPPED", open: false, estimatedValue: 9_999_999 },
    ]);
    expect(container.querySelector('[data-testid="bid-pursuit-total"]')?.textContent).toBe(
      "3 open, 2 with a value, about $350,000.50 — 1 has no value yet",
    );
  });

  it("shows no total line when nothing is open", () => {
    renderList([]);
    expect(container.querySelector('[data-testid="bid-pursuit-total"]')).toBeNull();
  });
});
