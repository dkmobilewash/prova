import { prisma, type TradeScope } from "@prova/db";
import { TRADE_SCOPES } from "@/lib/actions/shared";
import { createBidInvitationRecord } from "@/lib/estimating/bid-invitation";
import { dayLabel, parseDateWords, relativeToToday } from "../dates";
import { resolveContact } from "../resolve";
import type {
  CommandContext,
  CommandInput,
  DirectCommandDefinition,
  Option,
  PreviewLine,
  ResolvedPayload,
  Resolution,
} from "../commands";

/**
 * Diego's lane, phase 4c: the bid invitation, which the estimating
 * exclusions promised once "a contact resolver and a due date the person
 * types" existed. Phase 1 built the resolver (`resolveContact`, the one
 * `create_estimate_job` and `send_email` use) and phase 4b built the date
 * parser, so the promise is kept here.
 *
 * What the record IS, from reading the page rather than the name: a row on
 * `BidInvitation`, logged from the form at the foot of a contact's page
 * ("Log invitation") and listed on /bids — the GC, a project name, an
 * optional trade tag, an optional due date, optional notes, status
 * INVITED, and no bid amount until the bid is marked submitted. A T1 log
 * entry like the estimate job: nothing is sent, nothing is priced.
 *
 * Every line on the card is either read off a row or the person's own
 * words, decided by code:
 *
 *   - THE CONTACT is resolved by name from the company's own list. Nobody
 *     matching is a refusal that points at /contacts — the form cannot
 *     log an invitation from a contact that does not exist, so neither
 *     can this — and several matching is a chip row on `contactId`.
 *   - THE TRADE is the person's word for it ("drywall", "ceilings",
 *     "stucco") mapped to one of the five tags in code. A word that names
 *     none of them, or more than one, is a chip row, never a pick; and a
 *     trade the person never mentioned stays untagged, as the form's
 *     default does — with a warning, because nothing on any page can add
 *     the tag afterwards (`updateBidInvitationStatus` touches status and
 *     amount only).
 *   - THE DUE DATE goes through lib/ask/dates.ts against the person's own
 *     today. A month-day already past this year is a which-year chip row;
 *     a relative phrase has nothing on a new record to count from and is
 *     a question back; anything unreadable is a question quoting the
 *     words. No due date is allowed, as on the form, and warned for the
 *     same reason as the trade.
 *   - THE FIGURE the record could carry, a bid amount, is not on the form
 *     and not on the card. The card says so in its own line, so every
 *     field the row will hold is visible before the tap.
 *
 * DIRECT over the lifted core in lib/estimating/bid-invitation.ts rather
 * than over `createBidInvitation` itself, because the action throws its
 * two refusals and production redacts thrown messages. The tap re-checks
 * the one thing that can change between card and tap: an open invitation
 * from the same contact for the same project, made by somebody else or by
 * a second card, is linked rather than doubled.
 */

const str = (payload: ResolvedPayload, key: string): string | null =>
  typeof payload[key] === "string" ? (payload[key] as string) : null;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const utcMidnight = (day: string) => new Date(`${day}T00:00:00.000Z`);

/** The page's own labels for the five tags (app/(app)/bids/page.tsx). */
export const TRADE_LABELS: Record<TradeScope, string> = {
  METAL_FRAMING_DRYWALL: "Metal framing / drywall",
  LATH_PLASTER: "Lath & plaster",
  EIFS: "EIFS",
  ACOUSTICAL_CEILINGS: "Acoustical ceilings",
  FIREPROOFING: "Fireproofing",
};

/** The chip value for "leave it untagged": a chip cannot send an empty
 * string (schemaInput drops one), so "no tag" is a word. */
export const NO_TRADE_TAG = "NONE";

/** What a person calls each trade, as whole words. A phrase that hits two
 * lists is offered both; one that hits none is offered all five. */
