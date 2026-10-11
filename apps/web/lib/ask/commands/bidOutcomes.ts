import { prisma, type BidOutcomeReason } from "@prova/db";
import { recordBidOutcome } from "@/lib/actions/bidOutcomes";
import { money } from "@/lib/money";
import { dayLabel, parsePastDay } from "../dates";
import { throughAction } from "./adapter";
import type {
  CommandContext,
  CommandInput,
  DirectCommandDefinition,
  Executed,
  Option,
  PreviewLine,
  ResolvedPayload,
  Resolution,
} from "../commands";

/**
 * "We lost Riverside on price to Acme at 1.2 million" -> a card, then the
 * BidOutcome row and the WON/LOST status, through `recordBidOutcome`.
 *
 * The shape of `log_bid_invitation` (bids.ts): `resolve` reads only and
 * decides every line in code; the card shows each field the row will hold;
 * the tap calls the ActionResult action with the server-held payload, so
 * its capability check and its sentences are the ones the form gives.
 *
 * NOTHING IS INFERRED. The result and the reason are the person's words
 * mapped to the enum in code; a word that maps to nothing, or to several,
 * is a chip row. A winning price is read only from digits the person said.
 * The model supplies names and words, never a figure it computed.
 */

const RESULT_WORDS: { result: "WON" | "LOST"; re: RegExp }[] = [
  { result: "WON", re: /\b(?:won|win|winning|awarded|got (?:it|the job)|landed)\b/ },
  { result: "LOST", re: /\b(?:lost|lose|losing|not awarded|didn'?t get|did not get|passed over|went to someone else)\b/ },
];

export const REASON_LABELS: Record<BidOutcomeReason, string> = {
  PRICE: "Price",
  RELATIONSHIP: "Relationship",
  SCOPE: "Scope",
  SCHEDULE: "Schedule",
  QUALIFICATIONS: "Qualifications",
  OTHER: "Other",
};

const REASON_WORDS: Record<BidOutcomeReason, RegExp> = {
  PRICE: /\b(?:price|priced|pricing|number|cheap|cheaper|low(?:er)?|high(?:er)?|cost|money|budget)\b/,
  RELATIONSHIP: /\b(?:relationship|relations|incumbent|preferred|favou?rite|friend|usual sub|loyal)\b/,
  SCOPE: /\b(?:scope|exclusions?|inclusions?|qualified out|clarifications?)\b/,
  SCHEDULE: /\b(?:schedule|timing|time|manpower|duration|start date|availability)\b/,
  QUALIFICATIONS: /\b(?:qualifications?|qualified|bond(?:ing)?|insurance|licen[cs]e|prequal\w*|experience|union|dbe|mbe|wbe)\b/,
  OTHER: /\b(?:other)\b/,
};

export function readResult(text: string): "WON" | "LOST" | null {
  const words = text.trim().toLowerCase();
  if (words === "won" || words === "lost") return words.toUpperCase() as "WON" | "LOST";
  const hits = RESULT_WORDS.filter((r) => r.re.test(words));
  return hits.length === 1 ? hits[0]!.result : null;
}

export function readReason(text: string): BidOutcomeReason[] {
  const words = text.trim().toLowerCase();
  const asEnum = words.toUpperCase();
  if (asEnum in REASON_LABELS) return [asEnum as BidOutcomeReason];
  return (Object.keys(REASON_WORDS) as BidOutcomeReason[]).filter((reason) => REASON_WORDS[reason].test(words));
}

/** "$1,234,500", "1234500", "1.2m", "850k" — digits the person said. */
export function readAmount(text: string): number | null {
  const m = text.trim().toLowerCase().replace(/[$,\s]/g, "").match(/^(\d+(?:\.\d+)?)(k|m|million|thousand)?$/);
  if (!m) return null;
  const scale = m[2] === "k" || m[2] === "thousand" ? 1e3 : m[2] === "m" || m[2] === "million" ? 1e6 : 1;
  const value = Math.round(Number(m[1]) * scale * 100) / 100;
  return value > 0 ? value : null;
}

const str = (payload: ResolvedPayload, key: string): string | null =>
  typeof payload[key] === "string" ? (payload[key] as string) : null;

const reasonOptions = (reasons: readonly BidOutcomeReason[]): Option[] =>
  reasons.map((reason) => ({ value: reason, label: REASON_LABELS[reason] }));

async function resolveRecordBidOutcome(ctx: CommandContext, input: CommandInput): Promise<Resolution> {
  const missing: string[] = [];
  if (!input.projectName && !input.bidInvitationId) missing.push("which bid it is, by the project's name");
  if (!input.result) missing.push("whether it was won or lost");
  if (missing.length > 0) return { kind: "need", missing: missing.join(", and ") };

  // The bid: from a chip, or by project name (and GC if said).
  let bid: { id: string; projectName: string; status: string; contactName: string; outcome: { result: string; reason: string } | null };
  const select = {
    id: true,
    projectName: true,
    status: true,
    contact: { select: { name: true } },
    outcome: { select: { result: true, reason: true } },
  } as const;
  if (input.bidInvitationId) {
    const row = await prisma.bidInvitation.findFirst({ where: { id: input.bidInvitationId, companyId: ctx.companyId }, select });
    if (!row) return { kind: "refuse", reason: "That bid isn't on your account." };
    bid = { ...row, contactName: row.contact.name };
  } else {
    const rows = await prisma.bidInvitation.findMany({
      where: {
        companyId: ctx.companyId,
        projectName: { contains: input.projectName, mode: "insensitive" },
        ...(input.contactName ? { contact: { name: { contains: input.contactName, mode: "insensitive" as const } } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      select,
    });
    if (rows.length === 0) {
      return { kind: "refuse", reason: `No bid matches "${input.projectName}". Log the invitation first, or check the name on the bids page.`, href: "/bids" };
    }
    if (rows.length > 1) {
      return {
        kind: "clarify",
        field: "bidInvitationId",
        question: `Which ${input.projectName} bid?`,
        options: rows.map((r) => ({ value: r.id, label: `${r.projectName} · ${r.contact.name}`, detail: r.status.toLowerCase() })),
      };
    }
    bid = { ...rows[0]!, contactName: rows[0]!.contact.name };
  }
  if (bid.status === "DECLINED") {
    return { kind: "refuse", reason: `${bid.projectName} was declined, so it can't be won or lost. Reopen it on the bids page first.`, href: "/bids" };
  }

  const result = readResult(input.result!);
  if (!result) {
    return {
      kind: "clarify",
      field: "result",
      question: `Was ${bid.projectName} won or lost?`,
      options: [
        { value: "WON", label: "Won" },
        { value: "LOST", label: "Lost" },
      ],
    };
  }

  if (!input.reason) {
    return { kind: "clarify", field: "reason", question: `Why was ${bid.projectName} ${result === "WON" ? "won" : "lost"}?`, options: reasonOptions(Object.keys(REASON_LABELS) as BidOutcomeReason[]) };
  }
  const reasons = readReason(input.reason);
  if (reasons.length !== 1) {
    return {
      kind: "clarify",
      field: "reason",
      question: `Which reason fits "${input.reason}" best?`,
      options: reasonOptions(reasons.length > 1 ? reasons : (Object.keys(REASON_LABELS) as BidOutcomeReason[])),
    };
  }
  const reason = reasons[0]!;

  let winningPrice: number | null = null;
  if (input.winningPrice) {
    winningPrice = readAmount(input.winningPrice);
    if (winningPrice === null) return { kind: "need", missing: `the winning price as a number — "${input.winningPrice}" isn't one. Say it like "$1,240,000" or "1.24m"` };
  }

  let decidedOn: string | null = null;
  if (input.decidedOn) {
    const day = parsePastDay(input.decidedOn, ctx.today);
    if (!day || day > ctx.today) {
      return { kind: "need", missing: `the day the GC told you, as a past calendar day — "${input.decidedOn}" isn't one. Say it like "October 3" or "10/3"` };
    }
    decidedOn = day;
  }

  const winnerName = input.winnerName?.trim() || null;
  const note = input.note?.trim() || null;
  const warnings: string[] = [];
  if (bid.outcome) warnings.push(`This replaces the outcome already recorded (${bid.outcome.result.toLowerCase()}, ${bid.outcome.reason.toLowerCase()}).`);
  if (result === "WON" && winnerName) warnings.push(`You said it was won but named ${winnerName} as the winner — check that is your company.`);

  const preview: PreviewLine[] = [
    { label: "Bid", value: `${bid.projectName} · ${bid.contactName}` },
    { label: "Result", value: result === "WON" ? "Won" : "Lost" },
    { label: "Reason", value: REASON_LABELS[reason] },
    { label: "Winning price", value: winningPrice !== null ? money(winningPrice) : "not given" },
    { label: "Went to", value: winnerName ?? "not given" },
    { label: "Decided", value: decidedOn ? dayLabel(decidedOn) : "not given" },
    { label: "Note", value: note ?? "none" },
    { label: "Status", value: `${bid.status.charAt(0)}${bid.status.slice(1).toLowerCase()} → ${result === "WON" ? "Won" : "Lost"}` },
  ];

  return {
    kind: "ready",
    resolved: { bidInvitationId: bid.id, projectName: bid.projectName, result, reason, winningPrice, winnerName, note, decidedOn },
    preview,
    warnings,
  };
}

async function executeRecordBidOutcome(_ctx: CommandContext, payload: ResolvedPayload): Promise<Executed> {
  const bidInvitationId = str(payload, "bidInvitationId");
  const projectName = str(payload, "projectName");
  const result = str(payload, "result");
  const reason = str(payload, "reason");
  if (!bidInvitationId || !projectName || (result !== "WON" && result !== "LOST") || !reason || !(reason in REASON_LABELS)) {
    return { ok: false, error: "That card can't be executed. Ask again." };
  }
  const outcome = await throughAction("Record outcome", () =>
    recordBidOutcome({
      bidInvitationId,
      result,
      reason: reason as BidOutcomeReason,
      winningPrice: typeof payload.winningPrice === "number" ? payload.winningPrice : null,
      winnerName: str(payload, "winnerName"),
      note: str(payload, "note"),
      decidedOn: str(payload, "decidedOn"),
    }),
  );
  if (!outcome.ok) return { ok: false, error: outcome.error };
  return {
    ok: true,
    message: `Recorded ${projectName} as ${result === "WON" ? "won" : "lost"} (${REASON_LABELS[reason as BidOutcomeReason].toLowerCase()}).`,
    created: { label: projectName, href: "/bids", targetType: "BidInvitation", targetId: bidInvitationId },
    revalidate: ["/ai"],
  };
}

export const recordBidOutcomeCommand: DirectCommandDefinition = {
  name: "record_bid_outcome",
  description:
    "Records what happened to a bid the company already logged: won or lost, why (price, relationship, scope, schedule, qualifications or other — in the person's words), and, only if the person said them, the winning price, who it went to, the day the GC told them and a note. Sets the bid's status to won or lost to match. Needs the project's name and the result; ask if either is missing. Pass every value exactly as said — never compute, round or invent a price, a date or a reason. Does NOT create or link a job, does not change the bid amount, does not decline a bid, and sends nothing to the GC.",
  capability: "MANAGE_ESTIMATING",
  tier: "T2_MODIFY",
  mode: "DIRECT",
  action: "recordBidOutcome",
  core: "recordBidOutcome",
  title: "Record the bid outcome",
  verb: "Preparing the bid outcome",
  button: "Record outcome",
  input_schema: {
    type: "object",
    properties: {
      projectName: { type: "string", description: "The project the bid was for, as the person named it, e.g. 'Riverside'. Required." },
      contactName: { type: "string", description: "The GC, if the person named one — helps pick the right bid. Omit if not said." },
      result: { type: "string", description: "Won or lost, in the person's words, e.g. 'we lost it', 'got awarded'. Required." },
      reason: { type: "string", description: "Why, in the person's words, e.g. 'came in high', 'they went with their usual sub'. Omit if not said." },
      winningPrice: { type: "string", description: "The winning number exactly as the person said it, e.g. '$1,240,000' or '1.24m'. Omit if not said." },
      winnerName: { type: "string", description: "Who the bid went to, as the person named them. Omit if not said." },
      decidedOn: { type: "string", description: "When the GC told them, in their words, e.g. 'yesterday', 'October 3'. Omit if not said." },
      note: { type: "string", description: "Anything else they said about the outcome. Omit if nothing." },
    },
  },
  continuationKeys: ["bidInvitationId"],
  resolve: resolveRecordBidOutcome,
  execute: executeRecordBidOutcome,
};

export const bidOutcomeCommands: DirectCommandDefinition[] = [recordBidOutcomeCommand];
