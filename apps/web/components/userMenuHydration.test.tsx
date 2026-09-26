// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE TOPBAR MUST HYDRATE, AND THIS TEST HYDRATES IT RATHER THAN
 * DESCRIBING IT.
 *
 * Clerk's `<UserButton>` renders nothing during server rendering and a
 * mount div on the client — `@clerk/nextjs` 6.9.6 defers to clerk-js,
 * which does not exist on the server. React's own component stack, from a
 * dev-server E2E run on 2026-09-24:
 *
 *     <ClerkHostRenderer component="UserButton" mount={function} …>
 *   +   <div ref={{current:null}} data-clerk-component="UserButton">
 *
 * The `+` is the node the client added and the server never sent. It is in
 * the Topbar, which `app/(app)/layout.tsx` mounts on EVERY authenticated
 * page — one React error per full page load across the signed-in app.
 *
 * WHY THE STUB BELOW IS A FLAG AND NOT `typeof window`. happy-dom gives
 * `renderToString` a `window`, so the component cannot detect which side
 * it is on the way Clerk really does. `onClient` is flipped by the test
 * between the server render and the hydration, which reproduces Clerk's
 * ACTUAL asymmetry — null one side, a div the other — without pretending
 * to reimplement Clerk.
 *
 * WHAT IS BEING ASSERTED: `onRecoverableError`. That is the exact callback
 * React fires for a hydration mismatch, so this test fails on the real
 * condition rather than on a proxy for it. Mutation-checked by rendering
 * the bare `UserButton` instead of the wrapper — see the last case.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let onClient = false;

vi.mock("@clerk/nextjs", () => ({
  UserButton: () => (onClient ? createElement("div", { "data-clerk-component": "UserButton" }) : null),
}));

const { UserMenu } = await import("@/components/UserMenu");

/** Server-render `element`, then hydrate that exact HTML as the browser
 * would, and return every recoverable error React reported. */
async function hydrationErrorsFor(element: React.ReactElement): Promise<string[]> {
  onClient = false;
  const html = renderToString(element);

  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.appendChild(container);

  onClient = true;
  const errors: string[] = [];
  await act(async () => {
    hydrateRoot(container, element, {
      onRecoverableError: (error) => errors.push(error instanceof Error ? error.message : String(error)),
    });
  });
  return errors;
}

beforeEach(() => {
  // Without this React warns "not configured to support act(...)" and does
  // not guarantee effects have flushed — which would make a clean result
  // here mean "the effect had not run yet" rather than "it hydrated".
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  onClient = false;
});

afterEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("the user menu hydrates cleanly", () => {
  it("reports no recoverable error when hydrated", async () => {
    expect(await hydrationErrorsFor(createElement(UserMenu))).toEqual([]);
  });

  it("server-renders a placeholder, not Clerk's mount node", async () => {
    onClient = false;
    const html = renderToString(createElement(UserMenu));
    // The first client render must be able to produce this same markup
    // without clerk-js, which is the whole mechanism.
    expect(html).not.toContain("data-clerk-component");
    expect(html).toContain("rounded-full");
  });

  it("reserves the avatar's own size, so nothing moves when it arrives", async () => {
    // A placeholder of a different size trades one visible defect for
    // another: the chrome would jump a frame after load.
    onClient = false;
    expect(renderToString(createElement(UserMenu))).toContain("h-7 w-7");
  });

  it("swaps in the real control once mounted", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    onClient = true;
    await act(async () => {
      hydrateRoot(container, createElement(UserMenu), { onRecoverableError: () => {} });
    });
    expect(container.innerHTML).toContain("data-clerk-component");
  });

  it("MUTATION CONTROL: the bare UserButton does NOT hydrate cleanly", async () => {
    // The defect this file exists for, reproduced directly. If this ever
    // passes, the stub has stopped modelling Clerk's asymmetry and every
    // case above has become vacuous — a guard that cannot fail.
    const { UserButton } = await import("@clerk/nextjs");
    const errors = await hydrationErrorsFor(createElement(UserButton as never));
    expect(errors.length, "the stub no longer reproduces the mismatch").toBeGreaterThan(0);
  });
});
