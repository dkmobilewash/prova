// @vitest-environment happy-dom

/**
 * `LogBidForm` in a real DOM: the two things the browser walk of 2026-10-30
 * found, wired end to end rather than through the pure helpers alone.
 *
 *   - picking "Same job as…" fills the project name and trade (it used to
 *     fill nothing, and the name was retyped);
 *   - a logged bid lands the person on All bids, where it is listed, instead
 *     of leaving them on "Due soon", which a bid with no near due date is
 *     never on.
 *
 * Written with createElement rather than JSX: the suite's `include` matches
 * .test.ts — same reason as salesActivityForm.test.ts.
 */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  createBidInvitation: vi.fn(async () => ({ ok: true as const })),
  push: vi.fn(),
}));

vi.mock("@/lib/actions", () => ({
  createBidInvitation: fake.createBidInvitation,
  checkSameJobFromOtherGc: async () => ({ ok: true, value: [] }),
  readBidInvitationText: async () => ({ ok: false, error: "unused" }),
}));

const { LogBidForm } = await import("./LogBidForm");

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
  fake.createBidInvitation.mockClear();
  fake.push.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

function renderOpen() {
  const router = { push: fake.push, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() };
  act(() => {
    root.render(
      createElement(
        AppRouterContext.Provider,
        { value: router as never },
        createElement(LogBidForm, {
          gcs: [{ id: "turner", name: "Turner Construction" }],
          startOpen: true,
          surface: "bid",
          reader: { available: false, reason: "off" },
          projectChoices: [
            {
              id: "p1",
              label: "ZZ-TEST Riverside Dental TI — Halvorsen Builders",
              projectName: "ZZ-TEST Riverside Dental TI",
              tradeScope: "METAL_FRAMING_DRYWALL",
            },
          ],
        }),
      ),
    );
  });
  const get = <T extends Element>(selector: string) => container.querySelector<T>(selector)!;
  return {
    projectName: () => get<HTMLInputElement>('input[name="projectName"]'),
    tradeScope: () => get<HTMLSelectElement>('select[name="tradeScope"]'),
    sameJob: () => get<HTMLSelectElement>('select[name="bidProjectId"]'),
    contact: () => get<HTMLSelectElement>('select[name="contactId"]'),
    form: () => container.querySelector("form"),
  };
}

const pick = (select: HTMLSelectElement, value: string) =>
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });

describe("Same job as…", () => {
  it("fills the project name and trade from the picked job, and they stay editable", () => {
    const ui = renderOpen();
    pick(ui.sameJob(), "p1");
    expect(ui.projectName().value).toBe("ZZ-TEST Riverside Dental TI");
    expect(ui.tradeScope().value).toBe("METAL_FRAMING_DRYWALL");
    expect(ui.projectName().readOnly).toBe(false);
  });
});

describe("after Log invitation", () => {
  it("opens All bids, where the new bid is listed whatever its due date", async () => {
    const ui = renderOpen();
    pick(ui.contact(), "turner");
    ui.projectName().value = "Harbor Lofts";
    await act(async () => {
      ui.form()!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(fake.createBidInvitation).toHaveBeenCalledTimes(1);
    expect(fake.push).toHaveBeenCalledWith("/bid/bids?view=all");
  });
});