const TRADE_WORDS: Record<TradeScope, RegExp> = {
  METAL_FRAMING_DRYWALL: /\b(?:drywall|dry wall|gypsum|gyp|gwb|sheetrock|board|framing|studs?|partitions?)\b/,
  LATH_PLASTER: /\b(?:plaster|plastering|lath|lathing|stucco)\b/,
  EIFS: /\b(?:eifs)\b/,
  ACOUSTICAL_CEILINGS: /\b(?:ceilings?|acoustic|acoustical|act)\b/,
  FIREPROOFING: /\b(?:fireproof|fireproofing|sfrm|intumescent)\b/,
};

export type ReadTrade =
  | { kind: "one"; scope: TradeScope | null }
  | { kind: "several"; scopes: TradeScope[] }
  | { kind: "unknown" };

/** The person's word for a trade, or a chip's value, turned into a tag. */
export function readTrade(text: string): ReadTrade {
  const words = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!words) return { kind: "unknown" };
  if (words === NO_TRADE_TAG.toLowerCase() || /^(?:no|none|no trade|no tag|no trade tag|untagged)$/.test(words)) {
    return { kind: "one", scope: null };
  }
  const asTag = words.toUpperCase().replace(/[\s/&]+/g, "_");
  if ((TRADE_SCOPES as readonly string[]).includes(asTag)) return { kind: "one", scope: asTag as TradeScope };
  const scopes = TRADE_SCOPES.filter((scope) => TRADE_WORDS[scope].test(words));
  if (scopes.length === 1) return { kind: "one", scope: scopes[0] };
  if (scopes.length > 1) return { kind: "several", scopes };
  return { kind: "unknown" };
}

const tradeOptions = (scopes: readonly TradeScope[]): Option[] =>
  scopes.map((scope) => ({ value: scope, label: TRADE_LABELS[scope] }));

/** The due date the person gave, as a day, or the Resolution that stops
 * here. There is no stored date on a record that does not exist yet, so a
 * relative phrase is a question rather than a count from today. */
function dueDayFor(text: string, today: string): { day: string } | Resolution {
  const parsed = parseDateWords(text, today);
  if (!parsed) {
    return {
      kind: "need",
      missing: `the bid due date as a calendar day — "${text}" isn't one this app can read. Say it like "October 3", "10/3/2026" or "next Friday"`,
    };
  }
  switch (parsed.kind) {
    case "on":
      return { day: parsed.day };
    case "which-year":
      return {
        kind: "clarify",
        field: "dueDate",
        question: `"${text}" has already passed this year — which due date?`,
        options: [
          { value: parsed.thisYear, label: dayLabel(parsed.thisYear), detail: relativeToToday(parsed.thisYear, today) },
          { value: parsed.nextYear, label: dayLabel(parsed.nextYear), detail: relativeToToday(parsed.nextYear, today) },
        ],
      };
    case "shift":
    case "shift-either-way":
      return {
        kind: "need",
        missing: `the due date itself — "${text}" is counted from a date this invitation doesn't have yet. Say it like "October 3" or "next Friday"`,
      };
  }
}

