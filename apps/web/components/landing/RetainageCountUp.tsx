"use client";

import { useEffect, useRef } from "react";

import { money } from "@/lib/money";
import { DEMO_JOB } from "./panelChrome";
import { COUNT_MS, RETAINAGE_DRAWING } from "./retainageDrawing";
import { motionPlayState, useMotionCue } from "./useMotionCue";

/**
 * The retainage a GC is still holding, counting up to its real value with a
 * bar filling under it — for the public landing page, beside the claim it
 * belongs to: "Retainage held and released per job, calculated from the job
 * rather than remembered in a spreadsheet".
 *
 * WHY THIS NUMBER AND NOT A NICER ONE. A landing page with a big invented
 * figure on it is exactly what this page is guarded against, so the figure
 * is not invented: retainageDrawing.ts holds illustrative per-invoice
 * snapshots and one logged release, and every number on screen comes out of
 * `calculateRetainageSummary` (lib/retainage.ts) — the same function the
 * Retainage tab calls. This drawing cannot say something the product's
 * arithmetic does not, and if that arithmetic changes the drawing changes
 * with it.
 *
 * THE LABELS ARE THE PRODUCT'S OWN. "Total withheld", "Total released" and
 * "Outstanding balance" are the three figures the Retainage tab prints
 * (app/(app)/jobs/[id]/(tabs)/retainage/page.tsx); "Withheld and not yet
 * released" is the dashboard's own detail line under its Retainage held
 * card, and `bar-teal` is that card's accent. Nothing here is a new word or
 * a new colour.
 *
 * IT AGREES WITH THE PAY APPLICATION BESIDE IT. Both drawings are the same
 * made-up job. The snapshots in retainageDrawing.ts sum to the "Retainage to
 * date" that PayApplicationPanel computes for it, so a reader who adds up the
 * two drawings gets one answer: withheld less released is the balance. That
 * agreement is asserted in RetainageCountUp.test.ts by rendering BOTH and
 * comparing the figures, because two drawings of one job that disagree is
 * worse than either of them alone.
 *
 * THE FIGURES AND THE ARITHMETIC ARE IN retainageDrawing.ts, not here, and
 * that is the RSC boundary rather than tidiness: a value exported from a
 * "use client" module reaches a server module as a client-reference proxy
 * (lib/client-boundary.test.ts, which caught exactly this on the first
 * attempt). Same split as AskDemo.tsx and askDemoScript.ts.
 *
 * NO PERCENTAGE ANYWHERE, and that is not squeamishness. The page-wide
 * invented-statistic guard in app/page.test.ts matches `\\d+%` over the
 * page's own prose, and a class name or an inline style is markup like any
 * other — `w-[63%]` or `style="width:68%"` would trip it just as a sentence
 * would. So the bar is two flex children whose `flex-grow` values ARE the
 * two dollar amounts, which is both guard-safe and one fewer number to keep
 * in step: the fill is exactly as wide as the balance is of the withheld.
 *
 * NOTHING HERE CHANGES HEIGHT WHILE IT PLAYS. The digits are
 * `tabular-nums` and never wrap, so a growing string changes the element's
 * WIDTH and nothing else; the bar's fill animates `transform: scaleX`,
 * which does not affect layout, rather than its width. The placement in
 * LandingPage.tsx carries a measured `min-h-[…px]` reserve as well — the
 * rule this page has paid for twice (#459, #475).
 *
 * THE COUNT IS WRITTEN STRAIGHT TO THE DOM, one line of the reason being
 * that AskDemo.tsx does the same for its clock: React renders the FINAL
 * value, always, so the server markup and every re-render carry the truth,
 * and the frame loop only overwrites the text while it is counting. Sixty
 * React renders a second to animate one string would be the tail wagging
 * the dog, and any re-render lands back on the real figure. Stopping —
 * scrolling away, unmounting, a reduced-motion setting changing — restores
 * the final value, so this can never be left showing half a number.
 */

