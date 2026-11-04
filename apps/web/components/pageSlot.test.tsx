// @vitest-environment happy-dom

/**
 * #510, REPRODUCED: a host element whose direct child is still a lazy when
 * hydration reaches it is replayed from the top, and the replay re-claims a
 * DOM node the first attempt already walked past.
 *
 * What CI measured (CLAUDE.md's #418 entry has the runs): every residual #418
 * had the component stack `at main > div > div > (app) layout router`, was
 * thrown from React's `replaySuspendedUnitOfWork` re-entering `beginWork` for
 * the HOST fiber `<main>`, and at that instant `<main>`'s first child in the
 * DOM was the page's own `div.mx-auto` — so React was trying to claim a
 * `<main>` and found the div inside it.
 *
 * The lazy is real and comes from Next, not from us. `<main>`'s child is
 * Next's LayoutRouter element, whose props carry the `(app)/error.tsx` client
 * module. When that module's chunk has not executed by the time the Flight
 * row is parsed, the Flight client wraps the whole element in a lazy
 * (`createLazyChunkWrapper`, react-server-dom-webpack client) — and a lazy in
 * CHILD position suspends its PARENT's beginWork. The parent was `<main>`.
 *
 * The fix is `PageSlot`: a function component between `<main>` and the page,
 * so the lazy suspends a fiber that claims no DOM node and replays cleanly.
 *
 * Both halves are proved here against the real react-dom, in one shape:
 * the server's HTML, then hydration with the child still pending, then the
 * child resolving. The first case is the CONTROL — without it, a quiet second
 * case would say nothing.
 */
import { lazy, startTransition, type ReactNode } from "react";
import { hydrateRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { PageSlot } from "./PageSlot";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;

const SERVER_HTML = '<main id="main"><div class="page">the page</div></main>';

/**
 * A child-position lazy that is pending when React first reaches it and
 * settled by the time React looks again — the production timing, where the
 * blocked client chunk finishes loading during one of hydration's yields.
 * React then REPLAYS the suspended fiber; a lazy that stays pending longer
 * is unwound to the root and retried from scratch instead, which is clean,
 * so a slow promise here would be a control that cannot fire.
 */
function pendingPage(): ReactNode {
  // React.lazy's result is a lazy NODE as well as a lazy type; React 19
  // resolves it in child position exactly as it resolves a Flight `$L`.
  return lazy(() =>
    Promise.resolve({ default: (<div className="page">the page</div>) as never }),
  ) as unknown as ReactNode;
}

async function hydrate(tree: (child: ReactNode) => ReactNode): Promise<string[]> {
  const container = document.createElement("div");
  container.innerHTML = SERVER_HTML;
  document.body.appendChild(container);
  const errors: string[] = [];
  // The real scheduler, not act(): act drains work in its own loop and walks
  // a suspended render back to the root, which is the clean path and would
  // leave the control unable to fire.
  // Inside a transition, as Next's app-index.js hydrates: that is what makes
  // React wait on the thenable (SuspendedOnData) and replay the same fiber
  // once it settles — the path CI's JS stack named.
  let root: ReturnType<typeof hydrateRoot> | undefined;
  startTransition(() => {
    root = hydrateRoot(container, tree(pendingPage()), {
      onRecoverableError: (error) => errors.push(String((error as Error).message)),
    });
  });
  await new Promise((r) => setTimeout(r, 200));
  root?.unmount();
  container.remove();
  return errors;
}

describe("a lazy in <main>'s child position (#510)", () => {
  it("CONTROL: directly under the host <main>, it is a hydration mismatch", async () => {
    const errors = await hydrate((child) => <main id="main">{child}</main>);
    expect(errors.join("\n")).toMatch(/Hydration failed|#418/);
  });

  it("under PageSlot, it hydrates with no mismatch at all", async () => {
    const errors = await hydrate((child) => (
      <main id="main">
        <PageSlot>{child}</PageSlot>
      </main>
    ));
    expect(errors).toEqual([]);
  });
});