async function resolveLogBidInvitation(ctx: CommandContext, input: CommandInput): Promise<Resolution> {
  const projectName = input.projectName ?? "";
  const contactName = input.contactName ?? "";

  const missing: string[] = [];
  if (!contactName && !input.contactId) missing.push("which GC or contact sent the invitation");
  if (!projectName) missing.push("the project it is for, as the GC named it");
  if (missing.length > 0) return { kind: "need", missing: missing.join(", and ") };

  const warnings: string[] = [];

  // The contact first: everything else on the card is about them.
  let contact: { id: string; name: string };
  if (input.contactId) {
    // From a chip only (a continuation key, never a schema property), and
    // re-asserted in-company regardless.
    const row = await prisma.contact.findFirst({
      where: { id: input.contactId, companyId: ctx.companyId },
      select: { id: true, name: true },
    });
    if (!row) return { kind: "refuse", reason: "That contact isn't on your account." };
    contact = row;
  } else {
    const found = await resolveContact(ctx.companyId, contactName);
    if (found.kind === "none") {
      return {
        kind: "refuse",
        reason: `No contact matches "${contactName}". Add them on the contacts page first, then ask again.`,
        href: "/contacts",
      };
    }
    if (found.kind === "many") {
      return { kind: "clarify", field: "contactId", question: `Which ${contactName}?`, options: found.options };
    }
    contact = { id: found.match.id, name: found.match.name };
    if (found.warning) warnings.push(found.warning);
  }

  // The trade: the person's word, or nothing, or a chip's tag.
  let tradeScope: TradeScope | null = null;
  if (input.trade) {
    const read = readTrade(input.trade);
    if (read.kind === "several") {
      return {
        kind: "clarify",
        field: "trade",
        question: `"${input.trade}" names more than one trade — which tag should this bid carry?`,
        options: tradeOptions(read.scopes),
      };
    }
    if (read.kind === "unknown") {
      return {
        kind: "clarify",
        field: "trade",
        question: `"${input.trade}" isn't one of the five trade tags — which should this bid carry?`,
        options: [...tradeOptions(TRADE_SCOPES), { value: NO_TRADE_TAG, label: "No trade tag" }],
      };
    }
    tradeScope = read.scope;
  } else {
    warnings.push("No trade given, so this bid won't show under a trade filter on the bids page. The tag can't be added afterwards.");
  }

  // The due date: the person's words against their own today.
  let dueDate: string | null = null;
  if (input.dueDate) {
    const result = dueDayFor(input.dueDate, ctx.today);
    if (!("day" in result)) return result;
    dueDate = result.day;
    if (dueDate < ctx.today) warnings.push(`That due date, ${dayLabel(dueDate)}, has already passed.`);
  } else {
    warnings.push("No due date. It can't be added afterwards, so say it now if the GC gave one.");
  }

  const notes = input.notes ?? "";

  const preview: PreviewLine[] = [
    { label: "From", value: contact.name },
    { label: "Project", value: projectName },
    { label: "Trade", value: tradeScope ? TRADE_LABELS[tradeScope] : "no trade tag" },
    { label: "Due", value: dueDate ? dayLabel(dueDate) : "not set" },
    { label: "Notes", value: notes || "none" },
    { label: "Status", value: "Invited" },
    { label: "Bid amount", value: "none yet — entered when you mark the bid submitted" },
  ];

  const resolved: ResolvedPayload = {
    contactId: contact.id,
    contactName: contact.name,
    projectName,
    tradeScope,
    dueDate,
    notes: notes || null,
  };

  // The natural key: an open invitation from this contact for this
  // project is this invitation. The card links to it and offers no button.
  const open = await prisma.bidInvitation.findFirst({
    where: {
      companyId: ctx.companyId,
      contactId: contact.id,
      projectName: { equals: projectName, mode: "insensitive" },
      status: { in: ["INVITED", "SUBMITTED"] },
    },
    select: { id: true, projectName: true },
  });
  if (open) {
    return {
      kind: "ready",
      resolved,
      preview,
      warnings,
      existing: { label: `${contact.name} already has an open bid invitation for ${open.projectName}`, href: "/bids" },
    };
  }

  return { kind: "ready", resolved, preview, warnings };
}

/** A tag from the payload, an explicit null, or a card this code did not
 * write. */
function tradeOrNull(payload: ResolvedPayload): TradeScope | null | undefined {
  const value = payload.tradeScope;
  if (value === null) return null;
  return typeof value === "string" && (TRADE_SCOPES as readonly string[]).includes(value) ? (value as TradeScope) : undefined;
}

function dayOrNull(payload: ResolvedPayload, key: string): string | null | undefined {
  const value = payload[key];
  if (value === null) return null;
  return typeof value === "string" && ISO_DAY.test(value) ? value : undefined;
}

