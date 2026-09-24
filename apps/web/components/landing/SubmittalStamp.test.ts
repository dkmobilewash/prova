/**
 * The submittal stamp, as markup.
 *
 * What this file can assert: that every word on the drawing is DERIVED by the
 * product's own functions rather than typed next to them, that the finished
 * record is what renders at rest, and that the class hooks the motion hangs
 * off are still on the elements they animate.
 *
 * What it cannot: anything about layout or motion. happy-dom does no layout
 * and returns zeros from `getBoundingClientRect`, and the animation is a CSS
 * rule in globals.css, so the height reserve and the stamp's landing were
 * measured in real Chromium instead — the numbers are in LandingPage.tsx's
 * note and in the changelog, and the placement classes that carry them are
 * asserted in app/page.test.ts.
 *
 * The derivations are asserted against the SAME functions the component uses,
 * called here with the same inputs, rather than against a copy of their
 * output: "Approved as noted" written as a literal in both files would agree
 * with itself forever, including after somebody renamed the outcome.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { outcomeLabel, stateLabel, submittalState, type RevisionData } from "@/components/submittalLabels";
import { formatCalendarDay } from "@/lib/render-date";
import { SubmittalStamp } from "./SubmittalStamp";

const html = renderToStaticMarkup(createElement(SubmittalStamp));

/** The class list of the element carrying `handle`, as a LIST. A substring
 * match on a class name passes for any name that merely starts with it — see
 * the mutation note below. */
function classesOf(handle: string): string[] {
  const at = html.indexOf(handle);
  if (at === -1) return [];
  const match = html.slice(at).match(/class="([^"]*)"/);
  return (match?.[1] ?? "").split(/\s+/).filter(Boolean);
}

/** The revisions the component draws, restated here so the expectations
 * below run through the real functions. If these fall out of step with the
 * component the assertions fail, which is the point. */
const REVISIONS: RevisionData[] = [
  {
    revisionNumber: 1,
    sentOn: "2026-08-10",
    dueBack: "2026-08-17",
    returnedOn: "2026-08-14",
    outcome: "REVISE_AND_RESUBMIT",
    responseNotes: null,
  },
  {
    revisionNumber: 2,
    sentOn: "2026-08-21",
    dueBack: "2026-08-28",
    returnedOn: "2026-08-28",
    outcome: "APPROVED_AS_NOTED",
    responseNotes: null,
  },
];

