import Anthropic from "@anthropic-ai/sdk";
import { AI_CLIENT_OPTIONS, modelFor } from "./models";
import { reportUsage, type ModelUsageReporter } from "./anthropic";

/**
 * WHAT A PROSPECT'S REPLY TO A COLD EMAIL MEANS — one tool call, no prose.
 *
 * The model's job is narrow on purpose: a CLASS, a DOOR, a confidence, and the
 * few facts a reply can carry (a phone, "text me", a best time, named files).
 * It never writes the answer. The answer is a fixed template per
 * (door, class) in the app (`lib/replies/draft.ts`), so nothing the model
 * says can put a price, a date or a promise in front of a prospect.
 *
 * STOP IS NOT THE MODEL'S CALL. The app checks "stop / remove / unsubscribe /
 * do not contact" with a regex BEFORE this runs and never asks the model
 * about it — a suppression must be deterministic, and a model that read
 * "please stop emailing me" as NOT_NOW would be a CAN-SPAM problem with a
 * confidence score on it.
 *
 * Runs under the AI_AGENTS feature: it is a background agent in every sense
 * that matters (no person in the loop when it runs, one ledger line for the
 * agents) and a new enum member for one classifier would be a migration plus
 * four censuses for no new switch anybody wants.
 */

export const REPLY_CLASSIFY_TOOL_NAME = "classify_reply";
export const REPLY_CLASSIFY_PROMPT_VERSION = "reply-classify.1";

export const REPLY_CLASSES = [
  "INTERESTED",
  "SEND_INFO",
  "NOT_NOW",
  "WRONG_PERSON",
  "OUT_OF_OFFICE",
  "STOP",
  "HOSTILE",
  "QUESTION",
  "UNCLEAR",
] as const;
export type ReplyClassification = (typeof REPLY_CLASSES)[number];

export const OUTBOUND_DOORS = ["PAY_APP", "CERTIFIED_PAYROLL", "TAKEOFF", "UNKNOWN"] as const;
export type OutboundDoorName = (typeof OUTBOUND_DOORS)[number];

export type ReplyClassifyResult = {
  classification: ReplyClassification;
  door: OutboundDoorName;
  /** 0..1, the model's own estimate. */
  confidence: number;
  extracted: {
    wantsText: boolean;
    phone?: string;
    bestTime?: string;
    files?: string[];
  };
};

const SYSTEM_PROMPT = `You classify replies to cold emails sent by C Stream to construction subcontractors (drywall, framing, plaster, EIFS, ceilings, fireproofing) in California. C Stream offers three things, one per email thread — the "door":

- PAY_APP: we assemble the monthly pay application (the G702/G703, the schedule of values, the lien releases) so the GC does not kick it back.
- CERTIFIED_PAYROLL: we turn a week of timecards into the certified payroll ("certifieds", "the 347", "the DIR", "the xml", "the eCPR upload") for prevailing-wage jobs.
- TAKEOFF: we do the drywall/framing takeoff from the drawing set so the bid goes out on time.

Read the reply in the subs' own words. "Certifieds", "the 347", "DIR", "prevailing wage", "timecards" mean CERTIFIED_PAYROLL. "Pay app", "G702", "SOV", "billing", "retention", "lien release" mean PAY_APP. "Takeoff", "bid", "plans", "drawings", "quantities" mean TAKEOFF. If the reply does not say and the email it answers does not say, the door is UNKNOWN.

Classes:
- INTERESTED: they want it, or want to talk. "Yeah send me what you need", "call me Tuesday", "how does this work, we have a job starting".
- SEND_INFO: they want to read something first, no commitment. "Send me some info", "what do you charge" (a price question is SEND_INFO, never answer it).
- NOT_NOW: not this season, slow right now, maybe later. "Slow till spring", "check back after this job".
- WRONG_PERSON: the office manager, the wrong trade, "I just do the books, talk to Mike".
- OUT_OF_OFFICE: an autoresponder.
- STOP: asked to be left alone, however politely. (The app catches the obvious words before you see them; still use STOP for "not interested, please don't follow up".)
- HOSTILE: angry, threatening, abusive.
- QUESTION: a real question you cannot answer with a class above — about a contract, a legal position, a scope, a date.
- UNCLEAR: cannot tell.

Confidence is your honest estimate that the class is right, 0 to 1. Be strict: a reply that could be read two ways is below 0.8.

Extract only what the reply states: a phone number they gave, whether they asked to be TEXTED (not called), a best time if they named one, and file names if they attached or named any.`;