export function RetainageCountUp({ className = "" }: { className?: string }) {
  const { ref, playing } = useMotionCue<HTMLElement>();
  const valueRef = useRef<HTMLParagraphElement>(null);
  const settled = money(RETAINAGE_DRAWING.balance);

  useEffect(() => {
    const el = valueRef.current;
    if (!el || !playing) return;
    let request = 0;
    const started = performance.now();
    const tick = (now: number) => {
      const progress = Math.min((now - started) / COUNT_MS, 1);
      // Ease out, so it arrives rather than stops — the same shape
      // `--ease-landing` gives the bar beside it.
      const eased = 1 - (1 - progress) ** 3;
      el.textContent = money(Math.round(RETAINAGE_DRAWING.balance * eased * 100) / 100);
      if (progress < 1) {
        request = requestAnimationFrame(tick);
        return;
      }
      el.textContent = settled;
    };
    request = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(request);
      // Never leave half a number on screen.
      el.textContent = settled;
    };
  }, [playing, settled]);

  return (
    <figure
      ref={ref}
      data-landing-countup="figure"
      data-motion-play={motionPlayState(playing)}
      className={`landing-countup w-full min-w-0 max-w-[34rem] overflow-hidden rounded-xl border border-line-card bg-surface text-left ${className}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-line-row px-4 py-2">
        <p className="text-sm font-semibold text-ink">Retainage</p>
        <p className="text-xs text-ink-muted">{DEMO_JOB.name}</p>
      </div>

      <div className="px-4 py-4">
        <p className="text-xs text-ink-muted">Outstanding balance</p>
        {/* `whitespace-nowrap` is load-bearing: the string grows from "$0.00"
            to its real length as it counts, and a wrap would change this
            element's HEIGHT mid-animation, which is the one thing nothing on
            this page may do. At the narrowest column this line measures well
            inside the content box — see the numbers in LandingPage.tsx. */}
        <p
          ref={valueRef}
          data-landing-countup="value"
          className="mt-1 whitespace-nowrap text-4xl font-semibold tabular-nums text-ink sm:text-5xl"
        >
          {settled}
        </p>
        <p className="mt-1 text-sm text-ink-body">Withheld and not yet released</p>

        {/* The bar. The track is everything ever withheld on this job; the
            filled part is what is still held, so the gap at the right IS the
            release. Proportions are the dollar amounts themselves (see the
            header), and the fill grows by `transform`, never by width. */}
        <div
          className="mt-4 flex h-1.5 w-full overflow-hidden rounded-full bg-line-row"
          role="progressbar"
          aria-label="Retainage still held, of everything withheld on this job"
          aria-valuemin={0}
          aria-valuemax={RETAINAGE_DRAWING.totalWithheld}
          aria-valuenow={RETAINAGE_DRAWING.balance}
          aria-valuetext={`${money(RETAINAGE_DRAWING.balance)} of ${money(RETAINAGE_DRAWING.totalWithheld)} still held`}
        >
          <span
            data-landing-countup="fill"
            className="landing-countup__fill h-full rounded-full bg-bar-teal"
            style={{ flexGrow: RETAINAGE_DRAWING.balance, flexBasis: 0 }}
          />
          <span
            aria-hidden="true"
            className="h-full"
            style={{ flexGrow: RETAINAGE_DRAWING.totalReleased, flexBasis: 0 }}
          />
        </div>

        <dl className="mt-2 flex flex-wrap justify-between gap-x-4 text-xs">
          <div className="flex gap-1.5">
            <dt className="text-ink-muted">Total withheld</dt>
            <dd className="tabular-nums text-ink-body">{money(RETAINAGE_DRAWING.totalWithheld)}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-ink-muted">Total released</dt>
            <dd className="tabular-nums text-ink-body">{money(RETAINAGE_DRAWING.totalReleased)}</dd>
          </div>
        </dl>
      </div>

      {/* `ink-body`, not `ink-muted`: the sentence that keeps the figure
          honest clears the text-contrast floor, as panelChrome.tsx's caption
          and AskDemo's do. */}
      <figcaption className="border-t border-line-row px-4 py-2 text-[11px] leading-relaxed text-ink-body">
        Example. Your jobs, your invoices. Withheld less released, worked out from the job — this one
        is made up.
      </figcaption>
    </figure>
  );
}
