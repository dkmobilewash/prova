import type { EstimateStageKey } from "@/lib/estimate-stage";

/**
 * The pure half of the home page: which of the five stages a job is in, and
 * the ONE thing to do next on it. No database and no React, so both are
 * tested by plain input/output (home-logic.test.ts).
 *
 * Both are derived on every render from state that already exists — status,
 * estimate stage, invoices, overdue RFIs, today's schedule — never stored,
 * per the derived-state rule.
 */

export const STAGES = ["Estimate", "Contract", "Crew", "Billing", "Closeout"] as const;
export type Stage = (typeof STAGES)[number];

export type JobStatusValue = "ESTIMATE" | "CONTRACTED" | "IN_PROGRESS" | "COMPLETE";

/**
 * ESTIMATE is Estimate until the client has signed, then Contract (signed,
 * not yet marked contracted). CONTRACTED is Contract. IN_PROGRESS is Crew
 * until the first invoice goes out, then Billing. COMPLETE is Closeout.
 */
export function jobStage(input: {
  status: JobStatusValue;
  estimateStage: EstimateStageKey | null;
  invoiceCount: number;
}): Stage {
  switch (input.status) {
    case "ESTIMATE":
      return input.estimateStage === "SIGNED" ? "Contract" : "Estimate";
    case "CONTRACTED":
      return "Contract";
    case "IN_PROGRESS":
      return input.invoiceCount > 0 ? "Billing" : "Crew";
    case "COMPLETE":
      return "Closeout";
  }
}

export type NextAction = { label: string; href: string; note?: string; primary: boolean };

/** What this viewer may open. Each action is offered only behind the
 * capability its page needs, with "Open job" as the floor everyone has. */
export type ActionRights = {
  billing: boolean;
  field: boolean;
  jobs: boolean;
  estimating: boolean;
};

/**
 * The one button on a job card, most urgent first:
 *   a late invoice (money) > a late RFI answer > crew on site today with
 *   hours to log > the stage's own next step > open the job.
 * `primary` marks the urgent ones, which get the yellow fill.
 */
export function nextAction(input: {
  jobId: string;
  status: JobStatusValue;
  estimateStage: EstimateStageKey | null;
  invoiceCount: number;
  overdueInvoice: { number: number; daysOverdue: number } | null;
  overdueRfi: { number: number } | null;
  scheduledToday: number;
  rights: ActionRights;
  /** billingNoun(company.filesMonthlyPayApps).lower (components/job/jobStages.ts). */
  billNoun?: string;
}): NextAction {
  const job = `/jobs/${input.jobId}`;
  const { rights } = input;

  if (input.overdueInvoice && rights.billing) {
    // No note: how late it is reads on the card's own tag, "overdue N days"
    // in the danger tone (lib/due-date.ts). Red on this yellow button would
    // fail contrast, and saying it twice is the duplication Concept G drops.
    return {
      label: `Chase ${input.billNoun ?? "pay app"} #${input.overdueInvoice.number}`,
      href: `${job}/billing`,
      primary: true,
    };
  }
  if (input.overdueRfi && rights.jobs) {
    return {
      label: `Chase RFI ${input.overdueRfi.number}`,
      note: "answer late",
      href: `/rfis?job=${input.jobId}`,
      primary: true,
    };
  }
  if (input.scheduledToday > 0 && rights.field) {
    return { label: "Log today's hours", href: `${job}/crew`, primary: false };
  }

  const stage = jobStage(input);
  if (input.status === "ESTIMATE" && rights.estimating) {
    switch (input.estimateStage) {
      case "NEEDS_PRICING":
        return { label: "Price the estimate", href: `${job}/estimate`, primary: false };
      case "READY_TO_SEND":
        return { label: "Send the proposal", href: `${job}/proposal`, primary: false };
      case "OUT_FOR_SIGNATURE":
        return { label: "Check the signature", href: `${job}/proposal`, primary: false };
      default:
        break;
    }
  }
  if (stage === "Contract" && rights.field) {
    return { label: "Put a crew on it", href: `${job}/crew`, primary: false };
  }
  if ((stage === "Crew" || stage === "Billing") && rights.billing) {
    return { label: "Bill this job", href: `${job}/billing`, primary: false };
  }
  if (stage === "Closeout" && rights.billing) {
    return { label: "Collect retainage", href: `${job}/retainage`, primary: false };
  }
  return { label: "Open job", href: job, primary: false };
}

/** "Good morning" by the viewer's own clock, not the server's. */
export function greeting(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** The hour (0-23) right now in an IANA zone. */
export function hourIn(timeZone: string, now: Date = new Date()): number {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone }).format(now),
  );
  return Number.isFinite(hour) ? hour : 12;
}
