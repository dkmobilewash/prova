import { GUIDE_STEP_KEYS, TIME_BOXED_ASK_IDS, type GuideStepStatus, type GuideTone, type JobGuide } from "./types";

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

/**
 * Where an ask sits on the list. By tone, EXCEPT a date that passes on its own
 * (`TIME_BOXED_ASK_IDS`: a job walk, an RFI cutoff, both inside two days): its
 * tone is "update", which on its own would put it under every bid that is
 * merely ready to send — and a ready bid will still be ready tomorrow while the
 * walk will not. So it ranks just under a blocked bid and above everything else.
 */
function urgency(guide: JobGuide): number {
  if (guide.tone !== "blocked" && guide.ask && TIME_BOXED_ASK_IDS.includes(guide.ask.id)) return 0.5;
  return TONE_RANK[guide.tone];
}

/** The open jobs with an ask, most urgent first, otherwise in the order given
 * (the engine hands them soonest-due first). */
export function needsYou(guides: readonly JobGuide[]): JobGuide[] {
  return guides
    .map((guide, index) => ({ guide, index }))
    .filter(({ guide }) => guide.ask !== null)
    .sort((a, b) => urgency(a.guide) - urgency(b.guide) || a.index - b.index)
    .map(({ guide }) => guide);
}

/** Always five statuses, in step order; a step the guide did not list is todo.
 * A skipped step is behind the bid, so the bar fills it like a done one. */
export function progressSegments(guide: Pick<JobGuide, "steps">): GuideStepStatus[] {
  return GUIDE_STEP_KEYS.map((key) => {
    const status = guide.steps.find((step) => step.key === key)?.status ?? "todo";
    return status === "skipped" ? "done" : status;
  });
}

/** "3 of 5 steps done" — the bar's text alternative. */
export function progressLabel(guide: Pick<JobGuide, "steps">): string {
  const done = progressSegments(guide).filter((status) => status === "done").length;
  return `${done} of ${GUIDE_STEP_KEYS.length} steps done`;
}

/** The words on the ask's button: "Answer" for a question with tap answers (the
 * home cannot answer it, and "8 ft" on a button that opens the job would read as
 * the answer), else the primary action, else the first, else "Open". */
export function askButtonLabel(guide: Pick<JobGuide, "ask">): string {
  const actions = guide.ask?.actions ?? [];
  if (actions.some((action) => action.chip)) return "Answer";
  return (actions.find((action) => action.primary) ?? actions[0])?.label ?? "Open";
}

/** "Hartwell · due Thu" — whichever halves exist, or null. */
export function dueLine(guide: Pick<JobGuide, "gcName" | "dueLabel">): string | null {
  const parts = [guide.gcName, guide.dueLabel].filter((part): part is string => !!part);
  return parts.length > 0 ? parts.join(" · ") : null;
}
