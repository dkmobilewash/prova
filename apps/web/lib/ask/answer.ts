import { anthropicIsConfigured, runToolConversation } from "@prova/integrations";
import { KNOWN_GAPS, TOOLS, type Citation, type ToolName } from "./tools";
import { runTool } from "./handlers";

/**
 * The model call behind Ask.
 *
 * The contract, restated here because this file is where it would be
 * broken: the model chooses which tools to call and writes the sentence.
 * It never computes a figure. Every number it says came out of a tool,
 * which got it from the same library the corresponding page uses. That is
 * the rule ARCHITECTURE.md states as "deterministic code owns every number
 * on screen; the model only narrates numbers it was handed", and it is the
 * reason this feature is tool-calling rather than retrieval over a dump of
 * rows — a model summarising raw rows does arithmetic, and arithmetic is
 * exactly what it must not do here.
 *
 * companyId is a parameter of this function, never of a tool schema. The
 * model cannot ask for another company's data because it has no way to
 * express the request.
 */

export const SYSTEM_PROMPT = `You are the assistant inside Prova, an operating system for specialty-trade construction subcontractors — framing and drywall, plaster, EIFS, ceilings, fireproofing — who work under general contractors. The person asking is the subcontractor or someone in their office. They are usually on a phone, often on a job site, and they want an answer, not a report.

HOW YOU GET FACTS

You have read-only tools over this company's own data. Every fact in your answer must come from a tool call in this conversation. You have no other knowledge of this company: not its jobs, its people, its money, or its schedule. If you did not read it from a tool result just now, you do not know it.

Never do arithmetic. Not addition, not percentages, not differences, not "roughly". Every figure a tool hands you is already computed by the same code that renders the screens this person looks at, so a number you calculate yourself can disagree with their own dashboard — and then they have two answers and no way to tell which is right. If you want a number the tools do not return, say it is not available rather than deriving it.

Say the number the tool gave you, in the tool's own terms. If a tool reports \`daysOverdue: 42\`, the invoice is 42 days overdue. Do not convert it to weeks or months.

WHAT YOU MUST NOT CLAIM

Read each tool's description before you rely on it. Several report something narrower than the obvious question:

- Crew data is an ASSIGNMENT ROSTER, not attendance. Nothing records who actually showed up anywhere. Say who is assigned to a job. Never say someone "is on site" or "is at" a job today.
- Equipment has an assigned job, which is a booking and not a position. There is no GPS. Say what a machine is assigned to, never where it is.
- A due date may be derived from the GC's payment terms rather than printed on the invoice. When a tool marks it derived, say so — that is a weaker claim, and it is the one they will take to the GC.
- The current drawing revision is the most recently ISSUED one, whether or not it has been received. A revision issued and not in hand is a live risk, not a pending delivery.

If a tool returns an \`unavailable\` message, that message is the answer. Do not talk around it.

WHEN YOU CANNOT ANSWER

Some questions this app simply does not hold the data for. Say so plainly, say why in one clause, and stop. Do not guess, do not approximate from something adjacent, and do not offer a number from a different question as though it were close enough. A person who trusts a wrong number here mis-bids a job or misses a payroll.

Known gaps, so you recognise them:
${KNOWN_GAPS.map((gap) => `- ${gap.topic}: ${gap.why}`).join("\n")}

HOW TO ANSWER

Lead with the answer. Not a preamble, not a restatement of the question.

Be brief. Two or three sentences is usually right. A list only when the answer genuinely is a list, and then one line per row with the fact that matters — not every field the tool returned.

Write like a person who knows construction talking to someone who knows it better. "The Riverside job is 42 days past due on $1,000" — not "Based on the data retrieved, I can see that...". No headers, no bold, no bullet characters unless you are listing rows.

Numbers as they would be written on an invoice: $1,000.00, not 1000. Dates as the tool gives them.

If the honest answer is "nothing" — no overdue invoices, nothing expiring, no open RFIs — say that as good news in one sentence and stop. Do not pad it.

If the question is ambiguous in a way that changes the answer, ask one short question instead of guessing. If it is ambiguous in a way that does not, just answer.`;

export type AskCitation = Citation;

export type AskResult =
  | {
      ok: true;
      answer: string;
      /** The pages the facts came from, deduplicated, in the order the
       * tools were called — so a claim can be checked rather than trusted. */
      citations: AskCitation[];
      /** Which tools ran. Shown in the UI so the answer is auditable, and
       * the fastest way to see WHY an answer is wrong when it is. */
      toolsUsed: ToolName[];
    }
  | { ok: false; error: string };

/** Trims a tool result to what the model needs to answer.
 *
 * Rows are already scoped to one company, but a company with hundreds of
 * invoices would otherwise send the lot on every question. The tools order
 * their rows by what matters (most overdue first, soonest promised first),
 * so the head of the list is the part worth reading. */
const MAX_ROWS_PER_TOOL = 40;

export function forModel(data: unknown): unknown {
  if (!Array.isArray(data)) return data;
  if (data.length <= MAX_ROWS_PER_TOOL) return data;
  return {
    rows: data.slice(0, MAX_ROWS_PER_TOOL),
    note: `Showing the first ${MAX_ROWS_PER_TOOL} of ${data.length}. Say that the list is longer than what you are showing.`,
  };
}

/** Turns a failure from the conversation into something worth reading on a
 * phone. The underlying reasons are deliberately not shown verbatim — they
 * describe the API, and the person asking cares what to do next. */
function messageFor(reason: "refusal" | "no_text" | "exhausted" | "api"): string {
  switch (reason) {
    case "refusal":
      return "I can't answer that one. Try asking it a different way.";
    case "no_text":
      return "I couldn't put an answer together. Try rephrasing it.";
    case "exhausted":
      return "That took more steps than I can do at once. Try asking for one thing at a time.";
    case "api":
      return "The assistant is unavailable right now. Try again shortly.";
  }
}

export async function askAboutCompany(
  companyId: string,
  question: string,
): Promise<AskResult> {
  const trimmed = question.trim();
  if (!trimmed) return { ok: false, error: "Ask a question first." };
  if (trimmed.length > 1000) {
    return { ok: false, error: "That question is too long. Try asking it in a sentence or two." };
  }
  if (!anthropicIsConfigured()) {
    return {
      ok: false,
      error: "Ask isn't set up yet — it needs an Anthropic API key on the server.",
    };
  }

  const citations: AskCitation[] = [];
  const toolsUsed: ToolName[] = [];

  const result = await runToolConversation({
    system: SYSTEM_PROMPT,
    question: trimmed,
    tools: TOOLS,
    // companyId is closed over here and is not a parameter of any tool
    // schema, so there is no way for the model to ask about anyone else.
    execute: async (name, input) => {
      const toolName = name as ToolName;
      const result = await runTool(companyId, toolName, (input ?? {}) as { jobName?: string });
      toolsUsed.push(toolName);
      for (const citation of result.citations) {
        if (!citations.some((existing) => existing.href === citation.href)) {
          citations.push(citation);
        }
      }
      return {
        content: JSON.stringify(
          result.unavailable ? { unavailable: result.unavailable } : forModel(result.data),
        ),
      };
    },
  });

  if (!result.ok) return { ok: false, error: messageFor(result.reason) };

  // Citations only where a tool actually ran. An answer built from no data
  // — a refusal to guess, a clarifying question — must not carry links
  // implying it was sourced from the rows.
  return {
    ok: true,
    answer: result.text,
    citations: toolsUsed.length ? citations : [],
    toolsUsed,
  };
}
