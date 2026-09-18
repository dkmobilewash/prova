"use client";

import { useEffect, useState } from "react";
import { browserOfferDismissed, dismissBrowserOffer, startFullTour } from "@/lib/walkthroughs/full-tour";

/**
 * The one-time offer of the full tour, on a brand-new account's dashboard.
 *
 * OFFERED, NEVER STARTED FOR THEM. A tour that takes over the screen the
 * first time someone logs in is the thing people close without reading. A
 * single line they can take or dismiss costs nothing to ignore.
 *
 * Remembered per browser (localStorage): "No thanks" and starting the tour
 * both retire it. Hidden until the browser has been asked, so the server
 * markup never contains it and hydration cannot disagree — and a browser
 * whose storage cannot be read never shows it, rather than showing it on
 * every visit because it cannot remember the answer.
 */
export function FullTourOffer() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    setShow(!browserOfferDismissed());
  }, []);

  if (!show) return null;

  return (
    <div
      role="region"
      aria-label="Tour of C Stream"
      className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-line-card bg-surface px-4 py-3"
    >
      <p className="min-w-0 flex-1 text-sm text-ink-body">
        <span className="font-medium text-ink">New here?</span> Take a three-minute tour of C Stream, page by page.
        Nothing is clicked or changed for you.
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setShow(false);
            startFullTour();
          }}
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 text-sm font-semibold text-neutral-900 hover:bg-yellow-500"
        >
          Take the tour
        </button>
        <button
          type="button"
          onClick={() => {
            setShow(false);
            dismissBrowserOffer();
          }}
          className="inline-flex min-h-11 items-center justify-center rounded-md px-3 text-sm text-ink-body hover:bg-rail-hover hover:text-ink"
        >
          No thanks
        </button>
      </div>
    </div>
  );
}
