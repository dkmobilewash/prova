"use client";

import { Component, Suspense, type ErrorInfo, type ReactNode } from "react";

/**
 * One region of the signed-in shell, fenced so that when it breaks, IT
 * breaks — and the page it frames does not.
 *
 * WHY THIS EXISTS. On 2026-09-21, with real contractors testing, one invoice
 * produced a render error in a component the `(app)` layout mounts on EVERY
 * page. React's rule is that an uncaught render error unmounts the whole
 * tree, so every authenticated screen — /dashboard, /jobs, every job tab —
 * became "Application error: a client-side exception has occurred",
 * permanently, surviving reloads, with nothing left on screen to click. The
 * page the person came for was fine. The chrome around it killed it.
 *
 * `app/error.tsx` (#407) sits above the `(app)` layout and would have caught
 * that throw on a later build — and the result would STILL have been a dead
 * account: PageLoadError filling the viewport with no sidebar and no topbar,
 * on every page, and "Try again" re-rendering the same shell into the same
 * throw. A full-page boundary is the right last resort. It is the wrong
 * FIRST resort for a decorative stats bar.
 *
 * So each independent shell region — the sidebar, the topbar, the metric
 * bar, the two invisible helpers — gets its own boundary here. A region that
 * throws is replaced by a quiet one-line fallback of the same height, the
 * error goes to the console with the region's name, and `children` of the
 * layout — the page — never notices. A degraded region beats a dead app.
 *
 * WHAT IS DELIBERATELY NOT WRAPPED: the page itself. `app/(app)/error.tsx`
 * owns page failures, and it says something — "don't submit again yet,
 * reload and check" — that a quiet fallback would swallow. Fail quietly in
 * the shell, loudly for the thing the person is actually doing.
 * `shellRegion.test.ts` asserts `{children}` stays outside every region.
 *
 * WHY THE SUSPENSE INSIDE. A class boundary is a CLIENT mechanism: React's
 * server renderer does not call `getDerivedStateFromError` — probed against
 * the installed react-dom 19.2.8, `renderToString` of a throwing child
 * inside a bare boundary throws straight through. Inside a `<Suspense>` the
 * server instead emits the boundary as "switched to client rendering", the
 * client retries it, the retry throws on the client, and THIS class catches
 * it. Without the Suspense a throw during SSR would escape to `app/error.tsx`
 * and the page would be gone again. The fallback is `null` on purpose: every
 * region's data is awaited by the layout before it renders, so nothing here
 * ever actually suspends and no loading state is ever shown.
 *
 * NO DOM OF ITS OWN. The shell is a `flex h-screen` row whose children are
 * the sidebar and the content column; a wrapper element would become a flex
 * item and break the layout. Boundary and Suspense are both DOM-less, and
 * the test asserts a healthy region's markup lands as a direct child of its
 * container.
 */

export type ShellRegionName = "sidebar" | "topbar" | "metricbar" | "helper";

/** What stands in for a region that failed. Same box as the real thing so
 * the layout's declared chrome heights (`--shell-topbar`, `--shell-metricbar`)
 * stay true; quiet copy; a way to retry that costs nothing. Exported so the
 * layout can render it directly when a region's DATA failed server-side
 * (see lib/shell-region-failure.ts) — one fallback per region, not two. */
export function ShellRegionFallback({ region }: { region: ShellRegionName }) {
  switch (region) {
    case "sidebar":
      return (
        <div className="print:hidden hidden w-60 shrink-0 md:block">
          <aside
            aria-label="Navigation unavailable"
            className="fixed inset-y-0 left-0 z-40 flex w-60 flex-col gap-3 bg-rail p-4 text-sm text-ink-body"
          >
            <p>The navigation couldn&apos;t load. The page still works.</p>
            <ReloadLink />
            <a href="/dashboard" className="text-link hover:text-link-hover">
              Back to jobs
            </a>
          </aside>
        </div>
      );
    case "topbar":
      return (
        <div className="print:hidden flex h-14 shrink-0 items-center justify-between gap-3 border-b-2 border-brand bg-rail px-4 text-sm text-ink-body sm:px-6">
          <p>The top bar couldn&apos;t load. The page still works.</p>
          <ReloadLink />
        </div>
      );
    case "metricbar":
      return (
        <div className="print:hidden flex h-[52px] shrink-0 items-center gap-6 border-t border-line-card bg-surface px-4 text-sm text-ink-muted sm:px-6">
          <p>Company figures couldn&apos;t load.</p>
          <ReloadLink />
        </div>
      );
    case "helper":
      return null;
  }
}

function ReloadLink() {
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      className="text-left text-link hover:text-link-hover"
    >
      Reload
    </button>
  );
}

/** Loud in the console, in one greppable shape, so a hidden region is never
 * a silent one. `componentDidCatch` receives the component stack, which is
 * the line that names the widget — the message alone rarely does. */
export function logShellRegionFailure(region: ShellRegionName, error: unknown, componentStack?: string | null) {
  console.error(
    `[shell] ${region} failed to render and was replaced by its fallback; the page is unaffected.`,
    error,
    componentStack ?? "",
  );
}

type Props = { region: ShellRegionName; children?: ReactNode };
type State = { failed: boolean };

export class ShellRegion extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logShellRegionFailure(this.props.region, error, info.componentStack);
  }

  render() {
    if (this.state.failed) return <ShellRegionFallback region={this.props.region} />;
    return <Suspense fallback={null}>{this.props.children}</Suspense>;
  }
}
