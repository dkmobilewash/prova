"use client";

import { motionPlayState, useMotionCue } from "./useMotionCue";

/**
 * THE EXPLANATION ON `/wall-takeoff`, AND IT IS A PICTURE RATHER THAN A
 * PARAGRAPH.
 *
 * A drawing sheet on the left, the list that came off it on the right, and a
 * line that sweeps down the sheet while the rows fill in beside it. That is
 * the entire offer: we read your set, you get the list back. The page was
 * rebuilt around this figure because the first version explained the same
 * thing in four card sections and roughly four hundred words, and a sub
 * skimming a link from a text message does not read four hundred words.
 *
 * ── WHY THE MOTION IS A SEQUENCE, WHICH NOTHING ELSE HERE IS ──
 *
 * `[data-reveal]` lifts a whole section as one block, with no stagger, and
 * that is right for a section: it is one thought arriving. This figure is not
 * one thought, it is a process — sheets going in, rows coming out — so the
 * rows arrive in order, 260ms apart, behind a sweep that takes 2.2s. It is
 * the only staggered motion on either public page, and the reason is that
 * here the ORDER is the information.
 *
 * ── AT REST IT IS FINISHED, AND THAT IS NOT A FALLBACK ──
 *
 * Every row is present and readable with no JavaScript at all, and the sweep
 * is `opacity: 0` by its base rule in globals.css. So the server render, a
 * browser with JS off, and a reader who asked for less motion all get a
 * drawing beside the list that came off it — the claim made without a frame
 * of animation. The motion only re-enacts what is already shown, which is
 * why `useMotionCue` is the right hook here and `Reveal` is not: nothing may
 * be hidden waiting for an observer that might never fire.
 *
 * Gated twice and independently, like the other two figures: the hook never
 * sets `playing` under reduced motion, and the CSS that animates lives
 * entirely inside a `prefers-reduced-motion: no-preference` block, so a bug
 * in either layer still cannot move anything for a reader who asked it not
 * to. It REPLAYS on the way back up the page, because scrolling to a figure
 * to watch it again is the obvious thing a person does.
 *
 * ── THE HEIGHT RULE ──
 *
 * The sheet stage is a fixed height (`--takeoff-read-stage`) and clips, so
 * the sweep is absolutely positioned inside it and cannot push anything. The
 * rows are always in the layout and animate opacity and a 6px lift only. So
 * nothing changes its own height as this plays and nothing below it moves,
 * which is the rule two bugs on the main landing page paid for.
 */

/**
 * One illustrative set. Six rows rather than sixty-one: the point is the
 * SHAPE of what comes back, and a figure a person can read in two seconds
 * makes it better than a full index would.
 *
 * The duplicate `A-3` is the whole reason this figure earns its place — it is
 * the finding a sub would have missed, and it is why the list is worth having
 * before the bid rather than after. Deliberately NOT a real customer's set:
 * there are no customers yet, and the caption says the figures are
 * illustrative in as many words.
 */
const SAMPLE_SHEETS: readonly { sheet: string; title: string }[] = [
  { sheet: "A-001", title: "Cover sheet, drawing index" },
  { sheet: "A-101", title: "Level 1 floor plan" },
  { sheet: "A-102", title: "Level 2 floor plan" },
  { sheet: "A-3", title: "Partition types and schedule" },
  { sheet: "A-3", title: "Interior elevations, east wing" },
  { sheet: "A-611", title: "Ceiling details (scanned)" },
];

export function SheetReadFigure() {
  const { ref, playing } = useMotionCue<HTMLDivElement>();

  return (
    <div
      ref={ref}
      data-motion-play={motionPlayState(playing)}
      className="takeoff-read mt-10 flex flex-col gap-5 sm:mt-12 lg:flex-row lg:items-stretch lg:gap-5"
    >
      {/* What goes in */}
      <div className="min-w-0 flex-1">
        <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">You send</p>
        <div className="relative h-[var(--takeoff-read-stage)] overflow-hidden rounded-xl border border-line-card bg-surface p-4">
          {/* A sheet, drawn rather than screenshotted: a title block in the
              corner where the sheet number lives, and enough rule lines and
              boxes to read as a drawing without pretending to be one. */}
          <div className="flex h-full flex-col border border-line-row bg-canvas p-3.5">
            <div aria-hidden className="flex flex-1 flex-col gap-2.5">
              <div className="h-px w-[82%] bg-line-card" />
              <div className="h-px w-[64%] bg-line-row" />
              <div className="mt-1 flex gap-2">
                <div className="h-12 w-[74px] border border-line-card" />
                <div className="h-12 w-[52px] border border-line-row" />
                <div className="h-12 w-24 border border-line-row" />
              </div>
              <div className="mt-1.5 h-px w-[78%] bg-line-row" />
              <div className="h-px w-[54%] bg-line-row" />
              <div className="mt-1 flex gap-2">
                <div className="h-11 w-[120px] border border-line-row" />
                <div className="h-11 w-[60px] border border-line-card" />
              </div>
              <div className="mt-1.5 h-px w-[70%] bg-line-row" />
            </div>
            <div className="mt-2.5 self-end border border-line-card px-2.5 py-1.5">
              <p className="text-[13px] font-semibold tabular-nums text-ink">A-101</p>
            </div>
          </div>
          {/* The sweep. Absolutely positioned in the clipped stage so it
              cannot affect the figure's height.
              A BORDER RATHER THAN A FILL, and not for looks. `bg-brand` here
              failed `theme-contrast.test.ts`, which requires every brand FILL
              to carry a `text-neutral-900` label — white on this yellow is
              1.53:1, and that census exists because `packages/ui/Button.tsx`
              once shipped exactly that past a green check. This line carries
              no label at all, so the census's premise does not hold for it;
              the honest answer is to stop calling a 2px rule a fill rather
              than to bolt a text colour onto a div with no text, or to carve
              an exemption into a guard with that scar attached. A rule line
              IS a border. */}
          <div
            aria-hidden
            className="takeoff-read__sweep absolute inset-x-4 top-4 border-t-2 border-brand"
          />
        </div>
      </div>

      {/* The direction of travel. Rotated at phone width, where the panels
          stack and an arrow pointing right would point at nothing. */}
      <div aria-hidden className="flex shrink-0 justify-center self-center lg:px-0.5">
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

      {/* What comes back */}
      <div className="min-w-0 flex-1">
        <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">You get</p>
        <div className="flex h-[var(--takeoff-read-stage)] flex-col rounded-xl border border-line-card bg-surface px-4 py-2.5">
          <ul className="flex flex-col">
            {SAMPLE_SHEETS.map((row, i) => (
              <li
                key={`${row.sheet}-${row.title}`}
                className="takeoff-read__row flex items-baseline gap-3 border-b border-line-row py-2.5 text-[13.5px]"
                style={{ "--takeoff-read-index": i } as React.CSSProperties}
              >
                <span className="w-14 shrink-0 font-semibold tabular-nums text-ink">{row.sheet}</span>
                <span className="min-w-0 flex-1 truncate text-ink-body">{row.title}</span>
              </li>
            ))}
          </ul>
          <p className="mt-auto flex items-center gap-2 rounded-lg bg-tag-amber px-3 py-2.5 text-[13px] font-semibold text-tag-amber-ink">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              aria-hidden
              className="shrink-0"
            >
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
              <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
            </svg>
            Two sheets stamped A-3
          </p>
        </div>
      </div>
    </div>
  );
}
