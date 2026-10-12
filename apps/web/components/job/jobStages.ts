import { dueStatus } from "@/lib/due-date";
import { STAGE_LABELS, type JobLifecycleStage } from "@/lib/job-lifecycle";

/**
 * The five stages across the top of a job — Estimate, Contract, Crew,
 * Billing, Closeout — as a NAVIGATION LAYER over the job's existing tab
 * routes. Nothing moved: every tab URL the old rail linked to is still a
 * route of its own, and each one is filed under exactly one stage here.
 * `jobStages.test.ts` holds the union of every stage's links equal to the
 * old rail for every viewer/stage combination, so a tab cannot fall out.
 *
 * Pure: the layout loads the facts, this decides what the steps say.
 */

/**
 * One name for a bill sent on a job, per company. Every screen naming that
 * record — Home's Needs list and job cards, the Billing stage line, the
 * Billing tab's register, the "Send …" shortcut — calls it this, so one bill
 * is never "Invoice #14" on one screen and "Pay app #14" on the next. The
 * company's onboarding answer decides; unanswered reads "Pay app", the word
 * a sub billing a GC uses.
 */
export function billingNoun(filesMonthlyPayApps: boolean | null | undefined) {
  return filesMonthlyPayApps === false
    ? { one: "Invoice", lower: "invoice", many: "Invoices", lowerMany: "invoices" }
    : { one: "Pay app", lower: "pay app", many: "Pay apps", lowerMany: "pay apps" };
}

export type StageKey = "estimate" | "contract" | "crew" | "billing" | "closeout";
/** `leavesJob`: the page is not one of this job's own tabs (the punch list,
 * company-wide closeout), so following it leaves the job header and these
 * stages behind. The nav marks it, so the jump is not a surprise. */
export type StageLink = { href: string; label: string; leavesJob?: true };
export type JobStage = {
  key: StageKey;
  label: string;
  /** The stage's own pages, in order. The step links to the first. Empty
   * when this viewer can open none of them — the step still shows where
   * the job is, it just is not a link. */
  links: StageLink[];
  /** One plain line of real status, or null when it would need data this
   * viewer is not shown. */
  status: string | null;
  /** "attention" is a stage the job has moved PAST without finishing it —
   * an IN_PROGRESS job whose contract was never signed. It used to read
   * "done" with a green tick beside its own "Not signed", a step that
   * contradicted itself. A tick now means the stage's own facts agree. */
  state: "done" | "attention" | "current" | "upcoming";
  /** How the status line reads: "warn" for something missing, "danger" for
   * something past due. Absent is neutral. */
  tone?: "warn" | "danger";
};

export type JobStageInput = {
  jobId: string;
  /** Stored JobStatus. */
  status: string;
  /** lib/job-lifecycle.ts's reading of where the job is. */
  lifecycleStage: JobLifecycleStage;
  showsJobMoney: boolean;
  showsBilling: boolean;
  showsField: boolean;
  /** canReach() for the two company-wide pages the Closeout stage points at. */
  canReachPunchList: boolean;
  canReachCloseout: boolean;
  crewSize: number;
  contractSigned: boolean;
  approvedChangeOrders: number;
  invoiceCount: number;
  latestPayApp: { number: number; dueAt: Date | null; status: string } | null;
  /** Company.filesMonthlyPayApps — what the bill is called (billingNoun). */
  filesMonthlyPayApps?: boolean | null;
  /** The VIEWER'S calendar day at UTC midnight (`viewerAsOf()`), what a due
   * date is compared against. Never the server's clock — see lib/due-date.ts. */
  asOf: Date;
};

const ORDER: StageKey[] = ["estimate", "contract", "crew", "billing", "closeout"];
const LABEL: Record<StageKey, string> = {
  estimate: "Estimate",
  contract: "Contract",
  crew: "Crew",
  billing: "Billing",
  closeout: "Closeout",
};

