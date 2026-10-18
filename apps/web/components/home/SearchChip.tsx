"use client";

import type { ReactNode } from "react";

/** A home shortcut that opens the ⌘K palette pre-filled, for an action that
 * needs a job picked first. Same event the shell's search box sends. */
export function SearchChip({ query, className, children }: { query: string; className: string; children: ReactNode }) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => window.dispatchEvent(new CustomEvent("cstream:open-search", { detail: { query } }))}
    >
      {children}
    </button>
  );
}
