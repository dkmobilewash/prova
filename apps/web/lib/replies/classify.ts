import { classifyOutboundReply, REPLY_CLASSIFY_PROMPT_VERSION, type ReplyClassifyResult } from "@prova/integrations";
import { aiGate } from "@/lib/ai/settings";
import { recordAskUsage } from "@/lib/ask/usage";

/**
 * THE STOP CHECK RUNS FIRST AND IS NOT A MODEL. "Stop", "remove me",
 * "unsubscribe", "do not contact", "take me off" — any of these anywhere in
 * the reply is STOP at confidence 1, before a model is asked and whatever it
 * would have said. A suppression has to be the same answer every time; a
 * classifier with a temperature is not that.
 *
 * `previousOutbound` is quoted back by most mail clients, so the regex runs
 * on the reply with the quoted part cut at the first "On … wrote:" or "From:"
 * line — otherwise our own footer's "unsubscribe" would suppress every lead.
 *
 * ponytail: a bare "stop" is deliberately over-broad ("stop by" and "stop in"
 * are excepted, nothing else is). A lost lead is cheaper than a mailed
 * suppression; narrow it only from real replies on /sales/replies.
 */
const STOP_WORDS =
  /\b(stop(?!\s+(by|in|over))|unsubscribe|remove\s+me|take\s+me\s+off|do\s+not\s+(contact|email)|don'?t\s+(contact|email)|opt\s*out|not\s+interested,?\s+(please\s+)?(stop|don'?t|do\s+not))\b/i;

/** The reply's own words, with the quoted thread beneath it cut off. */
export function ownWords(body: string): string {
  const cut = body.search(/^\s*(On .{0,200}wrote:|From:|-{2,}\s*Original Message|_{5,}|>)/m);
  return cut === -1 ? body : body.slice(0, cut);
}

export function isStop(body: string): boolean {
  return STOP_WORDS.test(ownWords(body));
}

export type ClassifiedReply = ReplyClassifyResult & { promptVersion: string | null };

/**
 * STOP by regex, else the model behind the company's AI switch. A refused
 * gate (switch off, no key) comes back as UNCLEAR at confidence 0 — which the
 * policy routes to a person, so a switched-off model costs nothing but a
 * review. Throws only on the model itself failing; the route catches that.
 */
export async function classifyReply(input: {
  companyId: string;
  subject: string | null;
  body: string;
  previousOutbound: string | null;
}): Promise<ClassifiedReply> {
  if (isStop(input.body)) {
    return { classification: "STOP", door: "UNKNOWN", confidence: 1, extracted: { wantsText: false }, promptVersion: null };
  }
  const gate = await aiGate(input.companyId, "AI_AGENTS");
  if (!gate.ok) {
    return { classification: "UNCLEAR", door: "UNKNOWN", confidence: 0, extracted: { wantsText: false }, promptVersion: null };
  }
  const result = await classifyOutboundReply({
    subject: input.subject,
    body: ownWords(input.body),
    previousOutbound: input.previousOutbound,
    model: gate.model,
    onUsage: (usage) =>
      recordAskUsage({
        companyId: input.companyId,
        userId: null,
        model: gate.model,
        usage,
        outcome: "answered",
        feature: "ai-agents",
        promptVersion: REPLY_CLASSIFY_PROMPT_VERSION,
      }),
  });
  return { ...result, promptVersion: REPLY_CLASSIFY_PROMPT_VERSION };
}
