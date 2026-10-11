import { formatCalendarDate } from "@/lib/render-date";
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

export type StageKey = "estimate" | "contract" | "crew" | "billing" | "closeout";
export type StageLink = { href: string; label: string };
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
  state: "done" | "current" | "upcoming";
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
      ...(input.canReachPunchList ? [{ href: `/punch-lists?job=${job}`, label: "Punch list" }] : []),
      ...(input.canReachCloseout ? [{ href: "/closeout", label: "Closeout (all jobs)" }] : []),
    ],
  };

  const pay = input.latestPayApp;
  const billingStatus = !input.showsBilling
    ? null
    : isEstimate
      ? "Not started"
      : pay
        ? pay.status === "PAID"
          ? `Pay app #${pay.number} paid`
          : pay.dueAt
            ? `Pay app #${pay.number} due ${formatCalendarDate(pay.dueAt, "dayMonth")}`
            : `Pay app #${pay.number} sent`
        : input.invoiceCount > 0
          ? plural(input.invoiceCount, "invoice", "invoices")
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

  const now = currentStage(input);
  const nowIndex = ORDER.indexOf(now.key);
  return ORDER.map((key, i) => ({
    key,
    label: LABEL[key],
    links: links[key],
    status: status[key],
    state: now.allDone || i < nowIndex ? "done" : i === nowIndex ? "current" : "upcoming",
  }));
}

/** The stage whose pages include this path — the one shown open. Query
 * strings never match a pathname, so only in-job routes select a stage. */
export function selectedStageKey(stages: JobStage[], pathname: string): StageKey | null {
  return stages.find((stage) => stage.links.some((link) => link.href === pathname))?.key ?? null;
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
