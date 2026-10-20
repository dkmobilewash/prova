"use client";

import { Hint } from "@/components/Hint";

/**
 * A short label whose explanation is a `<Hint>` rather than a paragraph on
 * the page — a column heading, an "About units" note above a list.
 *
 * Client, because `<Hint>` may only be rendered from a client component
 * (`hintClientOnly.test.ts`, and MetricBar.tsx says why). Server pages pass
 * plain strings, which cross the boundary safely.
 *
 * The span is focusable so the words reach a keyboard, not only a mouse.
 */
export function HintedText({ label, hint, className = "" }: { label: string; hint: string; className?: string }) {
  return (
    <Hint text={hint}>
      <span
        tabIndex={0}
        className={`cursor-help underline decoration-dotted underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${className}`}
      >
        {label}
      </span>
    </Hint>
  );
}