export async function classifyOutboundReply(params: {
  subject: string | null;
  body: string;
  /** The email they are answering, when the vendor sent it along. */
  previousOutbound: string | null;
  onUsage?: ModelUsageReporter;
  /** The model this company's `aiGate` resolved. */
  model?: string;
}): Promise<ReplyClassifyResult> {
  const client = new Anthropic(AI_CLIENT_OPTIONS);
  const response = await client.messages.create({
    model: params.model ?? modelFor("AI_AGENTS").model,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools: [
      {
        name: REPLY_CLASSIFY_TOOL_NAME,
        description: "Records what the reply means, for the app to answer from a fixed template or hand to a person.",
        input_schema: {
          type: "object",
          properties: {
            classification: { type: "string", enum: [...REPLY_CLASSES] },
            door: { type: "string", enum: [...OUTBOUND_DOORS] },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            wantsText: { type: "boolean" },
            phone: { type: "string" },
            bestTime: { type: "string" },
            files: { type: "array", items: { type: "string" } },
          },
          required: ["classification", "door", "confidence", "wantsText"],
          additionalProperties: false,
        },
      },
    ],
    tool_choice: { type: "tool", name: REPLY_CLASSIFY_TOOL_NAME },
    messages: [
      {
        role: "user",
        content: [
          params.previousOutbound ? `THE EMAIL WE SENT:\n${params.previousOutbound.slice(0, 4000)}\n\n` : "",
          `THEIR REPLY${params.subject ? ` (subject: ${params.subject})` : ""}:\n${params.body.slice(0, 6000)}`,
        ].join(""),
      },
    ],
  });

  // Reported before the result is read: a call that produced nothing usable
  // still cost the money (anthropic.ts).
  await reportUsage(params.onUsage, response.usage);
  return readReplyClassification(response.content);
}

/**
 * Pure, so it is tested without the SDK. THROWS when there is no tool call —
 * a model that answered in prose has not classified anything, and the caller
 * queues the reply for a person rather than filing it as UNCLEAR with a
 * confidence it never gave (wallClassify.ts learned this on a real drawing).
 */
export function readReplyClassification(content: Anthropic.ContentBlock[]): ReplyClassifyResult {
  const block = content.find(
    (one): one is Anthropic.ToolUseBlock => one.type === "tool_use" && one.name === REPLY_CLASSIFY_TOOL_NAME,
  );
  if (!block) throw new Error("the model returned no classification");
  const input = block.input as Record<string, unknown>;
  const classification = REPLY_CLASSES.find((c) => c === input.classification) ?? "UNCLEAR";
  const door = OUTBOUND_DOORS.find((d) => d === input.door) ?? "UNKNOWN";
  const raw = typeof input.confidence === "number" ? input.confidence : 0;
  const confidence = Math.min(1, Math.max(0, Number.isFinite(raw) ? raw : 0));
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : undefined);
  const files = Array.isArray(input.files)
    ? input.files.filter((f): f is string => typeof f === "string" && f.trim().length > 0).slice(0, 20)
    : undefined;
  return {
    classification,
    door,
    confidence,
    extracted: {
      wantsText: input.wantsText === true,
      ...(str(input.phone) ? { phone: str(input.phone) } : {}),
      ...(str(input.bestTime) ? { bestTime: str(input.bestTime) } : {}),
      ...(files && files.length ? { files } : {}),
    },
  };
}
