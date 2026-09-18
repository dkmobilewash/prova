import { can, canReach, type Capability, type Principal } from "./permissions";

/**
 * The getting-started checklist on /dashboard — which steps a brand-new
 * company still has in front of it.
 *
 * Pure: counts in, steps out. No database, no session, no clock, so every
 * boundary below is unit-tested without a browser (getting-started.test.ts)
 * and the loader that fills the counts lives in its own file.
 *
 * NOTHING HERE IS STORED. Every step's "done" is derived from real rows on
 * every render. A saved `onboardingStepDone` flag would disagree with the
 * data the moment somebody deleted their only job or disconnected
 * QuickBooks, and a checklist that ticks a box the data no longer supports
 * is worse than no checklist. The only thing remembered anywhere is the
 * "Hide this" choice, and that is a per-browser cookie about the card, not
 * a fact about the company — see lib/getting-started-cookie.ts.
 */

/** What the loader counts, for ONE company. */
export type GettingStartedCounts = {
  jobs: number;
  /** Every User row on the company, the viewer included — so 1 means
   * "just you". */
  users: number;
  /** Invitations sent and not yet accepted. */
  pendingInvites: number;
  /** Payroll crew records that have not been archived. */
  crewMembers: number;
  scheduleDays: number;
  fieldReports: number;
  jobMedia: number;
  quickBooksConnections: number;
};

export type GettingStartedStepId =
  | "name-company"
  | "first-job"
  | "import"
  | "crew"
  | "schedule"
  | "first-day"
  | "quickbooks";

export type GettingStartedStep = {
  id: GettingStartedStepId;
  title: string;
  /** Shown while the step is still to do. */
  body: string;
  /** Shown once it is done. */
  doneBody: string;
  href: string;
  linkLabel: string;
  optional: boolean;
  done: boolean;
  /** The one-sentence path through the assistant, when the viewer is
   * allowed to use it. */
  ask?: { example: string; href: string };
};

export type GettingStartedChecklist = {
  /** Only the steps this viewer can act on, in display order. */
  steps: GettingStartedStep[];
  requiredTotal: number;
  requiredDone: number;
  /** True when there is nothing required left for THIS viewer — the card
   * is not rendered at all. */
  complete: boolean;
};

/** The name sign-up invents when it creates a company.
 *
 * lib/auth.ts `adoptCompanyContext` writes exactly one of two strings:
 * `${name}'s Company` when Clerk gave a first or last name, `"My Company"`
 * when it gave neither. This recognises both SHAPES.
 *
 * The honest limits, since this is a guess about intent from a string:
 *   - A company genuinely called "Smith's Company" reads as not yet
 *     named. That errs toward showing a step someone does not need, which
 *     costs a glance; the opposite error would tick a box that is false.
 *   - It matches the shape rather than the owner's CURRENT name, because
 *     the user's name can change after sign-up (the relink path in
 *     auth.ts rewrites it) and the company name is never updated with it.
 *   - Only a straight apostrophe, because that is the only one auth.ts
 *     writes. A curly one was typed by a person, so it counts as named.
 *   - Blank counts as not named: nothing can print on a form.
 */
export function isSignUpCompanyName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed === "") return true;
  if (trimmed === "My Company") return true;
  return /^.+'s Company$/.test(trimmed);
}

/** The one Ask command this step points at is `create_estimate_job`
 * (lib/ask/commands/estimating.ts). It needs a job name and the GC's name,
 * and it is gated on these two capabilities — a person without them would
 * be refused by the assistant, so they are not shown the sentence.
 * getting-started.test.ts pins both against the command definition. */
export const ASK_CREATE_JOB_CAPABILITIES: Capability[] = ["MANAGE_ESTIMATING", "VIEW_JOB_COSTS"];
export const ASK_CREATE_JOB_EXAMPLE = "Start a job called Riverside Clinic for Turner Construction";

type StepDefinition = Omit<GettingStartedStep, "done" | "ask"> & {
  isDone: (counts: GettingStartedCounts, companyName: string) => boolean;
  /** Only an owner can do it: the page or its action refuses members. */
  ownerOnly?: boolean;
  /** What it takes to DO the step, beyond reaching its page — /schedule
   * opens for everyone, but only MANAGE_FIELD can put anyone on it. */
  capability?: Capability;
  /** Routes that must also be reachable. A child of /settings takes its
   * parent's capability (lib/permissions.ts), so the parent is checked
   * even when the child is not yet in ROUTE_CAPABILITY. */
  alsoReach?: string[];
};

