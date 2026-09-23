"use client";

import { useState } from "react";
import { money } from "@/lib/money";

/**
 * A percentage box that cannot be read as a fraction.
 *
 * THE DEFECT THIS EXISTS FOR, confirmed in a browser 2026-09-21 on a
 * contracted job with a $105,000 contract value: Retainage % accepted
 * `0.10` — the natural way somebody writes ten percent — with no warning,
 * no bound and no units anywhere except a placeholder. It saved, survived a
 * full reload as `0.1`, and every invoice made afterwards withheld $105
 * instead of $10,500. A $10,395 error, on a document a GC receives, with
 * nothing on screen suggesting anything had gone wrong.
 *
 * WHY BOUNDS WERE NOT THE FIX. `min=0 max=100` is now enforced server-side
 * and `0.10` is INSIDE it — 0.1% is a legal, if strange, retainage rate, so
 * refusing it outright would be inventing a rule the contract does not
 * have. The ambiguity is the defect, not the range, so this resolves the
 * ambiguity on screen instead:
 *
 *   1. a `%` sign INSIDE the field, to the right of what you type, that
 *      does not disappear the way a placeholder does the moment you start;
 *   2. under it, what the rate comes to IN MONEY on this job's own contract
 *      value, recomputed as you type. `0.10` reads "withholds $105 of
 *      $105,000" and `10` reads "withholds $10,500 of $105,000". A factor
 *      of a hundred is invisible in a percentage and unmissable in dollars.
 *
 * The preview is derived at render and stored nowhere — `contractValue` is
 * read from the job, and the rate that gets saved is the one in the box.
 *
 * NOTE FOR ANY TEST THAT WATCHES PAGE TEXT: this renders a figure BEFORE
 * the save, so the money string is on the page while you are still typing.
 * CLAUDE.md's vacuous-watcher entry is about exactly this shape — a needle
 * already on the page cannot fail — so a test of the save must key on
 * something only a save can produce.
 */
export function PercentField({
  name,
  defaultValue,
  label,
  contractValue,
  className,
  required,
}: {
  name: string;
  defaultValue?: string;
  label: string;
  /** The figure the percentage applies to, when there is one to show. */
  contractValue?: number | null;
  className?: string;
  required?: boolean;
}) {
  const [value, setValue] = useState(defaultValue ?? "");

  // Parsed only for the preview. The SERVER decides what saves — this is
  // deliberately the loose reading, so the preview appears for `10%` and
  // `1,0` alike rather than going blank at the moment it is most useful.
  const typed = Number(value.trim().replace(/[%,$\s]/g, ""));
  const showsMoney =
    contractValue != null &&
    contractValue > 0 &&
    value.trim() !== "" &&
    Number.isFinite(typed) &&
    typed >= 0 &&
    typed <= 100;

  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1 text-xs text-ink-body">
        {label}
        {/* `w-fit` IS LOAD-BEARING, and it took a real browser to see that.
            The parent label is `flex flex-col`, whose default
            `align-items: stretch` makes this span full width — so
            `right-2` on the `%` measured 8px from the VIEWPORT edge, not
            from the input. Measured at 1100px: the input sat at x=24 with
            a width of 96, and the `%` at x=1055. It was legible, it was
            positioned, and it was nowhere near the box. happy-dom returns
            zeros from getBoundingClientRect, so nothing in the unit suite
            could have said so. */}
        <span className="relative inline-flex w-fit items-center">
          <input
            name={name}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            required={required}
            // NOT type="number". Chromium silently discards characters it
            // cannot parse, and Firefox accepts them and then submits an
            // empty string — either way what the person typed stops being
            // what the server sees. Text plus inputMode gets the phone
            // keypad and keeps the typing honest; the server parses it.
            type="text"
            inputMode="decimal"
            placeholder="10"
            aria-describedby={showsMoney ? `${name}-preview` : undefined}
            className={className ?? "w-24 rounded-md border border-line-card bg-canvas py-1 pl-2 pr-7 text-sm text-ink placeholder:text-ink-muted focus:border-link focus:outline-none"}
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute right-2 text-sm text-ink-muted"
          >
            %
          </span>
        </span>
      </label>
      {showsMoney && (
        <p id={`${name}-preview`} className="text-xs text-ink-muted">
          Withholds {money((contractValue * typed) / 100)} of {money(contractValue)}
        </p>
      )}
    </div>
  );
}
