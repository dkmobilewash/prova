"use client";

import { useEffect, type ReactNode } from "react";

/**
 * A 360px detail column that PUSHES the content left rather than covering
 * it.
 *
 * Deliberately not a modal, not a drawer, not position:fixed. It renders
 * as a real sibling in the shell's flex row, so the content column
 * reflows beside it and stays readable — the point of a detail panel on a
 * dashboard is comparing the row you opened against the list it came
 * from, and a panel that covers the list defeats that.
 *
 * Generic on purpose. The first caller is an invoice, but an equipment or
 * vendor detail view wants exactly this shape, and a second bespoke
 * implementation is how two panels end up behaving differently.
 */
export function SidePanel({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  // Escape closes it. Without this the only way out is a small button, and
  // a panel you cannot dismiss by reflex feels stuck.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside
      aria-label={title}
      className="hidden w-[360px] shrink-0 flex-col border-l border-line-card bg-surface lg:flex"
    >
      <div className="flex items-start justify-between gap-3 border-b border-line-card px-5 py-4">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-ink">{title}</h2>
          {subtitle && <p className="truncate text-xs text-ink-body">{subtitle}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close panel"
          className="-mr-1 -mt-1 rounded-md p-1.5 text-ink-muted hover:bg-tag-slate hover:text-ink"
        >
          <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Scrolls on its own so a long timeline never pushes the actions
          out of reach. */}
      <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

      {footer && <div className="border-t border-line-card px-5 py-3">{footer}</div>}
    </aside>
  );
}
