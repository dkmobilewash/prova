import { describe, expect, it } from "vitest";
import {
  BAND_LABELS,
  qualify,
  type QualifyingSignal,
} from "@/lib/sales-qualification";
import {
  buildSalesPipeline,
  longestOpen,
  trackedOpenCount,
  winRateLabel,
  type PipelineOpportunity,
} from "@/lib/sales-pipeline";
import { daysInCurrentStage, type RecordedStageChange } from "@/lib/sales-stage-history";
import { money } from "@/lib/money";
import {
  PIPELINE_OPPORTUNITIES,
  PROJECT_CLAIM,
  RESEARCHED_LEAD_SIGNALS,
  SALES_EXPECTED,
} from "./salesFixture";

/**
 * EVERY SENTENCE `specs/sales-crm.spec.ts` LOOKS FOR, RE-DERIVED FROM THE
 * FIXTURE BY THE APP'S OWN FUNCTIONS.
 *
 * The e2e suite needs a real Clerk development instance and a production build,
 * so it does not run on every push and it cannot run in an agent container at
 * all. This file does run on every push, and it answers the one question that
 * would otherwise only be answerable from a twenty-minute red CI job: are the
 * literals in `salesFixture.ts` what this fixture actually produces?
 *
 * Nothing on `/sales` or `/sales/[id]` is stored. The fit band comes from
 * `qualify` over the signals and every pipeline figure from
 * `buildSalesPipeline` over the opportunities, both on every read — so editing
 * a fixture row silently changes what the page says, and the spec then fails
 * naming a string, which reads exactly like a product defect. This turns that
 * into "the fixture and its expectation disagree", in three seconds.
 *
 * THE DIRECTION MATTERS AND IS DELIBERATE. The spec asserts LITERALS; this file
 * proves the literals are right. A spec that recomputed its expectation by
 * calling `qualify` itself would pass however wrong `qualify` became — the
 * circular check this repo keeps finding in other forms. Here the literal is
 * the fixed point and the function is what is measured against it.
 *
 * WHAT IT CANNOT SEE, stated so nobody reads a green here as more than it is:
 * it says nothing about whether either page RENDERS, whether the gate lets the
 * operator through, or whether the confirm button works. Those are the browser's
 * to answer. This only rules out one specific way the browser run could go red
 * for a reason that is not a defect.
 */

/** The fixture's signals in the shape `qualify` reads. Mirrors what
 *  `app/(app)/sales/[id]/page.tsx` selects for `SalesLeadSignals`. */
const asQualifying = (signals: readonly (typeof RESEARCHED_LEAD_SIGNALS)[number][]): QualifyingSignal[] =>
  signals.map((signal) => ({
    kind: signal.kind,
    state: signal.state,
    claim: signal.claim,
    disqualifies: signal.disqualifies,
  }));

/** Fixed, so nothing in this file depends on the day it runs. Every
 *  expectation pinned here is date-independent by construction — see
 *  salesFixture.ts — and this value exists only because the functions take a
 *  `today` argument. */
const TODAY = "2026-06-01";

/** The fixture's opportunities in the shape the page hands the band, including
 *  the `daysInStage` derivation the page performs. */
const asPipeline = (): PipelineOpportunity[] =>
  PIPELINE_OPPORTUNITIES.map((opportunity, index) => {
    const changes: RecordedStageChange[] = opportunity.stageChanges.map(
      ([fromStage, toStage, effectiveOn], order) => ({
        id: `change-${index}-${order}`,
        fromStage,
        toStage,
        effectiveOn,
        note: null,
        recordedAt: `${effectiveOn}T00:00:00.000Z`,
      }),
    );

    return {
      id: `opportunity-${index}`,
      leadId: "lead-pipeline",
      companyName: "fixture",
      stage: opportunity.stage,
      estimatedMrr: opportunity.estimatedMrr,
      expectedCloseDate: null,
      daysInStage: daysInCurrentStage(changes, TODAY),
    };
  });

