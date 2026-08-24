import Anthropic from "@anthropic-ai/sdk";

// AI narrative layer over already-computed WIP figures — see lib/wip.ts in
// apps/web for the deterministic percentage-of-completion math. Claude never
// computes or restates a figure as a different value here; it only
// interprets numbers it's handed. Financial figures on a WIP schedule have
// to be exactly reproducible, which is why the math lives in plain
// TypeScript and this module's only job is explaining what the math means.
const SYSTEM_PROMPT = `You are a construction-industry financial analyst helping a general contractor read a job's WIP (work-in-progress) percentage-of-completion report.

You will be given ALREADY-COMPUTED figures for one job: contract value, percent complete, earned revenue, billed-to-date, and over/under-billing, plus a per-line-item breakdown. Every number you receive is exact and final — do not recompute, restate as a different value, or "correct" any figure. Your job is interpretation only: explain what the numbers mean and flag anything a project manager or the company's surety/lender would want to know.

Focus on:
- Whether the job is significantly overbilled (a liability — cash collected ahead of work performed) or underbilled (an asset, but a cash-flow risk if billing hasn't caught up)
- Any individual line item whose current cost forecast has moved meaningfully away from its original budget
- Anything that looks like it needs the PM's attention this week, not just a restatement of the dashboard numbers

Write 2-4 short sentences, plain prose, no markdown headers or bullet lists, no restating every number verbatim (the numbers are already shown on screen next to this text) — just the interpretation. If nothing stands out as a concern, say so plainly rather than manufacturing a false flag.`;

export interface WipNarrativeLineItemSummary {
  description: string;
  contractValue: number;
  percentComplete: number | null;
  budgetedCost: number | null;
  currentEstimatedCost: number | null;
  actualCostToDate: number;
}

export interface WipNarrativeJobSummary {
  jobName: string;
  jobStatus: string;
  contractValue: number;
  percentComplete: number | null;
  earnedRevenue: number;
  billedToDate: number;
  overUnderBilling: number;
  lineItems: WipNarrativeLineItemSummary[];
}

/**
 * Generates a short plain-language narrative over one job's WIP figures.
 * The figures themselves come from the caller (lib/wip.ts) — this function
 * never touches the database or does any arithmetic of its own.
 */
export async function generateWipNarrative(summary: WipNarrativeJobSummary): Promise<string> {
  const client = new Anthropic();

  const response = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: JSON.stringify(summary, null, 2),
      },
    ],
  });

  const textBlock = response.content.find((block): block is Anthropic.TextBlock => block.type === "text");
  if (!textBlock) {
    throw new Error("Claude did not return a text response");
  }
  return textBlock.text;
}
