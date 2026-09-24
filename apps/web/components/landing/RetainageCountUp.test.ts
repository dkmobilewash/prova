/**
 * The retainage count-up, as markup — and the one assertion here that is
 * worth more than the rest: THE TWO DRAWINGS OF THIS JOB AGREE.
 *
 * The count-up and the pay application panel are placed in the same section
 * of the landing page, on the same made-up job. The pay application computes
 * "Retainage to date" from its schedule of values; the count-up sums the
 * per-invoice snapshots that same money is. If those two numbers ever differ,
 * a visitor who adds up the page gets two answers on one job — which is worse
 * than either drawing alone, and is exactly the failure this page's whole
 * discipline exists to prevent. So both components are rendered here and the
 * figures are compared.
 *
 * What this file cannot assert: layout or motion. happy-dom does no layout and
 * returns zeros from `getBoundingClientRect`, so the height reserve was
 * measured in real Chromium — see LandingPage.tsx's note. The classes that
 * carry those measurements are asserted in app/page.test.ts.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { money } from "@/lib/money";
import { PayApplicationPanel } from "./PayApplicationPanel";
import { RetainageCountUp } from "./RetainageCountUp";
// From the PLAIN module, not from the "use client" component: a value exported
// across the RSC boundary arrives as a client-reference proxy, and
// lib/client-boundary.test.ts refuses the import that would do it.
import { RETAINAGE_DRAWING } from "./retainageDrawing";

const html = renderToStaticMarkup(createElement(RetainageCountUp));

/** The class list of the element carrying `handle`, as a LIST — see the note
 * in the fill assertion for why a substring match is not enough. */
function classesOf(handle: string): string[] {
  const at = html.indexOf(handle);
  if (at === -1) return [];
  const match = html.slice(at).match(/class="([^"]*)"/);
  return (match?.[1] ?? "").split(/\s+/).filter(Boolean);
}
const payApplication = renderToStaticMarkup(createElement(PayApplicationPanel));

describe("the retainage count-up is the product's own arithmetic", () => {
  it("agrees with the pay application panel beside it, on the same job", () => {
    // The pay application's "Retainage to date" tile IS the total withheld on
    // this job to date. Not a copy of a number: the panel computes it with
    // calculatePayAppSummary from its schedule of values, this component sums
    // the snapshots with calculateRetainageSummary, and the two must land on
    // the same cents.
    const withheld = money(RETAINAGE_DRAWING.totalWithheld);
    expect(withheld).toMatch(/^\$[\d,]+\.\d\d$/);
    expect(
      payApplication,
      `the pay application panel does not print ${withheld} — the two drawings of ` +
        `this job have drifted, and a reader who adds up the page now gets two answers`,
    ).toContain(withheld);
    expect(html).toContain(withheld);
  });

  it("shows withheld, released and the balance, and the balance is the subtraction", () => {
    expect(RETAINAGE_DRAWING.balance).toBe(
      RETAINAGE_DRAWING.totalWithheld - RETAINAGE_DRAWING.totalReleased,
    );
    expect(RETAINAGE_DRAWING.totalReleased).toBeGreaterThan(0);
    for (const figure of [
      RETAINAGE_DRAWING.totalWithheld,
      RETAINAGE_DRAWING.totalReleased,
      RETAINAGE_DRAWING.balance,
    ]) {
      expect(html).toContain(money(figure));
    }
    // The product's own labels, from the Retainage tab and the dashboard card.
    expect(html).toContain("Outstanding balance");
    expect(html).toContain("Total withheld");
    expect(html).toContain("Total released");
    expect(html).toContain("Withheld and not yet released");
  });

  it("settles on the real figure at rest, never on zero", () => {
    // What reduced motion, a browser with no JavaScript and the server render
    // all get: the number already arrived. The count only ever overwrites it
    // while it is playing.
    expect(html).toContain('data-motion-play="idle"');
    expect(html).not.toContain('data-motion-play="playing"');
    const value = html.match(/data-landing-countup="value"[^>]*>([^<]+)</)?.[1] ?? "";
    expect(value).toBe(money(RETAINAGE_DRAWING.balance));
    expect(value).not.toBe(money(0));
  });

  it("keeps the digits on one line, and the bar's fill animatable by transform", () => {
    // Class lists compared as LISTS, not by substring: `landing-countup__fill`
    // is a prefix of `landing-countup__filled`, and a rename that breaks the
    // animation outright would otherwise pass. Found by mutation on the
    // stamp's twin of this test.
    //
    // `whitespace-nowrap` is the height rule: the string grows as it counts,
    // and a wrap would change this element's height mid-animation.
    const value = classesOf('data-landing-countup="value"');
    expect(value).toContain("whitespace-nowrap");
    expect(value).toContain("tabular-nums");
    // The join with globals.css. Rename it and the bar silently stops.
    expect(classesOf('data-landing-countup="fill"')).toContain("landing-countup__fill");
    expect(classesOf("<figure")).toContain("landing-countup");
  });

  it("draws the bar from the dollar amounts themselves, with no percentage in the markup", () => {
    // Two flex children, grown by the two figures — so the fill is exactly as
    // wide as the balance is of the withheld, with one fewer number to keep in
    // step. And nothing here is a percentage: app/page.test.ts runs `\d+%`
    // over this page's prose, and these figures are prose rather than
    // `data-landing-panel` placements, so `w-[63%]` or `style="width:68%"`
    // would trip that guard exactly as a sentence would.
    expect(html).not.toContain("%");
    expect(html).toContain(`flex-grow:${RETAINAGE_DRAWING.balance}`);
    expect(html).toContain(`flex-grow:${RETAINAGE_DRAWING.totalReleased}`);
  });

  it("tells a screen reader the figure in dollars, on the bar itself", () => {
    expect(html).toContain('role="progressbar"');
    expect(html).toContain(`aria-valuemax="${RETAINAGE_DRAWING.totalWithheld}"`);
    expect(html).toContain(`aria-valuenow="${RETAINAGE_DRAWING.balance}"`);
    expect(html).toContain(money(RETAINAGE_DRAWING.balance));
  });

  it("says it is an example, at rest, in text a reader can see", () => {
    expect(html).toContain("Example. Your jobs, your invoices.");
    // Not PanelFrame's caption: that string is counted one-per-panel-
    // placement by app/page.test.ts, and this figure is not a panel.
    expect(html).not.toMatch(/[Ff]igures are illustrative/);
  });
});
