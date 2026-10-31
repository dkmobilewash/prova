import type { GuideStep, GuideStepKey, GuideStepStatus, JobGuide } from "./types";

/**
 * Realistic guides for the home screen's tests and for measuring its layout.
 * Fixtures only — nothing in the app imports this file.
 */

const LABELS: Record<GuideStepKey, string> = {
  invite: "Invite read",
  walls: "Walls measured",
  price: "Price it",
  proposal: "Proposal",
  send: "Send",
};

function steps(statuses: [GuideStepStatus, GuideStepStatus, GuideStepStatus, GuideStepStatus, GuideStepStatus]): GuideStep[] {
  const keys: GuideStepKey[] = ["invite", "walls", "price", "proposal", "send"];
  return keys.map((key, i) => ({ key, label: LABELS[key], status: statuses[i], summary: null }));
}

export const GUIDE_FIXTURES: JobGuide[] = [
  {
    jobId: "job_riverside",
    name: "Riverside Medical, L2",
    gcName: "Hartwell",
    dueLabel: "due Thu",
    steps: steps(["done", "done", "current", "todo", "todo"]),
    headline: "Almost priced. One thing needs you.",
    ask: {
      id: "unpriced-wall-types",
      step: "price",
      title: "W2 rated wall (680 LF) has no price in your price book.",
      body: null,
      actions: [{ label: "Answer", href: "/bid/estimates/job_riverside/estimate", primary: true }],
    },
    bidSoFar: 184250,
    tone: "question",
    oneLine: "W2 wall has no price",
  },
  {
    jobId: "job_civic",
    name: "Civic Center Annex",
    gcName: "Brightline",
    dueLabel: "due Tue",
    steps: steps(["done", "done", "done", "done", "current"]),
    headline: "Ready to send.",
    ask: {
      id: "proposal-ready",
      step: "send",
      title: "The proposal is ready for 2 GCs.",
      body: null,
      actions: [{ label: "Review & send", href: "/bid/estimates/job_civic/proposal", primary: true }],
    },
    bidSoFar: 96400,
    tone: "ready",
    oneLine: "Proposal ready for 2 GCs",
  },
  {
    jobId: "job_oak",
    name: "Oak Ave Apartments",
    gcName: "Brightline",
    dueLabel: "due Mon",
    steps: steps(["done", "current", "todo", "todo", "todo"]),
    headline: "Reading the drawings.",
    ask: null,
    bidSoFar: null,
    tone: "working",
    oneLine: "Reading 6 of 22 sheets...",
  },
  {
    jobId: "job_northhills",
    name: "North Hills School",
    gcName: "Hartwell",
    dueLabel: null,
    steps: steps(["done", "done", "current", "todo", "todo"]),
    headline: "A price changed since you priced it.",
    ask: {
      id: "price-changed",
      step: "price",
      title: "Board price is up 6% since you priced this.",
      body: null,
      actions: [{ label: "See change", href: "/bid/estimates/job_northhills/recap" }],
    },
    bidSoFar: 241900,
    tone: "update",
    oneLine: "Board price +6% since you priced",
  },
  {
    jobId: "job_lakeview",
    name: "Lakeview Office Fit-out, Building C, Phase 2 Interior Partitions",
    gcName: "Meridian Construction Group",
    dueLabel: "due Fri 2:00 PM",
    steps: steps(["done", "todo", "todo", "todo", "todo"]),
    headline: "No drawings yet.",
    ask: {
      id: "no-drawings",
      step: "walls",
      title: "There are no drawings on this job.",
      body: null,
      actions: [{ label: "Add drawings", href: "/bid/estimates/job_lakeview/takeoff", primary: true }],
    },
    bidSoFar: null,
    tone: "blocked",
    oneLine: "No drawings uploaded",
  },
];

/**
 * The question and date asks on the home list, beside the kinds above: a job
 * walk tomorrow (tone "update", but a date that passes on its own), a wall
 * type's height (tap answers, which the home cannot give — its button says
 * "Answer"), and an addendum nobody has acknowledged. Kept apart from
 * `GUIDE_FIXTURES` so the counts asserted over that list do not move.
 */
export const GUIDE_FIXTURES_QUESTIONS: JobGuide[] = [
  {
    jobId: "job_ready",
    name: "Civic Center Annex",
    gcName: "Brightline",
    dueLabel: "due Fri",
    steps: steps(["done", "done", "done", "current", "todo"]),
    headline: "Ready to go out.",
    ask: {
      id: "proposal-ready",
      step: "proposal",
      title: "The proposal is ready to open at $96,400.00.",
      body: null,
      actions: [{ label: "Open the proposal", href: "/bid/estimates/job_ready/proposal", primary: true }],
    },
    bidSoFar: 96400,
    tone: "ready",
    oneLine: "Ready to send, $96,400.00",
  },
  {
    jobId: "job_height",
    name: "Riverside Medical, L2",
    gcName: "Hartwell",
    dueLabel: "due Thu",
    steps: steps(["done", "current", "todo", "todo", "todo"]),
    headline: "Walls are measured. One thing needs you.",
    ask: {
      id: "wall-height",
      step: "walls",
      title: "How tall are the W2 walls on Riverside Medical, L2?",
      body: null,
      actions: [
        ...[8, 9, 10, 12].map((h) => ({
          label: `${h} ft`,
          actionId: "setWallHeight" as const,
          actionArg: `wh:wt_w2:${h}:0a1b2c3d`,
          chip: true,
        })),
        { label: "Another height", href: "/bid/wall-types" },
      ],
    },
    bidSoFar: null,
    tone: "question",
    oneLine: "W2 walls need a height",
  },
  {
    jobId: "job_walk",
    name: "Oak Ave Apartments",
    gcName: "Brightline",
    dueLabel: "due Nov 5",
    steps: steps(["done", "current", "todo", "todo", "todo"]),
    headline: "The job walk is coming up.",
    ask: {
      id: "job-walk",
      step: "walls",
      title: "The job walk is tomorrow at 9:00 AM.",
      body: null,
      actions: [{ label: "See the bid", href: "/bid/bids#inv_oak", primary: true }],
    },
    bidSoFar: null,
    tone: "update",
    oneLine: "Job walk tomorrow 9:00 AM",
  },
  {
    jobId: "job_addendum",
    name: "Harbor Point Clinic",
    gcName: "Hartwell",
    dueLabel: "due Mon",
    steps: steps(["done", "done", "done", "current", "todo"]),
    headline: "Priced. One paper needs you.",
    ask: {
      id: "addendum-unacknowledged",
      step: "proposal",
      title: "Addendum 2 was issued Tuesday and isn't acknowledged on Hartwell's bid form yet.",
      body: null,
      actions: [
        { label: "Open the bid log", href: "/bid/bids#inv_harbor", primary: true },
        { label: "Read the addendum", href: "/bid/bids/inv_harbor?tab=addenda" },
      ],
    },
    bidSoFar: 187450,
    tone: "question",
    oneLine: "Addendum 2 not acknowledged",
  },
];
