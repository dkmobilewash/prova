"use client";

import {
  daysBetween,
  outcomeLabel,
  stateLabel,
  submittalState,
  type RevisionData,
} from "@/components/submittalLabels";
import { formatCalendarDay } from "@/lib/render-date";
import { DEMO_JOB } from "./panelChrome";
import { motionPlayState, useMotionCue } from "./useMotionCue";

/**
 * A submittal coming back stamped, for the public landing page — the moment
 * a submittal stops being your problem. The stamp drops onto the sheet and
 * settles at an angle; the state the app DERIVES from that arrival follows
 * it a beat later.
 *
 * WHY IT IS BESIDE "PROTECTING YOURSELF" AND NOT SOMEWHERE PRETTIER. That
 * section's argument is that the record is only worth something if it was
 * kept as it happened, and its three cards claim numbered-and-never-
 * reissued, nothing-stored-that-can-go-stale, and kept-as-it-happened. This
 * drawing is all three at once: two revisions, both kept, neither
 * renumbered; a state that is worked out from the latest revision on every
 * render rather than stored; and dates that were ENTERED. It was the one
 * ranked section on the page with no drawing beside it.
 *
 * DERIVED, NOT DRAWN AS WORDS — the discipline the four panels in this
 * folder hold, and the reason none of them can drift from the product:
 *
 *   - the stamp reads `outcomeLabel(latest.outcome)`, upper-cased.
 *     components/submittalLabels.ts OUTCOMES is where "Approved as noted"
 *     comes from, and `SubmittalRevisionOutcome.APPROVED_AS_NOTED`
 *     (operations.prisma) is where that value comes from. Rename the
 *     outcome and this stamp changes with it;
 *   - the chip reads `stateLabel(submittalState(REVISIONS))`. It says
 *     "Approved" because the LATEST revision came back approved-as-noted —
 *     `submittalState` treats approved-as-noted as approved, "build from
 *     it". Nothing here stores a status;
 *   - the days on each revision line are `daysBetween(sentOn, returnedOn)`;
 *   - the dates are `formatCalendarDay`, the app's own UTC rendering of a
 *     plain calendar day.
 *
 * The register line under the sheet is `components/SubmittalRow.tsx`'s own
 * view mode: `SUB <n>` in mono, the title, the state chip in the green tag
 * pair, the "Build from revision <n>" chip, then one line per revision with
 * sent and returned dates. If that row is restyled, restyle this with it.
 *
 * NOTHING HERE CHANGES HEIGHT WHILE IT PLAYS, which is the rule this page
 * has paid for twice (#459, #475). The stage is a fixed height and clips;
 * the stamp is absolutely positioned inside it and animates `transform` and
 * `opacity` only, so a stamp that starts at twice its size cannot widen the
 * page or push the stage; the two chips are in normal flow at rest and only
 * their opacity animates, so the line they sit on is the same height before,
 * during and after. The placement in LandingPage.tsx still carries a
 * measured `min-h-[…px]` reserve on top of that — belt and braces, because
 * "it cannot change height" is an argument and a measured reserve is a
 * floor.
 *
 * FOR A SCREEN READER. The stage — the sheet and the stamp — is
 * `aria-hidden`: it is a picture of a piece of paper, and every word on it
 * is in the register line underneath as real text. The register line, the
 * chips and the caption are in the accessibility tree exactly as they read.
 *
 * Tokens only, no new colour: the sheet is `canvas` on `surface` with
 * `line-row` rules, and the stamp is the `tag-green` pair the app puts on
 * an approved submittal (8.0:1). No image, no dependency, no `%` anywhere
 * in the markup — see the note in LandingPage.tsx for why that last one
 * matters here.
 */

/** The submittal, on the same made-up job the panels draw. `09 21 16` is
 * gypsum board assemblies, which is the scope the pay application panel
 * bills as "Fire-rated shaftwall" — one job, its own paperwork. */
const SUBMITTAL = {
  number: 12,
  title: "Fire-rated shaftwall — shop drawings",
  specSection: "09 21 16",
  drawingReference: "A-501",
} as const;

/**
 * Two revisions, because "every revision kept, none renumbered" is one of
 * the claims this drawing stands next to and one revision cannot show it.
 * R1 came back revise-and-resubmit; R2 came back approved as noted, which
 * is what the stamp is.
 */
