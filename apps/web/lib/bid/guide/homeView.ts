import { GUIDE_STEP_KEYS, type GuideStepStatus, type GuideTone, type JobGuide } from "./types";

/**
 * What the Bid home draws from a list of guides — pure, so the render test and
 * the page agree. The words (`oneLine`, `headline`) are written by the guide
 * engine; this only decides ORDER, WHICH jobs are on the "Needs you" list, and
 * the five-segment bar.
 */

/** The pill's word for each tone. A status is a word AND a colour, never a colour. */
export const TONE_LABEL: Record<GuideTone, string> = {
  question: "Question",
  ready: "Ready",
  update: "Update",
  working: "Working",
  blocked: "Blocked",
};

/** Most urgent first on the "Needs you" list. Stable within a tone. */
const TONE_RANK: Record<GuideTone, number> = { blocked: 0, question: 1, ready: 2, update: 3, working: 4 };

/** The open jobs with an ask, most urgent tone first, otherwise in the order given
 * (the engine hands them soonest-due first). */
export function needsYou(guides: readonly JobGuide[]): JobGuide[] {
  return guides
    .map((guide, index) => ({ guide, index }))
    .filter(({ guide }) => guide.ask !== null)
    .sort((a, b) => TONE_RANK[a.guide.tone] - TONE_RANK[b.guide.tone] || a.index - b.index)
    .map(({ guide }) => guide);
}

/** Always five statuses, in step order; a step the guide did not list is todo. */
export function progressSegments(guide: Pick<JobGuide, "steps">): GuideStepStatus[] {
  return GUIDE_STEP_KEYS.map((key) => guide.steps.find((step) => step.key === key)?.status ?? "todo");
}

/** "3 of 5 steps done" — the bar's text alternative. */
export function progressLabel(guide: Pick<JobGuide, "steps">): string {
  const done = progressSegments(guide).filter((status) => status === "done").length;
  return `${done} of ${GUIDE_STEP_KEYS.length} steps done`;
}

/** The words on the ask's button: the primary action, else the first, else "Open". */
export function askButtonLabel(guide: Pick<JobGuide, "ask">): string {
  const actions = guide.ask?.actions ?? [];
  return (actions.find((action) => action.primary) ?? actions[0])?.label ?? "Open";
}

/** "Hartwell · due Thu" — whichever halves exist, or null. */
export function dueLine(guide: Pick<JobGuide, "gcName" | "dueLabel">): string | null {
  const parts = [guide.gcName, guide.dueLabel].filter((part): part is string => !!part);
  return parts.length > 0 ? parts.join(" · ") : null;
}
