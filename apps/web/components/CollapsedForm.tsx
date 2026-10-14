"use client";

import { useEffect, useState, type ReactNode } from "react";
import { primaryActionClass, secondaryActionClass } from "@/components/emptyStateStyles";

/**
 * An add-form that waits behind one button — the list-page convention
 * (CLAUDE.md "List pages": "add-form collapsed behind a button") for a page
 * whose form is server-rendered markup rather than its own client component.
 *
 * The children are rendered only once opened, so an EmptyState's
 * OpenFormButton, which presses the first button inside the page's
 * `data-tour` anchor, presses THIS button and then focuses the form's first
 * field. Put the anchor on a wrapper around this component.
 *
 * Declutter (2026-10-13): every form the density audit found open on load
 * goes behind this. Two things a page needs for that to be safe —
 *
 *   - `startOpen` for a `?new=1`-style deep link the SERVER can see. A form
 *     that can start open is server markup: no `localToday()` in it
 *     (`startOpenDateCensus.test.ts`).
 *   - `openOnHash` for a `#log-time`-style deep link the server CANNOT see.
 *     The closed button carries that id, so `HashLanding` scrolls to it,
 *     and the form opens itself after mount when the hash matches. The
 *     form inside keeps the same id, so the link still lands once open.
 *
 * `tone="secondary"` for the second or third collapsed form on a page: the
 * page keeps ONE yellow primary action.
 */
export function CollapsedForm({
  label,
  children,
  startOpen = false,
  openOnHash,
  tone = "primary",
}: {
  /** The closed button's text, e.g. "Add a catalog entry". */
  label: string;
  children: ReactNode;
  startOpen?: boolean;
  /** Without the `#`: open on arrival when `location.hash` names this. */
  openOnHash?: string;
  tone?: "primary" | "secondary";
}) {
  const [open, setOpen] = useState(startOpen);
  useEffect(() => {
    if (!openOnHash) return;
    const check = () => {
      if (window.location.hash === `#${openOnHash}`) setOpen(true);
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, [openOnHash]);
  if (!open) {
    return (
      <button
        type="button"
        id={openOnHash}
        onClick={() => setOpen(true)}
        className={tone === "primary" ? primaryActionClass : secondaryActionClass}
      >
        {label}
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {children}
      <div>
        <button type="button" onClick={() => setOpen(false)} className={secondaryActionClass}>
          Close
        </button>
      </div>
    </div>
  );
}