describe("the fixture is a fixture at all", () => {
  // The floor first: every assertion below passes on empty arrays, and an
  // empty signal list would quietly make the band THIN and agree with a
  // `reasonNoSignals` expectation it was never meant to describe.
  it("carries signals and opportunities", () => {
    expect(RESEARCHED_LEAD_SIGNALS.length).toBe(3);
    expect(PIPELINE_OPPORTUNITIES.length).toBe(3);
  });

  it("holds exactly one PROPOSED signal, which is the one the spec confirms", () => {
    const proposed = RESEARCHED_LEAD_SIGNALS.filter((s) => s.state === "PROPOSED");
    expect(proposed).toHaveLength(1);
    // Two "Confirm" buttons on one page and the spec's locator dies in strict
    // mode rather than failing about the product.
    expect(proposed[0].kind).toBe("PROJECT");
    expect(proposed[0].claim).toBe(PROJECT_CLAIM);
  });

  it("gives no confirmed signal a reviewer, so 'checked by' cannot be on the page first", () => {
    // The seed writes `reviewedByUserId: null` for every row here; this pins
    // the INTENT, because the one observable that proves the confirm landed is
    // a sentence rendered from that column.
    expect(RESEARCHED_LEAD_SIGNALS.some((s) => s.state === "CONFIRMED")).toBe(true);
    expect(SALES_EXPECTED.reviewedBy).toContain("checked by ");
  });

  it("keeps the project claim short enough to render verbatim", () => {
    // `shortClaim` truncates at 120 and appends an ellipsis; the spec asserts
    // the whole sentence, so a longer claim would fail about nothing.
    expect(PROJECT_CLAIM.length).toBeLessThanOrEqual(120);
    expect(PROJECT_CLAIM.trim()).toBe(PROJECT_CLAIM);
  });

  it("prices some deals and leaves one unpriced, so neither arm of the band is unexercised", () => {
    // Not decoration: `sliceLabel` has a `none priced` branch and an
    // `N unpriced` tail, and a fixture that was all one or all the other would
    // leave the spec asserting a sentence the product can reach two ways.
    expect(PIPELINE_OPPORTUNITIES.filter((o) => o.estimatedMrr !== null).length).toBeGreaterThan(0);
    expect(PIPELINE_OPPORTUNITIES.filter((o) => o.estimatedMrr === null).length).toBe(1);
  });
});

describe("the fit band the researched lead renders", () => {
  it("is WORTH_A_CALL before the proposed signal is reviewed", () => {
    const before = qualify(asQualifying([...RESEARCHED_LEAD_SIGNALS]));

    expect(BAND_LABELS[before.band]).toBe(SALES_EXPECTED.bandBeforeConfirm);
    expect(before.reason).toBe(SALES_EXPECTED.reasonBeforeConfirm);
    // The badge the spec counts on /sales: 1 before, gone after.
    expect(before.awaitingReview).toBe(1);
    expect(`${before.awaitingReview} to check`).toBe(SALES_EXPECTED.awaitingReviewBadge);
  });

  it("is STRONG once it is confirmed, with the claim itself as the reason", () => {
    const after = qualify(
      asQualifying(
        RESEARCHED_LEAD_SIGNALS.map((signal) =>
          signal.state === "PROPOSED" ? { ...signal, state: "CONFIRMED" as const } : signal,
        ),
      ),
    );

    expect(BAND_LABELS[after.band]).toBe(SALES_EXPECTED.bandAfterConfirm);
    expect(after.reason).toBe(SALES_EXPECTED.reasonAfterConfirm);
    expect(after.awaitingReview).toBe(0);
  });

  it("prints a DIFFERENT band either side of the confirm, which is what makes the spec non-vacuous", () => {
    // The assertion the spec rests on: "Call this one" cannot already be on
    // the page. If these two ever collapsed to one label the spec would pass
    // without the review having done anything — CLAUDE.md's watcher whose
    // needle is already there, in band form.
    expect(SALES_EXPECTED.bandBeforeConfirm).not.toBe(SALES_EXPECTED.bandAfterConfirm);
    expect(SALES_EXPECTED.bandAfterConfirm).not.toContain(SALES_EXPECTED.bandBeforeConfirm);
    expect(SALES_EXPECTED.reasonBeforeConfirm).not.toBe(SALES_EXPECTED.reasonAfterConfirm);
  });
});

