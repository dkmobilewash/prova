"use client";

import { useState, type ReactNode } from "react";
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
 */
export function CollapsedForm({
  label,
  children,
  startOpen = false,
}: {
  /** The closed button's text, e.g. "Add a catalog entry". */
  label: string;
  children: ReactNode;
  startOpen?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={primaryActionClass}>
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
