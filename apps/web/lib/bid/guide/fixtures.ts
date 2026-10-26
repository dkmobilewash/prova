import type { GuideStep, GuideStepKey, GuideStepStatus, JobGuide } from "./types";

/**
 * Hand-written JobGuide values, one per stage of a bid, for tests and for the
 * layout checks in a real browser. FOR TESTS ONLY — nothing in the app imports
 * this. The words mirror what `buildJobGuide` is specified to write, but these
 * are not its output: a change to the engine's sentences does not need to
 * touch them, and they must never be used to assert what the engine says.
 */

const LABELS: Record<GuideStepKey, string> = {
  invite: "Invite read",
  walls: "Walls measured",
  price: "Price it",
  proposal: "Proposal",
  send: "Send",
};

function steps(
  statuses: Record<GuideStepKey, GuideStepStatus>,
  summaries: Partial<Record<GuideStepKey, string>>,
): GuideStep[] {
  return (Object.keys(LABELS) as GuideStepKey[]).map((key) => ({
    key,
    label: LABELS[key],
    status: statuses[key],
    summary: summaries[key] ?? null,
  }));
}

const BASE = { gcName: "Hartwell Builders", dueLabel: "due Thu 2:00 PM" };

/** No drawings yet: the walls step is current and the ask is a link. */
export const GUIDE_NO_DRAWINGS: JobGuide = {
  ...BASE,
  jobId: "job_invite",
  name: "Riverside Medical, L2",
  steps: steps(
    { invite: "done", walls: "current", price: "todo", proposal: "todo", send: "todo" },
    { invite: "from the GC's email", walls: "1 thing needs you", price: "after the walls", proposal: "writes itself after pricing", send: "to Hartwell Builders" },
  ),
  headline: "Got the invite. I need the drawings.",
  ask: {
    id: "no-drawings",
    step: "walls",
    title: "There are no drawings on this bid yet.",
    body: "Add the plan set and I will measure the walls for you.",
    actions: [
      { label: "Add the drawings", href: "/bid/estimates/job_invite/takeoff", primary: true },
      { label: "Not now", href: "/bid/bids" },
    ],
  },
  bidSoFar: null,
  tone: "question",
  oneLine: "Needs the drawings",
};

/** Drawings in, no scale: walls current, ask is a link to the takeoff. */
export const GUIDE_NO_SCALE: JobGuide = {
  ...BASE,
  jobId: "job_walls",
  name: "Eastgate Lofts, Bldg B",
  gcName: "Cobalt Construction",
  dueLabel: "due Mon",
  steps: steps(
    { invite: "done", walls: "current", price: "todo", proposal: "todo", send: "todo" },
    { invite: "from the GC's email", walls: "6 sheets read", price: "after the walls", proposal: "writes itself after pricing", send: "to Cobalt Construction" },
  ),
  headline: "Drawings read. One thing needs you.",
  ask: {
    id: "no-scale",
    step: "walls",
    title: "Sheet A2.1 has no scale, so I cannot measure it.",
    body: "Click two points a known distance apart and I will take it from there.",
    actions: [
      { label: "Set the scale", href: "/bid/estimates/job_walls/takeoff", primary: true },
      { label: "Skip this sheet", href: "/bid/estimates/job_walls/takeoff" },
    ],
  },
  bidSoFar: null,
  tone: "question",
  oneLine: "Sheet A2.1 needs a scale",
};

/** The concept screen: a wall type with no price, one action writes. */
export const GUIDE_UNPRICED: JobGuide = {
  ...BASE,
  jobId: "job_price",
  name: "Riverside Medical, L2",
  steps: steps(
    { invite: "done", walls: "done", price: "current", proposal: "todo", send: "todo" },
    {
      invite: "from the GC's email",
      walls: "1,920 LF · 14 openings · 6 sheets",
      price: "1 thing needs you",
      proposal: "writes itself after pricing",
      send: "to Hartwell Builders",
    },
  ),
  headline: "Almost priced. One thing needs you.",
  ask: {
    id: "unpriced-wall-types",
    step: "price",
    title: "W2 rated wall (680 LF) has no price in your price book.",
    body: "You priced a 6\" 1-HR wall on Civic Center Annex in September. Use that?",
    actions: [
      { label: "Use the Civic Center price", actionId: "usePastPrice", actionArg: "wt_w2", primary: true },
      { label: "Enter a price", href: "/bid/estimates/job_price/estimate" },
      { label: "Show me the wall", href: "/bid/estimates/job_price/takeoff" },
    ],
  },
  bidSoFar: 58120,
  tone: "question",
  oneLine: "W2 wall has no price",
};

/** Priced, rates set, not yet pushed to the lines: the ask writes. */
export const GUIDE_RECAP_READY: JobGuide = {
  ...BASE,
  jobId: "job_recap",
  name: "Harbor Point Clinic",
  gcName: null,
  dueLabel: null,
  steps: steps(
    { invite: "done", walls: "done", price: "current", proposal: "todo", send: "todo" },
    { invite: "from the GC's email", walls: "2,310 LF · 22 openings · 9 sheets", price: "every wall priced", proposal: "writes itself after pricing", send: "to the GC" },
  ),
  headline: "Priced. Put the bid on the lines.",
  ask: {
    id: "recap-ready",
    step: "price",
    title: "Your markup is set. The bid is $187,450.",
    body: "Put it onto the line prices so the proposal shows it.",
    actions: [
      { label: "Put the bid on the lines", actionId: "applyRecap", primary: true },
      { label: "Review the recap", href: "/bid/estimates/job_recap/recap" },
    ],
  },
  bidSoFar: 187450,
  tone: "ready",
  oneLine: "Ready to put on the lines",
};

/** Proposal written, waiting to be sent. */
export const GUIDE_PROPOSAL: JobGuide = {
  ...BASE,
  jobId: "job_proposal",
  name: "Lakeside Elementary Annex",
  steps: steps(
    { invite: "done", walls: "done", price: "done", proposal: "current", send: "todo" },
    { invite: "from the GC's email", walls: "840 LF · 6 openings · 3 sheets", price: "$96,300 · 18% markup", proposal: "draft ready", send: "to Hartwell Builders" },
  ),
  headline: "The proposal is written. Read it, then send it.",
  ask: {
    id: "proposal-ready",
    step: "proposal",
    title: "Your proposal for Hartwell Builders is ready to read.",
    body: null,
    actions: [{ label: "Open the proposal", href: "/bid/estimates/job_proposal/proposal", primary: true }],
  },
  bidSoFar: 96300,
  tone: "ready",
  oneLine: "Proposal ready to send",
};

/** Everything done: no ask at all. */
export const GUIDE_SENT: JobGuide = {
  ...BASE,
  jobId: "job_sent",
  name: "Northgate Plaza, Suite 200",
  dueLabel: null,
  steps: steps(
    { invite: "done", walls: "done", price: "done", proposal: "done", send: "done" },
    { invite: "from the GC's email", walls: "420 LF · 3 openings · 2 sheets", price: "$41,900 · 20% markup", proposal: "sent", send: "to Hartwell Builders" },
  ),
  headline: "Sent. Nothing else needs you.",
  ask: null,
  bidSoFar: 41900,
  tone: "working",
  oneLine: "Waiting on the GC",
};

export const GUIDE_FIXTURES: readonly JobGuide[] = [
  GUIDE_NO_DRAWINGS,
  GUIDE_NO_SCALE,
  GUIDE_UNPRICED,
  GUIDE_RECAP_READY,
  GUIDE_PROPOSAL,
  GUIDE_SENT,
];