describe("the fit band the pipeline lead renders", () => {
  it("is THIN, because it has no signals at all", () => {
    const none = qualify([]);
    expect(BAND_LABELS[none.band]).toBe(SALES_EXPECTED.bandNoSignals);
    expect(none.reason).toBe(SALES_EXPECTED.reasonNoSignals);
  });

  it("is not the band the researched lead shows, so one row cannot be read for the other", () => {
    expect(SALES_EXPECTED.bandNoSignals).not.toBe(SALES_EXPECTED.bandBeforeConfirm);
    expect(SALES_EXPECTED.bandNoSignals).not.toBe(SALES_EXPECTED.bandAfterConfirm);
  });
});

describe("the pipeline band the seeded opportunities produce", () => {
  const pipeline = buildSalesPipeline(asPipeline(), TODAY);

  it("counts one open deal, priced, and renders it as the Trial card's figure", () => {
    const trial = pipeline.columns.find((column) => column.stage === "TRIAL");
    expect(trial, "the TRIAL column always exists — OPEN_STAGES includes it").toBeDefined();
    expect(trial!.count).toBe(1);
    expect(trial!.unpriced).toBe(0);
    // `sliceLabel` in SalesPipelineBand.tsx: `${money(mrr)}/mo across ${count}`.
    expect(`${money(trial!.mrr)}/mo across ${trial!.count}`).toBe(SALES_EXPECTED.openSlice);
    // And the "Open" line is the same slice, which is why one literal serves
    // both — stated rather than assumed, so a second open deal fails here.
    expect(`${money(pipeline.open.mrr)}/mo across ${pipeline.open.count}`).toBe(SALES_EXPECTED.openSlice);
  });

  it("has something decided, so there is a win rate at all", () => {
    expect(`${pipeline.won.count} / ${pipeline.lost.count}`).toBe(SALES_EXPECTED.wonLost);
    const rate = winRateLabel(pipeline.winRate);
    expect(rate, "a null rate renders 'no win rate yet' and the spec would be asserting the wrong branch").not.toBeNull();
    expect(`${rate} win rate`).toBe(SALES_EXPECTED.winRate);
  });

  it("leaves one open deal without a close date, which the band prints as a digit", () => {
    expect(String(pipeline.openWithoutCloseDate)).toBe(SALES_EXPECTED.openWithoutCloseDate);
    // The two date-dependent lines are both empty, which is what keeps every
    // expectation above true on any day.
    expect(pipeline.closingSoon.count).toBe(0);
    expect(pipeline.overdueToClose.count).toBe(0);
  });

  it("renders the unpriced arm, so a null MRR is never read as zero", () => {
    expect(pipeline.lost.unpriced).toBe(1);
    expect(pipeline.lost.mrr).toBe(0);
  });

  it("gives 'Sitting longest' something to compute over", () => {
    // Without a recorded stage history that whole block is absent from the
    // page, and the spec's link to the pipeline lead — the one unambiguous
    // link to it — comes from it.
    const longest = longestOpen(asPipeline(), 3);
    expect(longest).toHaveLength(1);
    // And tracked == open, so the band renders no "of N with tracked history"
    // qualifier. That qualifier carries numbers the spec does not assert; this
    // pins that it is absent rather than merely unasserted.
    expect(trackedOpenCount(asPipeline())).toBe(pipeline.open.count);
  });
});