async function executeLogBidInvitation(ctx: CommandContext, payload: ResolvedPayload) {
  const contactId = str(payload, "contactId");
  const contactName = str(payload, "contactName");
  const projectName = str(payload, "projectName");
  const tradeScope = tradeOrNull(payload);
  const dueDate = dayOrNull(payload, "dueDate");
  if (!contactId || !contactName || !projectName || tradeScope === undefined || dueDate === undefined) {
    return { ok: false as const, error: "That card can't be executed. Ask again." };
  }

  const result = await createBidInvitationRecord(
    ctx.companyId,
    {
      contactId,
      projectName,
      dueDate: dueDate ? utcMidnight(dueDate) : null,
      notes: str(payload, "notes"),
      tradeScope,
    },
    { reuseOpenDuplicate: true },
  );
  if (!result.ok) return { ok: false as const, error: result.error };

  const { bidInvitationId, alreadyExisted } = result.value;
  const created = {
    label: `${projectName} · ${contactName}`,
    href: "/bids",
    targetType: "BidInvitation",
    targetId: bidInvitationId,
  };
  // The action revalidates the contact's page as well as /bids; the
  // confirm action covers /bids through `created.href` and this the rest.
  const revalidate = [`/contacts/${contactId}`];

  if (alreadyExisted) {
    return {
      ok: true as const,
      message: `${contactName} already has an open bid invitation for ${projectName}; nothing new was logged.`,
      created,
      revalidate,
    };
  }
  return {
    ok: true as const,
    message: `Logged ${contactName}'s invitation to bid on ${projectName}${dueDate ? `, due ${dayLabel(dueDate)}` : ""}.`,
    created,
    revalidate,
  };
}

export const logBidInvitationCommand: DirectCommandDefinition = {
  name: "log_bid_invitation",
  description:
    "Logs a bid invitation — a GC, or any contact on this company's own list, inviting the company to bid on a project — as the Bids page records it: who it is from, the project's name, the trade if the person said one, the bid due date in the person's own words, and any notes. Needs the contact's name and the project's name; ask if either is missing. The contact must already be on the contacts list: it refuses and says so when the name matches nobody, and offers a choice when it matches several. Pass the due date exactly as said — 'October 3', '10/3', 'next Friday' — never convert, compute or invent one, and omit it if none was said. Does NOT record a bid amount (that is entered when the bid is marked submitted), does not change a bid's status, does not create a job or a contact, and does not send anything to the GC.",
  capability: "MANAGE_ESTIMATING",
  tier: "T1_DRAFT",
  mode: "DIRECT",
  action: "createBidInvitation",
  core: "createBidInvitationRecord",
  title: "Log the bid invitation",
  verb: "Preparing the bid invitation",
  button: "Log invitation",
  input_schema: {
    type: "object",
    properties: {
      contactName: {
        type: "string",
        description:
          "Who the invitation is from, as the person named them — a GC or other contact on this company's own list, e.g. 'Turner' or 'Skanska'. Required: ask if they did not say.",
      },
      projectName: {
        type: "string",
        description:
          "The project the bid is for, as the person named it, e.g. 'Riverside' or 'Main St' — the project itself, not the trade word beside it. Required: ask if they did not give one.",
      },
      trade: {
        type: "string",
        description:
          "The trade the bid is for, in the person's own word for it — 'drywall', 'framing', 'plaster', 'stucco', 'EIFS', 'ceilings', 'fireproofing'. Omit if they did not say a trade.",
      },
      dueDate: {
        type: "string",
        description:
          "When the bid is due, in the person's exact words, e.g. 'October 3', '10/3', 'next Friday'. Omit if they did not say when.",
      },
      notes: {
        type: "string",
        description:
          "Anything else the person said about the invitation, in their words — a walk-through date, a plan link, a scope note. Omit if nothing.",
      },
    },
  },
  continuationKeys: ["contactId"],
  resolve: resolveLogBidInvitation,
  execute: executeLogBidInvitation,
};

export const bidCommands: DirectCommandDefinition[] = [logBidInvitationCommand];