describe("the submittal stamp draws what the product derives", () => {
  it("stamps the LATEST revision's outcome, in the product's own words", () => {
    // Not the string "APPROVED AS NOTED": the label, upper-cased, from
    // components/submittalLabels.ts OUTCOMES — which is where the enum value
    // in operations.prisma is turned into English. Rename it and this fails.
    const expected = outcomeLabel("APPROVED_AS_NOTED").toUpperCase();
    expect(expected).not.toBe("APPROVED_AS_NOTED"); // the label exists at all
    const stamp = html.match(/data-landing-stamp="mark"[^>]*>([^<]+)</)?.[1] ?? "";
    expect(stamp, "no element carries the stamp").not.toBe("");
    expect(stamp).toBe(expected);
  });

  it("chips the state submittalState() computes, not a stored one", () => {
    const state = submittalState(REVISIONS);
    // Approved-as-noted IS approved — "build from it".
    expect(state).toBe("APPROVED");
    const chip = html.match(/data-landing-stamp="state"[^>]*>([^<]+)</)?.[1] ?? "";
    expect(chip).toBe(stateLabel(state));
    // And the chip carries the app's own approved pair, not a new colour.
    expect(html).toMatch(/data-landing-stamp="state" class="[^"]*bg-tag-green[^"]*text-tag-green-ink/);
    const buildFrom = html.match(/data-landing-stamp="build-from"[^>]*>([^<]+)</)?.[1] ?? "";
    expect(buildFrom).toBe("Build from revision 2");
  });

  it("keeps BOTH revisions, neither renumbered, with the dates that were entered", () => {
    // The claim the section this sits in makes, drawn rather than asserted:
    // R1 came back revise-and-resubmit and is still there.
    for (const revision of REVISIONS) {
      expect(html).toContain(`R${revision.revisionNumber}`);
      expect(html).toContain(formatCalendarDay(revision.sentOn));
      expect(revision.outcome).not.toBeNull();
      expect(html).toContain(outcomeLabel(revision.outcome as string).toLowerCase());
    }
    // Days open is daysBetween(sent, returned) — 4 on R1, 7 on R2 — and it is
    // computed, so a wrong date shows up as a wrong count rather than nowhere.
    expect(html).toContain("4 days");
    expect(html).toContain("7 days");
  });

  it("renders the FINISHED record at rest: the stamp landed and the chips there", () => {
    // What a reader with prefers-reduced-motion, a browser with no
    // JavaScript, and the server all get. "idle" is the at-rest attribute the
    // CSS does NOT animate.
    expect(html).toContain('data-motion-play="idle"');
    expect(html).not.toContain('data-motion-play="playing"');
    expect(html).toContain('data-landing-stamp="mark"');
    expect(html).toContain('data-landing-stamp="state"');
  });

  it("keeps the class hooks the motion hangs off, and the stage that clips it", () => {
    // These class names are the join between this component and globals.css.
    // Renaming one here silently stops the animation — nothing else would
    // notice, because the finished state is what the markup already is.
    //
    // TOKENISED, NOT SUBSTRING-MATCHED, and that is a mutation finding rather
    // than a preference: the first version of this assertion was
    // `toMatch(/class="[^"]*landing-stamp__mark/)`, and renaming the class to
    // `landing-stamp__marker` — which breaks the animation completely — left
    // it GREEN, because the old name is a prefix of the new one. A class list
    // is a list; compare it as one.
    expect(classesOf('data-landing-stamp="mark"')).toContain("landing-stamp__mark");
    const settled = (html.match(/landing-stamp__settled(?=[\s"])/g) ?? []).length;
    expect(settled, "both derived chips fade in with the stamp").toBe(2);
    expect(classesOf("<figure")).toContain("landing-stamp");
    // The stage is a FIXED height and clips: a stamp that starts at twice its
    // size must not be able to push anything or widen the page.
    const stage = classesOf('data-landing-stamp="stage"');
    expect(stage.length, "no stage element").toBeGreaterThan(0);
    expect(stage.some((c) => /^h-\[\d+px\]$/.test(c)), `stage classes: ${stage.join(" ")}`).toBe(true);
    expect(stage).toContain("overflow-hidden");
    expect(stage).toContain("relative");
    // The mark is positioned OUT of flow, so it cannot take part in layout.
    expect(classesOf('data-landing-stamp="mark"')).toContain("absolute");
  });

  it("carries no percentage anywhere in its markup", () => {
    // app/page.test.ts runs an invented-statistic pattern (`\d+%` among
    // others) over this page's prose, and these figures are prose — they are
    // not `data-landing-panel` placements. A class like `w-[63%]` or an
    // inline `style="width:68%"` would trip it exactly as a sentence would,
    // which is why every width here is a Tailwind fraction.
    expect(html).not.toContain("%");
  });

  it("says it is an example, at rest, in text a reader can see", () => {
    expect(html).toContain("Example. Your submittals, your revisions.");
    // Not PanelFrame's caption: that string is counted one-per-panel-
    // placement by app/page.test.ts, and this figure is not a panel.
    expect(html).not.toMatch(/[Ff]igures are illustrative/);
  });

  it("keeps the picture out of the accessibility tree and the record in it", () => {
    // The sheet and the stamp are a picture of a piece of paper; every word
    // on them is in the register line underneath as real text.
    expect(html).toMatch(/aria-hidden="true" data-landing-stamp="stage"/);
    expect(html).toContain("<figcaption");
  });
});
