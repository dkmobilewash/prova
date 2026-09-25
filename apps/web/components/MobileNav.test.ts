// @vitest-environment happy-dom

/**
 * THE PHONE DRAWER'S NAVIGATION LANDMARK — the one this shell did not have.
 *
 * Below Tailwind's `md` the 240px rail is `display: none` (Sidebar.tsx's
 * spacer is `hidden … md:block`) and this drawer is the app's whole
 * navigation. Its `<nav>` carried no accessible name, so on a signed-in
 * phone page there was no NAMED navigation landmark anywhere in the
 * product: a screen reader announced a bare "navigation", and landmark
 * navigation — the way somebody using one moves around a page without
 * reading it top to bottom — had nothing to aim at. Half a subcontractor's
 * people work from a phone, which is what makes this the wrong shell to be
 * the unnamed one.
 *
 * Found while clearing the two `field-screens.mobile` specs that had been
 * red on main for days: the E2E health check asked every signed-in page for
 * `navigation "Main"`, which is the rail, and at 375px there is no rail.
 * Asking the phone shell for its own navigation is only meaningful if the
 * phone shell HAS one, and this is the file that says it does.
 *
 * What this environment cannot see, stated rather than pretended at:
 * happy-dom does no layout, so "the rail is hidden at 375px" is not
 * checkable here and is not checked here — that assertion lives in
 * e2e/specs/shell-nav.mobile.spec.ts, in a real Chromium at a real 375px
 * viewport, which also opens the drawer with a click. This file owns the
 * MARKUP: that the button is reachable by its name and that what it opens
 * is a landmark called "Main".
 *
 * createElement rather than JSX, and the mocks, follow Sidebar.test.ts —
 * its header explains both.
 */

import { createElement, act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ pathname: "/punch-lists" }));

vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

vi.mock("next/link", async () => {
  const { createElement: h } = await import("react");
  return {
    default: ({
      href,
      children,
      ...rest
    }: {
      href: string;
      children?: ReactNode;
    } & Record<string, unknown>) => h("a", { href, ...rest }, children),
  };
});

const { MobileNav } = await import("@/components/MobileNav");

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

/** An OWNER sees every group — the widest drawer there is. */
const principal = { role: "OWNER", jobFunction: null };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  nav.pathname = "/punch-lists";
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

function renderDrawer() {
  act(() => {
    root.render(createElement(MobileNav, { companyName: "Acme Drywall", principal }));
  });
}

/** The hamburger, found the way a screen reader and the E2E health check
 * both find it: by its accessible name, not by its classes. */
function openButton(): HTMLButtonElement {
  const found = container.querySelector<HTMLButtonElement>('button[aria-label="Open navigation"]');
  if (!found) {
    const labels = Array.from(container.querySelectorAll("button")).map(
      (b) => b.getAttribute("aria-label") ?? (b.textContent ?? "").trim(),
    );
    throw new Error(`no button named "Open navigation" — found: ${labels.join(" | ")}`);
  }
  return found;
}

function open() {
  const button = openButton();
  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("the phone navigation drawer", () => {
  it("offers the hamburger by name, and nothing else, while closed", () => {
    renderDrawer();

    expect(openButton().getAttribute("aria-expanded")).toBe("false");
    // Closed, there is no navigation in the document at all — which is why
    // the E2E shell check asks for the BUTTON at phone width and not for a
    // landmark that only exists once somebody taps.
    expect(container.querySelectorAll("nav")).toHaveLength(0);
  });

  it('opens a navigation landmark NAMED "Main"', () => {
    renderDrawer();
    open();

    const navs = Array.from(container.querySelectorAll("nav"));
    expect(navs, "tapping the hamburger renders no <nav> at all").toHaveLength(1);
    expect(
      navs[0].getAttribute("aria-label"),
      'the drawer is the app\'s main navigation below md and must say so — an unnamed landmark is announced as bare "navigation", ' +
        "and the rail that carries this name is display:none at this width",
    ).toBe("Main");
    expect(openButton().getAttribute("aria-expanded")).toBe("true");
  });

  it("marks the page you are standing on, inside that landmark", () => {
    nav.pathname = "/punch-lists";
    renderDrawer();
    open();

    const landmark = container.querySelector('nav[aria-label="Main"]');
    // Asserted, not `!`-asserted: without this the test above's defect
    // reaches this one as an unreadable TypeError on null.
    expect(landmark, 'no navigation landmark named "Main" — see the test above').not.toBeNull();
    const current = Array.from(landmark!.querySelectorAll('[aria-current="page"]'));
    // Exactly one, so the E2E spec's `toBeVisible()` on this selector cannot
    // die in strict mode — the failure that kept /settings/import red.
    expect(current).toHaveLength(1);
    expect(current[0].getAttribute("href")).toBe("/punch-lists");
  });
});
