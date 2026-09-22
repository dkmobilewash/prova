import type { ReactNode } from "react";

import { formatHoursOrNull } from "@/lib/render-hours";

/**
 * The shared frame for the four landing-page panels beside it in this folder
 * (PayApplicationPanel, CertifiedPayrollPanel, ApprenticeRatioPanel,
 * JobCostPanel).
 *
 * WHAT A PANEL IS. Not a screenshot, and nothing here calls it one. Each panel
 * is one document the product genuinely produces, re-rendered as plain markup
 * with the SAME labels the app puts on screen and the SAME arithmetic — the
 * figures are computed at render time by the very functions the app uses
 * (`lib/pay-application.ts`, `lib/wh347.ts`, `lib/apprentice-ratio.ts`,
 * `lib/wip.ts`), fed illustrative inputs on a made-up job. So a panel cannot
 * drift from the product: change the arithmetic and the drawing changes with
 * it. Every panel's own header comment names the screen it copies.
 *
 * THE FRAME OWNS THE HONESTY LINE. The figcaption saying the figures are
 * illustrative is rendered here, unconditionally, so no panel can forget it.
 * It is real text at rest — not a tooltip, not a hover.
 *
 * SIZE-AWARE BY CONTAINER, NOT VIEWPORT. These panels render in three very
 * different boxes on one page: the hero's 420px column at desktop, a ~320px
 * card in the phone rail, and a ~800px tab body. A viewport breakpoint would
 * show eight table columns in a 420px column, so the frame declares itself a
 * CSS container (`container-type: inline-size`) and the panels hide or show
 * columns with `@container` queries against the panel's own width. Tailwind
 * 3.4 handles both as arbitrary values/variants, so no plugin and no CSS
 * module is involved. On a browser without container-query support the
 * narrow-width rules never apply and every column shows; the table then
 * scrolls inside its own `overflow-x-auto` box, never the page.
 *
 * Tokens only (`surface`, `line-card`, `line-row`, the `ink-*` scale, the
 * `tag-*` pairs) so both themes come through the config, and nothing here is
 * a new colour.
 */
export function PanelFrame({
  title,
  meta,
  children,
  caption,
  className = "",
}: {
  /** The document's own name, as the app titles it. */
  title: string;
  /** The line under the title on the real screen — job, GC, date, local. */
  meta?: string;
  children: ReactNode;
  /** Extra sentence for the footer. The illustrative-figures line is always
   * present regardless. */
  caption?: string;
  className?: string;
}) {
  return (
    <figure
      className={`min-w-0 overflow-hidden rounded-xl border border-line-card bg-surface text-left [container-type:inline-size] ${className}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-line-row px-4 py-3">
        <p className="text-sm font-semibold text-ink">{title}</p>
        {meta && <p className="text-xs text-ink-muted">{meta}</p>}
      </div>
      <div className="min-w-0 px-4 py-4">{children}</div>
      {/* `ink-body`, not `ink-muted`: this is the one sentence on the panel
          that must clear the text-contrast floor, because it is the sentence
          that keeps the panel honest. */}
      <figcaption className="border-t border-line-row px-4 py-2 text-[11px] leading-relaxed text-ink-body">
        {caption ? `${caption} ` : ""}
        Figures are illustrative; labels and arithmetic are C Stream&rsquo;s own.
      </figcaption>
    </figure>
  );
}

/** A label-over-value tile, laid out the way the app's own summary grids are
 * (`text-xs` muted label above the value — see the G702 block on
 * `jobs/[id]/pay-applications/[invoiceId]/page.tsx` and the WIP tiles on the
 * estimate tab). `tone` reuses the app's emphasis: the payment due is green,
 * an overbilled position is amber. */
export function Tile({
  label,
  value,
  tone = "plain",
  note,
  className = "",
}: {
  label: string;
  value: string;
  tone?: "plain" | "good" | "warn";
  /** The app's own caveat text under a tile, rendered in the amber it uses. */
  note?: string;
  className?: string;
}) {
  const valueClass =
    tone === "good"
      ? "font-medium text-tag-green-ink"
      : tone === "warn"
        ? "text-tag-amber-ink"
        : "text-ink";
  return (
    <div className={`min-w-0 ${className}`}>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className={`text-sm tabular-nums ${valueClass}`}>{value}</p>
      {note && <p className="mt-1 text-[11px] leading-snug text-tag-amber-ink">{note}</p>}
    </div>
  );
}

/** A plain calendar day at UTC midnight — the convention every date column in
 * the schema uses ("stored at UTC midnight, rendered in UTC", CLAUDE.md). All
 * panel dates are fixed literals, never `new Date()`, so a server render and
 * the client agree byte for byte. */
export function utcDay(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/** `formatCalendarDate(date, "medium")` from lib/render-date.ts, restated for
 * a fixed UTC day: "Aug 29, 2026". */
export function calendarDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Hours as the WH-347 sheet prints them — "8", "7.5", never "8.00" and
 * never "0" for a blank cell.
 *
 * This was a FOURTH copy of the arithmetic, which is the exact thing
 * `lib/render-hours.ts` exists to prevent and which `hoursRenderCensus`
 * caught on merge. The panels on this page run the product's real
 * functions on purpose; rounding hours was the one place they quietly
 * stopped doing that, and a marketing page printing
 * `35.300000000000004` to a prospect is the demo of the bug rather than
 * the demo of the fix. The blank for null is the WH-347 rule — a dash in
 * a box a federal reviewer reads as a number is worse than nothing. */
export function hoursCell(hours: number | null): string {
  return formatHoursOrNull(hours);
}

/** "75.6%" — the continuation sheet's own `percent()` on the pay-application
 * page (one decimal, em dash when there is nothing to divide by). */
export function sheetPercent(value: number | null): string {
  return value != null ? `${(value * 100).toFixed(1)}%` : "—";
}

/** The made-up job every panel is drawn on. One name, so the four panels read
 * as four documents from one job rather than four unrelated pictures. Not a
 * real project, GC or company. */
export const DEMO_JOB = {
  name: "Northgate Clinic TI",
  gc: "Westbrook Builders (GC)",
  contractor: "Northgate Interiors, Inc.",
  contractorAddress: "2200 Commerce Dr, Reno, NV 89502",
} as const;
