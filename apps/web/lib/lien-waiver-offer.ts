import { WAIVER_FORM_LABELS, type WaiverCondition, type WaiverStage } from "@/lib/lien-waiver";

/**
 * THE LIEN WAIVER LANDING PAGE, AS COPY — AND NOTHING ELSE.
 *
 * The generator is Diego's and ALREADY EXISTS: `lib/lien-waiver.ts` holds
 * the condition/stage vocabulary, the exceptions candidates and the
 * warnings; `lib/actions/lienWaivers.ts`, `lib/lien-waiver-query.ts`,
 * `components/LienWaivers.tsx` and `packages/db/prisma/schema/
 * lien-waivers.prisma` are the feature. This module is the public page's
 * words and no part of the machine.
 *
 * ── THE FOUR TYPES ARE DERIVED, NOT RETYPED ──
 *
 * They come from `WaiverCondition × WaiverStage` and their names from
 * `WAIVER_FORM_LABELS`, so the page cannot call a waiver something the app
 * does not. The first draft of this file hardcoded its own four-name list,
 * which is the second-copy shape CLAUDE.md records costing a bid $1,732.50
 * when Ask kept its own rate array. Only the sentences a marketing page
 * needs — when a sub reaches for this one, and what it costs them if they
 * reach at the wrong moment — are written here, keyed by the same pair.
 *
 * ── WHAT THIS PAGE MAY AND MAY NOT SAY ──
 *
 * It may describe what the tool does and when each type applies, in the
 * sub's words. It may NOT reproduce statutory language, quote a form, or
 * tell anyone which waiver to sign. Every claim here is about workflow —
 * when a waiver goes out, what the GC does with it — and none is a claim
 * about what a document legally achieves.
 */

export const WAIVER_LAUNCH_STATES = ["Arizona", "California", "Nevada", "Texas"] as const;

export type WaiverFormKey = `${WaiverCondition}_${WaiverStage}`;

export type WaiverTypeCopy = {
  readonly key: WaiverFormKey;
  /** From WAIVER_FORM_LABELS — never retyped here. */
  readonly name: string;
  /** When a sub reaches for this one, in their words. */
  readonly when: string;
  /** What it costs them if they reach for it at the wrong moment. */
  readonly risk: string;
  /** The one the page's figure lands on: safe because nothing is given up
   *  until the money actually arrives. */
  readonly safeDefault: boolean;
};

/** The sub-facing sentences, keyed by the app's own condition/stage pair so
 *  a type cannot exist in one place and not the other. */
const WHEN_AND_RISK: Readonly<
  Record<WaiverFormKey, { when: string; risk: string; safeDefault: boolean }>
> = {
  CONDITIONAL_PROGRESS: {
    when: "You are sending this period's pay application and have not been paid for it yet.",
    risk: "Safe — it only takes effect once the payment actually clears.",
    safeDefault: true,
  },
  UNCONDITIONAL_PROGRESS: {
    when: "The check for this period has cleared your account.",
    risk: "Takes effect the moment you sign. Never on a promise.",
    safeDefault: false,
  },
  CONDITIONAL_FINAL: {
    when: "Last payment on the job, and it is not in your hands yet.",
    risk: "Safe, but it is final — anything still owed has to be listed.",
    safeDefault: false,
  },
  UNCONDITIONAL_FINAL: {
    when: "The last payment has cleared.",
    risk: "Gives up what is left of your lien rights on this job.",
    safeDefault: false,
  },
};

export const WAIVER_TYPES_COPY: readonly WaiverTypeCopy[] = (
  Object.keys(WAIVER_FORM_LABELS) as WaiverFormKey[]
).map((key) => ({
  key,
  name: WAIVER_FORM_LABELS[key],
  ...WHEN_AND_RISK[key],
}));

/** What the sub gets out of it. Workflow claims only — see the header. */
export const WAIVER_OUTCOMES: readonly { lead: string; tail: string }[] = [
  {
    lead: "Goes out with the pay app, not chasing it.",
    tail: "Most GCs hold the payment until they have one in hand.",
  },
  {
    lead: "The tool picks the type with you.",
    tail: "Conditional before the check clears, unconditional after — getting that backwards is the costly one.",
  },
  {
    lead: "Your state's own form.",
    tail: "Arizona, California, Nevada and Texas each prescribe their own wording, and they are not interchangeable.",
  },
];

/** Said plainly on the page, at the same size as the promises. */
export const WAIVER_LIMITS: readonly string[] = [
  "We fill in the state's form. We do not write our own and we do not change its wording.",
  "We do not give legal advice, and nothing here is a substitute for your attorney.",
  "You check the filled form before you sign it. It is your signature and your lien rights.",
];
