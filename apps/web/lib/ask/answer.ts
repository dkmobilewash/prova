import {
  anthropicIsConfigured,
  streamToolConversation,
  type AskEvent,
} from "@prova/integrations";
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

A COUNT IS A NUMBER, and counting a list is arithmetic. Every tool result that contains rows also contains a \`count\`. When you say how many of something there are, that figure must be the \`count\` you were given — never the number of rows you can see, never the number of lines you are about to write, and never a subtotal you worked out. If you group several rows onto one line, the count still describes rows, not lines. If you want a count of some subset — how many are overdue, how many are unpaid — and no tool gave you that exact number, do not produce one: describe the subset without counting it, or say the number is not available.

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

WHICH TOOLS TO CALL

Call the tools the question needs and no more. Every call is a database
read the person waits through, so a narrow question deserves a narrow
answer: "what's overdue?" is about money and needs the receivables tool,
not a sweep of RFIs, deliveries and certificates to confirm they are fine.
Nobody asked about those, and "everything else is clean" is not worth four
seconds.

Cast wide only when the question is wide. "What needs my attention today?"
and "how are we doing?" genuinely span areas, and there you should read
broadly. The test is whether an area could change the answer to the
question actually asked.

HOW TO ANSWER

Lead with the answer. Not a preamble, not a restatement of the question.

Be brief. Two or three sentences is usually right. A list only when the answer genuinely is a list, and then one line per row with the fact that matters — not every field the tool returned.

Write like a person who knows construction talking to someone who knows it better. "The Riverside job is 42 days past due on $1,000" — not "Based on the data retrieved, I can see that...". No headers, no bold, no bullet characters unless you are listing rows.

Numbers as they would be written on an invoice: $1,000.00, not 1000. Dates as the tool gives them.

If the honest answer is "nothing" — no overdue invoices, nothing expiring, no open RFIs — say that as good news in one sentence and stop. Do not pad it.

If the question is ambiguous in a way that changes the answer, ask one short question instead of guessing. If it is ambiguous in a way that does not, just answer.`;

export type AskCitation = Citation;

/** Trims a tool result to what the model needs to answer.
 *
 * Rows are already scoped to one company, but a company with hundreds of
 * invoices would otherwise send the lot on every question. The tools order
 * their rows by what matters (most overdue first, soonest promised first),
 * so the head of the list is the part worth reading. */
const MAX_ROWS_PER_TOOL = 40;

export function forModel(data: unknown): unknown {
  if (!Array.isArray(data)) return data;

  // ALWAYS send the count, even for a short list.
  //
  // Browser testing caught this: asked what needed attention, it answered
  // "three overdue invoices" and then listed four, against a tile reading
  // "4 invoices past due". Asked again it said four. The per-invoice
  // figures were right every time in fourteen questions — only the
  // aggregate moved, and an aggregate is what someone skims.
  //
  // The cause was mine. The rule is that the model never does arithmetic,
  // and counting a list is arithmetic; I handed it an array and no count,
  // so counting was the only way to answer. A number it is given cannot
  // drift between two runs of the same question. A number it works out
  // can, and did.
  const count = data.length;
  if (count <= MAX_ROWS_PER_TOOL) return { count, rows: data };
  return {
    count,
    rows: data.slice(0, MAX_ROWS_PER_TOOL),
    note: `Showing the first ${MAX_ROWS_PER_TOOL} of ${count}. Say that the list is longer than what you are showing, and use count for how many there are.`,
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

/** What the browser receives, one JSON object per line.
 *
 * Citations ride on `done` rather than being sent up front: an answer that
 * called no tool must carry no links, and that is not known until the
 * conversation ends. */
export type AskStreamEvent =
  | { type: "tools"; names: ToolName[] }
  | { type: "answering" }
  | { type: "reset" }
  | { type: "text"; delta: string }
  | { type: "done"; citations: AskCitation[]; toolsUsed: ToolName[] }
  | { type: "error"; error: string };

function invalid(question: string): string | null {
  if (!question) return "Ask a question first.";
  if (question.length > 1000) {
    return "That question is too long. Try asking it in a sentence or two.";
  }
  if (!anthropicIsConfigured()) {
    return "Ask isn't set up yet — it needs an Anthropic API key on the server.";
  }
  return null;
}

export async function* streamAnswer(
  companyId: string,
  question: string,
): AsyncGenerator<AskStreamEvent> {
  const trimmed = question.trim();
  const problem = invalid(trimmed);
  if (problem) {
    yield { type: "error", error: problem };
    return;
  }

  const citations: AskCitation[] = [];
  const toolsUsed: ToolName[] = [];

  const events = streamToolConversation({
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
      if (result.unavailable) {
        return { content: JSON.stringify({ unavailable: result.unavailable }) };
      }
      const payload = forModel(result.data);
      return {
        content: JSON.stringify(
          result.summary && typeof payload === "object" && payload !== null
            ? { ...result.summary, ...payload }
            : payload,
        ),
      };
    },
  });

  for await (const event of events) {
    switch (event.type) {
      case "text":
      case "reset":
      case "answering":
        yield event;
        break;
      case "tools":
        yield { type: "tools", names: event.names as ToolName[] };
        break;
      case "error":
        yield { type: "error", error: messageFor(event.reason) };
        return;
      case "done":
        // Citations only where a tool actually ran. An answer built from
        // no data — a refusal to guess, a clarifying question — must not
        // carry links implying it was sourced from the rows.
        yield {
          type: "done",
          citations: toolsUsed.length ? citations : [],
          toolsUsed,
        };
        return;
    }
  }
}
