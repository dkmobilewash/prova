import type { OutboundDoor, ReplyClass } from "@prova/db";

/**
 * WHO ANSWERS: THE AGENT OR A PERSON. Pure, so the thresholds are a test.
 *
 * The agent sends ONLY the three classes whose answer is a fixed intake or a
 * fixed "later" — and only when the model is sure (≥ 0.8), only when the door
 * is known (an INTERESTED reply with no door has no intake to send), and only
 * while `REPLY_AGENT_AUTOSEND` is on. The first week runs with it off, so
 * every draft is read by a person before the templates are trusted.
 *
 * STOP suppresses regardless of anything — including the switch — and never
 * answers. OUT_OF_OFFICE is dismissed: an autoresponder is nobody. Everything
 * else is a person's call: a question, a hostile reply, an unclear one, and
 * anything that would commit to a price, a date, a scope or a legal position
 * has no template, so there is nothing here that could send it.
 */

export const AUTOSEND_CONFIDENCE = 0.8;

export type ReplyDecision = "AUTO_SEND" | "PENDING_REVIEW" | "SUPPRESS" | "DISMISS";

const AUTO_SENDABLE: ReadonlySet<ReplyClass> = new Set(["INTERESTED", "SEND_INFO", "NOT_NOW"]);

export function decide(input: {
  classification: ReplyClass;
  confidence: number;
  door: OutboundDoor;
  autosend: boolean;
}): ReplyDecision {
  const { classification, confidence, door, autosend } = input;
  if (classification === "STOP") return "SUPPRESS";
  if (classification === "OUT_OF_OFFICE") return "DISMISS";
  if (!autosend) return "PENDING_REVIEW";
  if (!AUTO_SENDABLE.has(classification)) return "PENDING_REVIEW";
  if (confidence < AUTOSEND_CONFIDENCE) return "PENDING_REVIEW";
  if (classification === "INTERESTED" && door === "UNKNOWN") return "PENDING_REVIEW";
  return "AUTO_SEND";
}

/** `REPLY_AGENT_AUTOSEND=true` and nothing else turns the agent's send on. */
export function autosendEnabled(env: Record<string, string | undefined>): boolean {
  return env.REPLY_AGENT_AUTOSEND?.trim().toLowerCase() === "true";
}
