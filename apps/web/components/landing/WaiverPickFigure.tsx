"use client";

import { WAIVER_TYPES_COPY } from "@/lib/lien-waiver-offer";
import { motionPlayState, useMotionCue } from "./useMotionCue";

/**
 * THE EXPLANATION ON `/lien-waiver`, AND IT IS A PICTURE.
 *
 * The four types on the left, one of them chosen, and the state's form
 * taking shape on the right. The choice happens first because the choice is
 * the product: conditional before the money clears, unconditional after, and
 * signing the wrong one gives up a lien right for nothing.
 *
 * ── THE FORM ON THE RIGHT IS A SHAPE, NOT A FORM ──
 *
 * It shows labelled blanks filling in. It carries NO statutory language, no
 * heading copied from a statute and no notice text, and it must never grow
 * any: the real wording is prescribed by each state, it is not established
 * yet, and a landing page is the last place it should first appear. What is
 * drawn here is the PRODUCT's shape — a document with your details in it —
 * which is what a sub needs to understand before clicking.
 *
 * ── SAFE AT REST MEANS FINISHED ──
 *
 * With no JavaScript, or for a reader who asked for less motion, the safe
 * type is already chosen and every line is already filled. The motion only
 * re-enacts what is shown. Gated twice and independently, like the other
 * figures on the public pages: the hook never sets `playing` under reduced
 * motion, and the CSS lives inside a `prefers-reduced-motion: no-preference`
 * block, so a bug in either layer still cannot move anything.
 *
 * Fixed-height, clipped stages on both sides, and the lines only animate
 * opacity and a small lift — so nothing changes its own height as it plays
 * and nothing below it moves.
 */

/** Illustrative only. A made-up job, deliberately: there are no customers. */
const SAMPLE_LINES: readonly { label: string; value: string }[] = [
  { label: "Claimant", value: "Northgate Drywall LLC" },
  { label: "Customer", value: "Westbrook Builders (GC)" },
  { label: "Job", value: "Riverside Medical Center" },
  { label: "Through", value: "September 30, 2026" },
  { label: "Amount", value: "$48,210.00" },
  { label: "Exceptions", value: "Retention held — not waived" },
];

export function WaiverPickFigure() {
  const { ref, playing } = useMotionCue<HTMLDivElement>();

  return (
    <div
      ref={ref}
      data-motion-play={motionPlayState(playing)}
      className="waiver-pick mt-10 flex flex-col gap-5 sm:mt-12 lg:flex-row lg:items-stretch"
    >
      {/* Pick the type */}
      <div className="min-w-0 flex-1">
        <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          1 &middot; Pick the right one
        </p>
        <ul className="flex h-[var(--waiver-pick-stage)] flex-col gap-2.5 overflow-hidden rounded-xl border border-line-card bg-surface p-4">
          {WAIVER_TYPES_COPY.map((type) => (
            <li
              key={type.key}
              className={`flex min-h-0 flex-1 gap-3 rounded-lg border p-3 ${
                type.safeDefault
                  ? "waiver-pick__chosen border-brand bg-tag-brand-soft"
                  : "waiver-pick__other border-line-card"
              }`}
            >
              {/* The chosen one gets a check, the rest an empty ring.
                  NOT a `bg-brand` dot: `theme-contrast.test.ts` requires
                  every brand FILL to carry a `text-neutral-900` label, and
                  this marker has no text at all — the same reason the
                  takeoff figure's sweep is a border rather than a fill.
                  A check is the better mark here regardless. */}
              {type.safeDefault ? (
                <svg
                  aria-hidden
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="mt-1 h-3.5 w-3.5 shrink-0 text-brand"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              ) : (
                <span
                  aria-hidden
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full border border-line-card"
                />
              )}
              <div className="min-w-0">
                <p
                  className={`text-[13.5px] font-semibold ${
                    type.safeDefault ? "text-tag-brand-soft-ink" : "text-ink-label"
                  }`}
                >
                  {type.name}
                </p>
                <p
                  className={`mt-0.5 text-xs leading-snug ${
                    type.safeDefault ? "text-tag-amber-ink" : "text-ink-muted"
                  }`}
                >
                  {type.risk}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Direction of travel — rotated where the panels stack. */}
      <div aria-hidden className="flex shrink-0 justify-center self-center lg:px-2">
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="rotate-90 text-ink-muted lg:rotate-0"
        >
          <path d="M5 12h14" />
          <path d="m13 6 6 6-6 6" />
        </svg>
      </div>

      {/* The form taking shape. Shape only — no statutory text, ever. */}
      <div className="min-w-0 flex-1">
        <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          2 &middot; Get it filled in
        </p>
        <div className="h-[var(--waiver-pick-stage)] overflow-hidden rounded-xl border border-line-card bg-surface p-4">
          <div className="flex h-full flex-col rounded bg-[#fafafa] px-4 py-3.5">
            <p className="text-[10.5px] uppercase tracking-wider text-[#6b6b6b]">
              Your state&rsquo;s statutory form
            </p>
            <div className="mt-3 flex flex-col gap-2.5">
              {SAMPLE_LINES.map((line, i) => (
                <div
                  key={line.label}
                  className="waiver-pick__line flex items-baseline gap-2 text-[11.5px]"
                  style={{ "--waiver-pick-index": i } as React.CSSProperties}
                >
                  <span className="w-[86px] shrink-0 text-[#6b6b6b]">{line.label}</span>
                  <span className="min-w-0 flex-1 truncate border-b border-[#d0d0d0] pb-px font-semibold tabular-nums text-[#171717]">
                    {line.value}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-auto text-[10px] leading-snug text-[#6b6b6b]">
              Illustrative. The wording on the real form is your state&rsquo;s own.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
