import { prisma } from "@prova/db";
import { findJob } from "./findJob";
import type { CommandContext, CommandDefinition, CommandInput, Exclusion, HandoffCommandDefinition, Resolution } from "../commands";

/**
 * Starting a change order, as a HANDOFF onto the job's Estimate tab.
 *
 * The card carries the job, a title and notes in the person's own words,
 * and opens the "New change order" form in ChangeOrders filled in. Its
 * Start draft is the write — `createChangeOrder` with its counter, its
 * VIEW_JOB_COSTS guard and its contracted-job rule — so nothing here can
 * number, price or send a change order. A draft moves no contract value;
 * pricing, submitting to the GC and approval stay on the page, beside the
 * lines they change.
 */

const TITLE_MAX = 120;

async function resolveStartChangeOrder(ctx: CommandContext, input: CommandInput): Promise<Resolution> {
  const located = await findJob(ctx, input);
  if (located.kind !== "job") return located;
  const { job } = located;
  const title = (input.title ?? "").slice(0, TITLE_MAX);
  if (!title) return { kind: "need", missing: "what the change order is for, in a few words" };

  const row = await prisma.job.findFirst({ where: { id: job.id, companyId: ctx.companyId }, select: { status: true } });
  // The action's own rule (assertEditableViaChangeOrder), said before the
  // person opens a form that would refuse them.
  if (row?.status === "ESTIMATE") {
    return {
      kind: "refuse",
      reason: `${job.name} is still an estimate. Change the estimate itself; change orders start once the job is contracted.`,
      href: `/jobs/${job.id}/estimate`,
    };
  }

  const same = await prisma.changeOrder.findFirst({
    where: { jobId: job.id, status: "DRAFT", title: { equals: title, mode: "insensitive" } },
    select: { number: true },
  });
  const description = input.description ?? null;
  return {
    kind: "ready",
    resolved: { jobId: job.id, jobName: job.name, title, description },
    preview: [
      { label: "Job", value: job.name },
      { label: "Change order", value: title },
      ...(description ? [{ label: "Notes", value: description }] : []),
      { label: "Status", value: "draft — the contract value moves only when the GC approves it" },
    ],
    warnings: [],
    ...(same ? { existing: { label: `CO ${same.number} is already a draft with that title`, href: `/jobs/${job.id}/estimate` } } : {}),
  };
}

export const startChangeOrderCommand: HandoffCommandDefinition = {
  name: "start_change_order",
  description:
    "Starts a change order on a contracted job: opens the job's change order form with a title and notes in the person's own words, e.g. 'start a change order on Clerk for 12 extra door frames' gives the title '12 extra door frames'. The person presses Start draft there, which numbers it. Needs the job and what the change is for. Does not price it, add or remove lines, submit it to the GC, approve, reject or void one, and does not work on a job that is still an estimate.",
  capability: "VIEW_JOB_COSTS",
  tier: "T3_MONEY_EVIDENCE",
  mode: "HANDOFF",
  action: "createChangeOrder",
  handoffHref: (proposalId, resolved) => `/jobs/${String(resolved.jobId)}/estimate?draft=${proposalId}`,
  title: "Start a change order",
  verb: "Preparing the change order",
  button: "Open the change order form",
  input_schema: {
    type: "object",
    properties: {
      jobName: { type: "string", description: "The job, as the person named it." },
      title: {
        type: "string",
        description: "What the change is, in the person's words, e.g. '12 extra door frames'. Keep their numbers and trade words exactly.",
      },
      description: { type: "string", description: "Anything else they said about it (where, why, who asked). Omit if not said." },
    },
  },
  continuationKeys: ["jobId"],
  resolve: resolveStartChangeOrder,
};

export const changeOrderCommands: CommandDefinition[] = [startChangeOrderCommand];

const PRICED = "Prices or re-prices a change order's lines against the estimate; done on the job, where the lines and the contract value are on screen.";
const DECIDED = "Records what the GC decided, on a document they sent; evidence entered on the change order's row, never a command.";

/** The rest of lib/actions/changeOrders.ts, each with its reason. */
export const changeOrderExclusions: Exclusion[] = [
  { action: "draftChangeOrderFromDelay", reason: "Started from the delay being looked at on the field report, which carries the hours and cost it prices." },
  { action: "draftChangeOrderFromTmTicket", reason: "Started from the signed T&M ticket on screen; the ticket's own figures are the price." },
  { action: "proposeAddedScope", reason: PRICED },
  { action: "proposeLineItemChange", reason: PRICED },
  { action: "proposeScopeRemoval", reason: PRICED },
  { action: "removeProposal", reason: "T5: deletes are never commands." },
  { action: "deleteChangeOrderDraft", reason: "T5: deletes are never commands." },
  { action: "submitChangeOrder", reason: "Sends the priced change order to the GC (T4); submitted from its row, after the lines are read." },
  { action: "approveChangeOrder", reason: DECIDED },
  { action: "rejectChangeOrder", reason: DECIDED },
  { action: "voidChangeOrder", reason: "T5: voiding is never a command." },
  { action: "reopenChangeOrder", reason: "Reopening undoes a decision the GC sent; one deliberate tap on the row." },
  { action: "reviseChangeOrder", reason: PRICED },
];
