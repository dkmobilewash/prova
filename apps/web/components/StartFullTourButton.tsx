"use client";

import { startFullTour } from "@/lib/walkthroughs/full-tour";

/** A plain link-styled button that starts "Take the full tour". The tour is
 * run by `FullTour` in the layout; this only asks it to begin. */
export function StartFullTourButton({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <button
      type="button"
      onClick={startFullTour}
      className={
        className ??
        "inline-flex min-h-11 items-center text-sm font-medium text-link hover:text-link-hover hover:underline"
      }
    >
      {children}
    </button>
  );
}
