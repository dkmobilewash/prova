/**
 * The six capabilities, presented two different ways depending on viewport
 * — same content, same underlying data, the LAYOUT switches. Confirmed
 * against comparable product pages rather than picked by eye: Linear,
 * Gusto and Siteline all run a horizontal snap-scroll rail on phone and
 * none of them run one at desktop, where a tab/carousel switcher is what
 * every one of them uses instead.
 *
 * - Below `sm` (phone, where Cyrus judges this): a horizontal snap-scroll
 *   rail. Native CSS scroll-snap, no JS runs the scrolling — reachable by
 *   touch, trackpad or keyboard with JS disabled entirely. Cards are
 *   85vw so the next one visibly peeks in (measured off Linear's own
 *   phone layout: 328px cards in a 390px viewport, ~84vw) — that peek is
 *   the entire affordance, no arrows, no dot indicators.
 * - `sm` and up: a tab switcher — one capability's headline and body
 *   shown at a time, the other five as labels beside it, numbered to
 *   match the numbered-control look comparable pages use (Gusto's "01 02
 *   03").
 *
 * The desktop switcher is native `<details>`/`<summary>`, not a JS
 * cross-fade. Giving every `<details>` the same `name` makes the browser
 * treat them as a mutually-exclusive group — only one open at a time,
 * like radio buttons — a real, broadly-supported HTML feature (Chrome
 * 120+, Safari 17.2+, Firefox 125+), not a hack. Chosen over a JS
 * cross-fade deliberately: every panel stays in the DOM and fully
 * readable with no motion involved in switching AT ALL, so there is
 * nothing for prefers-reduced-motion to need to disable — the requirement
 * a cross-fade would have to work to satisfy, this satisfies by
 * construction. `display: contents` on each `<details>` (see
 * .landing-tabs in globals.css) removes only the wrapper from the grid's
 * box model, so every `<summary>` lines up in the label column and the one
 * open panel's content lands in the content column beside it.
 *
 * The rail's own scroll container is components/CapabilitiesRail.tsx, a
 * small client component — see its header for why (arrow-key operation
 * needed a real key handler; touch and trackpad already worked from plain
 * CSS).
 */

import { CapabilitiesRail } from "@/components/CapabilitiesRail";

export const CAPABILITIES: { title: string; body: string }[] = [
  {
    // Job/JobLineItem unified object — ARCHITECTURE.md
    title: "One estimate, no retyping",
    body: "Price the job once. The same line items become the contract, the budget and the job-costing structure.",
  },
  {
    // lib/certified-payroll.ts, lib/fringe-remittance.ts on /union-compliance
    title: "Certified payroll & fringe remittance",
    body: "Weekly WH-347-style certified payroll, and the pension, vacation, H&W and training remittance reports, from the hours your crew already logged.",
  },
  {
    // lib/apprentice-ratio.ts — per job, per local, per day
    title: "Apprentice ratios, tracked daily",
    body: "Apprentice-to-journeyman ratio per job, per local, per day, flagged the day you go over — not a monthly average that hides it.",
  },
  {
    // lib/pay-application.ts (G702/G703) + lib/retainage.ts
    title: "Pay applications & retainage",
    body: "AIA-style pay applications built from your schedule of values, with retainage withheld and released per job.",
  },
  {
    // /rfis, /submittals, /drawings — evidence records, counters never reissued
    title: "RFIs, submittals, drawings",
    body: "Numbered, dated and never reissued once sent — a paper trail a GC can't argue with.",
  },
  {
    // DailyFieldReport, JobMedia photos, punch lists, offline outbox (#382, #403)
    title: "The field, on record",
    body: "Daily reports, site photos and punch lists — dated and attributable, from a phone that still works with no signal on site.",
  },
];

function ordinal(i: number) {
  return String(i + 1).padStart(2, "0");
}

export function CapabilitiesSection() {
  return (
    <>
      {/* ------------------------------------------------------- phone rail */}
      <div className="sm:hidden">
        <div className="relative">
          <CapabilitiesRail>
            {CAPABILITIES.map((item, i) => (
              <article
                key={item.title}
                data-rail-card
                className="w-[85vw] shrink-0 snap-start rounded-xl border border-line-card bg-surface p-6"
              >
                <span aria-hidden className="text-sm font-semibold text-ink-muted">
                  {ordinal(i)}
                </span>
                <h3 className="mt-1 text-lg font-semibold text-ink-label">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-body">{item.body}</p>
              </article>
            ))}
          </CapabilitiesRail>
          {/* Visual affordance that there is more to the right — a plain
              edge fade, not a decoration. Purely presentational: hidden
              from the accessibility tree, since the region's own
              aria-label already says there are six. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-canvas to-transparent"
          />
        </div>
        <p className="mt-3 text-xs text-ink-muted">Swipe or scroll for the rest &rarr;</p>
      </div>

      {/* ---------------------------------------------------- desktop tabs */}
      <div className="landing-tabs hidden sm:grid sm:grid-cols-[260px_1fr] sm:gap-10">
        {CAPABILITIES.map((item, i) => (
          <details key={item.title} name="capability" open={i === 0} className="contents">
            <summary>
              <span aria-hidden className="mr-3 font-mono text-sm text-ink-muted">
                {ordinal(i)}
              </span>
              {item.title}
            </summary>
            <div>
              <h3 className="text-2xl font-semibold text-ink-label">{item.title}</h3>
              <p className="mt-3 max-w-xl text-lg leading-relaxed text-ink-body">{item.body}</p>
            </div>
          </details>
        ))}
      </div>
    </>
  );
}
