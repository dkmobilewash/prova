"use client";

import { useId, useState, type ReactNode } from "react";

/**
 * On a phone the agents column folds into one strip above the chat —
 * "2 running · 3 recommendations" (ai-home-phone.png) — so the chat keeps
 * the screen. A tap opens it. From `lg` up the strip is gone and the column
 * is always shown beside the chat.
 *
 * Starts closed on every render, server and client alike, so nothing here
 * can disagree at hydration.
 */
export function AiSideToggle({
  running,
  recommendations,
  children,
}: {
  running: number;
  recommendations: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 w-full items-center gap-2.5 rounded-xl border border-line-card bg-surface px-3.5 text-left text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus lg:hidden"
      >
        <span
          aria-hidden="true"
          className={`h-2 w-2 shrink-0 rounded-full ${running > 0 ? "bg-brand text-neutral-900 ring-[3px] ring-brand/20" : "bg-ink-muted"}`}
        />
        <span className="font-semibold tabular-nums">{running} running</span>
        <span aria-hidden="true" className="text-ink-muted">
          ·
        </span>
        <span className="font-semibold tabular-nums">
          {recommendations} {recommendations === 1 ? "recommendation" : "recommendations"}
        </span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`ml-auto h-4 w-4 shrink-0 text-ink-muted ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      <div id={id} className={open ? "mt-4 lg:mt-0" : "hidden lg:block"}>
        {children}
      </div>
    </>
  );
}
