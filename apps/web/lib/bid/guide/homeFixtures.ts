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