/** Which stage the job is IN — the numbered yellow one. */
export function currentStage(input: Pick<JobStageInput, "lifecycleStage" | "invoiceCount">): {
  key: StageKey;
  allDone: boolean;
} {
  switch (input.lifecycleStage) {
    case "bidding":
      return { key: "estimate", allDone: false };
    case "awarded":
      return { key: "contract", allDone: false };
    case "in_progress":
      // Working, and billing once the first bill has gone out.
      return { key: input.invoiceCount > 0 ? "billing" : "crew", allDone: false };
    case "substantially_complete":
    case "closeout":
      return { key: "closeout", allDone: false };
    case "closed":
    case "warranty":
      return { key: "closeout", allDone: true };
  }
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

export function jobStages(input: JobStageInput): JobStage[] {
  const id = input.jobId;
  const isEstimate = input.status === "ESTIMATE";
  const billingOpen = !isEstimate && input.showsBilling;
  const job = encodeURIComponent(id);

  const links: Record<StageKey, StageLink[]> = {
    estimate: [
      // `/estimate` is the estimate until the contract, then it holds the
      // change orders (estimate/page.tsx) — so it moves to Contract with it.
      ...(input.showsJobMoney && isEstimate ? [{ href: `/jobs/${id}/estimate`, label: "Estimate" }] : []),
      ...(input.showsJobMoney ? [{ href: `/jobs/${id}/takeoff`, label: "Takeoff" }] : []),
    ],
    contract: [
      { href: `/jobs/${id}`, label: "Overview" },
      ...(input.showsJobMoney && !isEstimate ? [{ href: `/jobs/${id}/estimate`, label: "Change orders" }] : []),
      { href: `/jobs/${id}/compliance`, label: "Compliance" },
    ],
    crew: [
      { href: `/jobs/${id}/crew`, label: "Crew & time" },
      { href: `/jobs/${id}/field-reports`, label: "Field reports" },
      ...(input.showsField ? [{ href: `/jobs/${id}/photos`, label: "Photos" }] : []),
    ],
    billing: billingOpen
      ? [
          { href: `/jobs/${id}/billing`, label: "Billing" },
          { href: `/jobs/${id}/retainage`, label: "Retainage" },
        ]
      : [],
    closeout: [
      ...(input.canReachPunchList ? [{ href: `/punch-lists?job=${job}`, label: "Punch list", leavesJob: true as const }] : []),
      ...(input.canReachCloseout ? [{ href: "/closeout", label: "Closeout (all jobs)", leavesJob: true as const }] : []),
    ],
  };

  const pay = input.latestPayApp;
  const noun = billingNoun(input.filesMonthlyPayApps);
  const payDue = pay && pay.status !== "PAID" && pay.dueAt ? dueStatus(pay.dueAt, input.asOf) : null;
  const billingStatus = !input.showsBilling
    ? null
    : isEstimate
      ? "Not started"
      : pay
        ? pay.status === "PAID"
          ? `${noun.one} #${pay.number} paid`
          : payDue
            ? `${noun.one} #${pay.number} ${payDue.text}`
            : `${noun.one} #${pay.number} sent`
        : input.invoiceCount > 0
          ? plural(input.invoiceCount, noun.lower, noun.lowerMany)
          : "Nothing billed yet";

  const contractParts = [
    input.contractSigned ? "Signed" : isEstimate ? "Not started" : "Not signed",
    ...(input.approvedChangeOrders > 0 ? [plural(input.approvedChangeOrders, "CO", "COs")] : []),
  ];

  const lifecycle = input.lifecycleStage;
  const status: Record<StageKey, string | null> = {
    estimate: isEstimate ? "Bidding" : "Won",
    contract: contractParts.join(" · "),
    crew: input.crewSize > 0 ? `${input.crewSize} on crew` : "No one yet",
    billing: billingStatus,
    closeout:
      lifecycle === "bidding" || lifecycle === "awarded" || lifecycle === "in_progress"
        ? "Not started"
        : STAGE_LABELS[lifecycle],
  };

  // What each stage's OWN status line says is still missing. A stage the
  // job has moved past with one of these true is "attention", never "done":
  // the tick and the words beside it must agree.
  const missing: Record<StageKey, boolean> = {
    estimate: false,
    contract: !input.contractSigned,
    crew: input.crewSize === 0,
    billing: input.showsBilling && !isEstimate && !pay && input.invoiceCount === 0,
    closeout: false,
  };

  const now = currentStage(input);
  const nowIndex = ORDER.indexOf(now.key);
  return ORDER.map((key, i) => {
    const passed = now.allDone || i < nowIndex;
    const state: JobStage["state"] = passed ? (missing[key] ? "attention" : "done") : i === nowIndex ? "current" : "upcoming";
    const tone: JobStage["tone"] =
      key === "billing" && payDue?.overdue ? "danger" : state === "attention" ? "warn" : undefined;
    return { key, label: LABEL[key], links: links[key], status: status[key], state, ...(tone ? { tone } : {}) };
  });
}

/** Is `href` the page being shown? A link with a query (`/punch-lists?job=x`)
 * is current only on that path WITH those params — comparing it to the bare
 * pathname, as this used to, could never match. */
export function isCurrentLink(href: string, pathname: string, search = ""): boolean {
  const [path, query] = href.split("?");
  if (path !== pathname) return false;
  if (!query) return true;
  const have = new URLSearchParams(search);
  return [...new URLSearchParams(query)].every(([k, v]) => have.get(k) === v);
}

/** The stage whose pages include the page being shown — the one shown open. */
export function selectedStageKey(stages: JobStage[], pathname: string, search = ""): StageKey | null {
  return stages.find((stage) => stage.links.some((link) => isCurrentLink(link.href, pathname, search)))?.key ?? null;
}

/** The Paperwork panel's change-order row. Waiting ones first, so a
 * decision the GC still owes reads as open work. */
export function changeOrderPaperworkLink(jobId: string, approved: number, waiting: number) {
  return {
    href: `/jobs/${jobId}/estimate`,
    label: "Change orders",
    detail: waiting > 0 ? `${waiting} waiting · ${approved} approved` : `${approved} approved`,
  };
}