const STEPS: StepDefinition[] = [
  {
    id: "name-company",
    title: "Put your company's name on it",
    body: "We filled in a placeholder name when you signed up. Your real name is what prints on your invoices, pay applications and payroll forms.",
    doneBody: "Your company name is set.",
    href: "/settings",
    linkLabel: "Open settings",
    optional: false,
    // updateCompanyProfile and the /settings page both refuse non-owners.
    ownerOnly: true,
    isDone: (_counts, companyName) => !isSignUpCompanyName(companyName),
  },
  {
    id: "first-job",
    title: "Add your first job",
    body: "A job is one project for one general contractor. Pricing, crew, daily reports and billing all hang off it.",
    doneBody: "You have a job in here.",
    href: "/jobs/new",
    linkLabel: "Add a job",
    optional: false,
    isDone: (counts) => counts.jobs > 0,
  },
  {
    id: "import",
    title: "Bring in what you already have",
    body: "Keep your clients, jobs or crew in a spreadsheet, in Jobber or in QuickBooks? Bring them in instead of typing it all again.",
    doneBody: "",
    href: "/settings/import",
    linkLabel: "Import a spreadsheet",
    optional: true,
    // The importer page and all three of its confirm actions refuse
    // non-owners (app/(app)/settings/import/page.tsx,
    // lib/actions/spreadsheetImport.ts).
    ownerOnly: true,
    alsoReach: ["/settings"],
    // Optional and never counted, so it is never "done" either: there is
    // no row that proves an import happened rather than typing.
    isDone: () => false,
  },
  {
    id: "crew",
    title: "Add your crew",
    body: "Invite the people you work with so they can see their jobs and send in reports from the site.",
    doneBody: "You have added or invited someone.",
    href: "/team",
    linkLabel: "Invite your team",
    optional: false,
    // inviteTeamMember refuses non-owners.
    ownerOnly: true,
    isDone: (counts) => counts.users > 1 || counts.pendingInvites > 0 || counts.crewMembers > 0,
  },
  {
    id: "schedule",
    title: "Put someone on the schedule",
    body: "Pick a job, a day and who is going, so everyone knows where they are headed tomorrow.",
    doneBody: "The schedule has someone on it.",
    href: "/schedule",
    linkLabel: "Open the schedule",
    optional: false,
    capability: "MANAGE_FIELD",
    isDone: (counts) => counts.scheduleDays > 0,
  },
  {
    id: "first-day",
    title: "Log your first day on site",
    body: "Write a daily report or add a photo from the job. It is your record if a GC ever disputes what happened.",
    doneBody: "Your first day on site is on record.",
    href: "/field-reports",
    linkLabel: "Write a daily report",
    optional: false,
    isDone: (counts) => counts.fieldReports > 0 || counts.jobMedia > 0,
  },
  {
    id: "quickbooks",
    title: "Connect QuickBooks",
    body: "If you keep your books in QuickBooks, link it so you are not entering things twice.",
    doneBody: "QuickBooks is connected.",
    href: "/settings/integrations",
    linkLabel: "Connect QuickBooks",
    optional: true,
    // The integrations page refuses non-owners.
    ownerOnly: true,
    isDone: (counts) => counts.quickBooksConnections > 0,
  },
];

function viewerCanDo(step: StepDefinition, viewer: Principal): boolean {
  if (step.ownerOnly && viewer.role !== "OWNER") return false;
  if (!canReach(viewer, step.href)) return false;
  if (step.alsoReach && !step.alsoReach.every((href) => canReach(viewer, href))) return false;
  if (step.capability && !can(viewer, step.capability)) return false;
  return true;
}

export function gettingStartedChecklist(input: {
  companyName: string;
  counts: GettingStartedCounts;
  viewer: Principal;
}): GettingStartedChecklist {
  const { companyName, counts, viewer } = input;
  const canAsk = ASK_CREATE_JOB_CAPABILITIES.every((capability) => can(viewer, capability));

  const steps: GettingStartedStep[] = STEPS.filter((step) => viewerCanDo(step, viewer)).map(
    (step) => ({
      id: step.id,
      title: step.title,
      body: step.body,
      doneBody: step.doneBody,
      href: step.href,
      linkLabel: step.linkLabel,
      optional: step.optional,
      done: step.isDone(counts, companyName),
      ...(step.id === "first-job" && canAsk
        ? { ask: { example: ASK_CREATE_JOB_EXAMPLE, href: "/ask" } }
        : {}),
    }),
  );

  const required = steps.filter((step) => !step.optional);
  const requiredDone = required.filter((step) => step.done).length;

  return {
    steps,
    requiredTotal: required.length,
    requiredDone,
    complete: requiredDone === required.length,
  };
}
