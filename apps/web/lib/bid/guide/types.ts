/**
 * THE JOB GUIDE — what C Stream Bid tells a person about one job: which of the
 * five steps are done, which one they are on, and the ONE thing that needs them
 * now. The home screen ("Needs you", the bids down the side) and a job's own
 * screen (the step rail and the card in the middle) both render this shape and
 * nothing else, so the two can never disagree about where a job stands.
 *
 * DERIVED, NEVER STORED (CLAUDE.md: derived state is never stored). A guide is
 * worked out from the job's own rows on every read by `buildJobGuide`
 * (`./buildJobGuide.ts`), a pure function of `JobGuideFacts`
 * (`./facts.ts`, loaded by `loadJobGuideFacts`).
 *
 * THE WORDS ARE WRITTEN BY CODE, NOT A MODEL. Every sentence here is built from
 * the facts, so it is instant, free, cannot state a wrong number, and works
 * with AI switched off. A model may later re-phrase a guide; it may never be
 * the source of a figure in one (ARCHITECTURE.md: the model narrates, code
 * computes).
 */

/** The five steps of a bid, in order. */
export type GuideStepKey = "invite" | "walls" | "price" | "proposal" | "send";

export const GUIDE_STEP_KEYS: readonly GuideStepKey[] = ["invite", "walls", "price", "proposal", "send"];

/** done = finished; current = the one the person is on; todo = not reached. */
export type GuideStepStatus = "done" | "current" | "todo";

export type GuideStep = {
  key: GuideStepKey;
  /** Short label for the rail: "Invite read", "Walls measured", "Price it"… */
  label: string;
  status: GuideStepStatus;
  /** One line under the label, or null: "1,920 LF · 14 openings · 6 sheets". */
  summary: string | null;
};

/**
 * Something the person can do about the ask. Exactly one of `href` (go there)
 * or `actionId` (a server action the screen knows how to run, with a confirm
 * where it writes) is set. `primary` marks the one yellow button; at most one
 * action in an ask is primary.
 */
export type GuideAction = {
  label: string;
  href?: string;
  actionId?: GuideActionId;
  /** Opaque argument for the action (an id), never a URL. */
  actionArg?: string;
  primary?: boolean;
  /**
   * A TAP ANSWER to the ask's question ("8 ft", "9 ft"…), drawn as a chip in a
   * row of its own rather than as a button. An ask whose actions include chips
   * marks NONE of them primary: the answers are equals, and choosing one for
   * the person would be the guess the question exists to avoid.
   */
  chip?: boolean;
  /** The sentence over [Cancel] [Yes, do it] when this action is armed, in
   * place of the general "This changes your estimate. Go ahead?" — for a write
   * whose reach is wider than this estimate (a wall type's default height or
   * board layers). */
  confirm?: string;
};

/**
 * Server actions a guide may name. Each is implemented elsewhere and gated by
 * MANAGE_ESTIMATING like every estimating action; the guide only names them.
 * Add a member here before using it.
 */
export type GuideActionId =
  | "applyRecap" // put the recap's bid onto the line prices (applyBidRecap)
  | "usePastPrice" // price a wall type from the same type on a past job (lib/bid/guide/pastPrice)
  | "setWallHeight" // a wall type's default height, from a tap answer (lib/bid/guide/wallHeight, updateWallType)
  | "setBoardLayers"; // a wall type's board layers each side, from a tap answer (lib/bid/guide/boardLayers, updateWallType)

/**
 * Asks about a DATE that passes on its own — the job walk, the RFI cutoff.
 * Unlike every other ask, nothing in the app finishes them: they stop being
 * true when the day goes by, and a missed one cannot be made up later. The home
 * list ranks them just under a blocked bid for that reason (`homeView.ts`).
 */
export const TIME_BOXED_ASK_IDS: readonly string[] = ["job-walk", "rfi-cutoff"];

/** The ONE thing that needs the person now, or null when nothing does. */
export type GuideAsk = {
  /** Stable id for the kind of ask, for tests and analytics: "no-drawings", "no-scale", "unpriced-wall-types"… */
  id: string;
  /** Which step it belongs to. */
  step: GuideStepKey;
  /** One sentence: "W2 rated wall (680 LF) has no price in your price book." */
  title: string;
  /** Optional second sentence with the suggestion: "You priced a 6\" 1-HR wall on Civic Center in September. Use that?" */
  body: string | null;
  actions: GuideAction[];
};

/** Severity of an item on the home "Needs you" list. */
export type GuideTone = "question" | "ready" | "update" | "working" | "blocked";

export type JobGuide = {
  jobId: string;
  /** The estimate job's name. */
  name: string;
  /** The GC the job is bid to (the estimate's GC), or null. */
  gcName: string | null;
  /** Plain due line, or null: "due Thu 2:00 PM". Day granularity is enough when no time. */
  dueLabel: string | null;
  steps: GuideStep[];
  /** Headline for the job screen: "Almost priced. One thing needs you." */
  headline: string;
  ask: GuideAsk | null;
  /** The bid as it stands (bidTotalOf over live lines), or null when nothing is priced. */
  bidSoFar: number | null;
  /** For the home list: the pill, and one short line ("W2 wall has no price"). */
  tone: GuideTone;
  oneLine: string;
};