const REVISIONS: readonly RevisionData[] = [
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

/** The revision the stamp belongs to: the highest-numbered one, which is
 * also the one `submittalState` judges the package by. */
const LATEST = REVISIONS[REVISIONS.length - 1];

/** What the stamp says, and what the register chip says. Both derived from
 * the revisions above by the product's own functions — see the header. The
 * upper case is in the string rather than in a `uppercase` class so the
 * markup carries exactly what is on screen and a guard can assert it. */
const STAMP_TEXT = LATEST?.outcome ? outcomeLabel(LATEST.outcome).toUpperCase() : "";
const STATE = submittalState([...REVISIONS]);

/** The sheet the stamp lands on: a shop drawing, drawn as rules and a title
 * block. Deliberately abstract — a fake legible drawing would be a claim
 * about a detail nobody checked. Widths are Tailwind fractions rather than
 * arbitrary percentages, for the reason the header gives. */
function Sheet() {
  const rules = ["w-full", "w-4/5", "w-full", "w-3/5", "w-11/12", "w-2/3"];
  return (
    <div className="h-[152px] w-[116px] shrink-0 rounded-sm border border-line-card bg-canvas p-2.5">
      {rules.map((width, index) => (
        <span
          key={index}
          className={`mb-2 block h-[3px] rounded-full bg-line-row ${width}`}
        />
      ))}
      <span className="mt-3 block border-t border-line-row pt-1 font-mono text-[7px] leading-tight text-ink-muted">
        {SUBMITTAL.specSection}
        <br />
        {SUBMITTAL.drawingReference}
      </span>
    </div>
  );
}

export function SubmittalStamp({ className = "" }: { className?: string }) {
  const { ref, playing } = useMotionCue<HTMLElement>();

  return (
    <figure
      ref={ref}
      data-landing-stamp="figure"
      data-motion-play={motionPlayState(playing)}
      className={`landing-stamp w-full min-w-0 max-w-[34rem] overflow-hidden rounded-xl border border-line-card bg-surface text-left ${className}`}
    >
      <p className="border-b border-line-row px-4 py-2 text-sm font-semibold text-ink">Submittals</p>

      {/* The stage. Fixed height, clipped, and out of the accessibility
          tree: the register line below says all of this in words. */}
      <div
        aria-hidden="true"
        data-landing-stamp="stage"
        className="relative flex h-[188px] items-center justify-center overflow-hidden bg-canvas"
      >
        <Sheet />
        <span
          data-landing-stamp="mark"
          className="landing-stamp__mark absolute left-1/2 top-1/2 max-w-[9rem] rounded border-[3px] border-tag-green-ink bg-tag-green px-2 py-1 text-center font-mono text-xs font-bold leading-tight tracking-[0.08em] text-tag-green-ink"
        >
          {STAMP_TEXT}
        </span>
      </div>

      {/* SubmittalRow.tsx's view mode, on this package. */}
      <div className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-ink-muted">SUB {SUBMITTAL.number}</span>
          <span className="min-w-0 text-ink">{SUBMITTAL.title}</span>
          <span
            data-landing-stamp="state"
            className="landing-stamp__settled rounded bg-tag-green px-1.5 py-0.5 text-xs text-tag-green-ink"
          >
            {stateLabel(STATE)}
          </span>
          {LATEST && (
            <span
              data-landing-stamp="build-from"
              className="landing-stamp__settled rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-ink-body"
            >
              Build from revision {LATEST.revisionNumber}
            </span>
          )}
        </div>

        <ul className="mt-2 flex flex-col gap-1 border-l-2 border-line-card pl-3">
          {REVISIONS.map((revision) => {
            const days =
              revision.returnedOn != null ? daysBetween(revision.sentOn, revision.returnedOn) : null;
            return (
              <li key={revision.revisionNumber} className="text-xs text-ink-body">
                <span className="font-mono text-ink-muted">R{revision.revisionNumber}</span>
                {` · sent ${formatCalendarDay(revision.sentOn)}`}
                {revision.returnedOn && revision.outcome && (
                  <>
                    {` · ${outcomeLabel(revision.outcome).toLowerCase()} ${formatCalendarDay(revision.returnedOn)}`}
                    {days !== null && days >= 0 && ` · ${days} day${days === 1 ? "" : "s"}`}
                  </>
                )}
              </li>
            );
          })}
        </ul>

        <p className="mt-1 text-xs text-ink-muted">
          {DEMO_JOB.name} · {SUBMITTAL.specSection} · {SUBMITTAL.drawingReference}
        </p>
      </div>

      {/* `ink-body`, not `ink-muted`: the sentence that keeps the drawing
          honest clears the text-contrast floor, the same rule
          panelChrome.tsx's caption and AskDemo's follow. */}
      <figcaption className="border-t border-line-row px-4 py-2 text-[11px] leading-relaxed text-ink-body">
        Example. Your submittals, your revisions. Approved is worked out from what came back, never
        stored.
      </figcaption>
    </figure>
  );
}
