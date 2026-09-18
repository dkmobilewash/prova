import { prisma } from "@prova/db";
import { createBidPursuit, setBidPursuitStage } from "@/lib/actions/bidPursuits";
import {
  BID_PURSUIT_STAGES,
  BidPursuitInputError,
  optionalValueFromString,
  STAGE_LABELS,
  type BidPursuitStage,
} from "@/lib/bid-pursuits";
import { money } from "@/lib/money";
import { dayLabel, parseDateWords, relativeToToday } from "../dates";
import { rankByName } from "../resolve";
import { formDataFrom, throughAction } from "./adapter";
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
 * The pre-bid pursuit list (/pipeline, BidPursuit), from a sentence.
 *
 * DIRECT over the two ActionResult actions in lib/actions/bidPursuits.ts —
 * `createBidPursuit` and `setBidPursuitStage` — called with the FormData /
 * arguments their own forms send, so their capability check, their
 * validation (the value parser, the stage parser, the linked-invitation
 * rule) and their sentences are the ones the person would meet on the page.
 * Nothing here re-implements a rule; `resolve` only runs the same parsers
 * early so a card never offers a button that can only fail.
 *
 * THE STAGE IS NEVER INFERRED. The estimating exclusion this replaces said
 * "a stage is somebody's judgement about a chase, not something to infer
 * from a sentence", and that stays true: both commands take a stage only
 * when the person NAMED one, mapped from their word to one of the five in
 * code. A word that names none of them is a chip row of all five, never a
 * pick. "We talked to Turner about it" is not "contacted" unless they said
 * so.
 */

const str = (payload: ResolvedPayload, key: string): string | null =>
  typeof payload[key] === "string" ? (payload[key] as string) : null;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** What a person calls each stage, as whole phrases. Deliberately narrow:
 * a word not listed is a question, not a guess. */
const STAGE_WORDS: Record<BidPursuitStage, RegExp> = {
  WATCHING: /^(?:watch|watching|watch it|watch list|on the watch list|keep an eye on it)$/,
  CONTACTED: /^(?:contacted|contact made|reached out|called|called them|made contact)$/,
  EXPECTING_INVITE: /^(?:expecting invite|expecting an invite|expecting invitation|expecting an invitation|expecting the invite|invite expected|expected invite)$/,
  INVITED: /^(?:invited|got the invite|got an invite|invite came in|we got invited)$/,
  DROPPED: /^(?:dropped|drop|drop it|dead|passed|pass|no go|not pursuing|walked away)$/,
};

/** The person's word for a stage, or a chip's enum value. */
export function readStage(text: string): BidPursuitStage | null {
  const words = text.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (!words) return null;
  const asEnum = words.toUpperCase().replace(/ /g, "_");
  if ((BID_PURSUIT_STAGES as readonly string[]).includes(asEnum)) return asEnum as BidPursuitStage;
  return BID_PURSUIT_STAGES.find((stage) => STAGE_WORDS[stage].test(words)) ?? null;
}

const stageOptions = (): Option[] => BID_PURSUIT_STAGES.map((stage) => ({ value: stage, label: STAGE_LABELS[stage] }));

/** The bid date the person gave, as a day, or the Resolution that stops
 * here. Same three outcomes log_bid_invitation's due date has. */
function bidDayFor(text: string, today: string): { day: string } | Resolution {
  const parsed = parseDateWords(text, today);
  if (!parsed) {
    return {
      kind: "need",
      missing: `the expected bid date as a calendar day — "${text}" isn't one this app can read. Say it like "October 3" or "10/3/2026"`,
    };
  }
  switch (parsed.kind) {
    case "on":
      return { day: parsed.day };
    case "which-year":
      return {
        kind: "clarify",
        field: "expectedBidDate",
        question: `"${text}" has already passed this year — which bid date?`,
        options: [
          { value: parsed.thisYear, label: dayLabel(parsed.thisYear), detail: relativeToToday(parsed.thisYear, today) },
          { value: parsed.nextYear, label: dayLabel(parsed.nextYear), detail: relativeToToday(parsed.nextYear, today) },
        ],
      };
    case "shift":
    case "shift-either-way":
      return {
        kind: "need",
        missing: `the bid date itself — "${text}" is counted from a date this pursuit doesn't have yet. Say it like "October 3"`,
      };
  }
}

// ------------------------------------------------------------ add_bid_pursuit

async function resolveAddBidPursuit(ctx: CommandContext, input: CommandInput): Promise<Resolution> {
  const projectName = input.projectName ?? "";
  if (!projectName) return { kind: "need", missing: "the project's name, as the person calls it" };

  const warnings: string[] = [];

  let stage: BidPursuitStage = "WATCHING";
  if (input.stage) {
    const read = readStage(input.stage);
    if (!read) {
      return {
        kind: "clarify",
        field: "stage",
        question: `"${input.stage}" isn't one of the five stages — which should this pursuit start at?`,
        options: stageOptions(),
      };
    }
    stage = read;
  }

  let expectedBidDate: string | null = null;
  if (input.expectedBidDate) {
    const result = bidDayFor(input.expectedBidDate, ctx.today);
    if (!("day" in result)) return result;
    expectedBidDate = result.day;
    if (expectedBidDate < ctx.today) warnings.push(`That bid date, ${dayLabel(expectedBidDate)}, has already passed.`);
  }

  // The action's own parser, run early so a bad figure is a question rather
  // than a card whose button can only fail. The digits are the person's.
  let estimatedValue: string | null = null;
  if (input.estimatedValue) {
    try {
      estimatedValue = optionalValueFromString(input.estimatedValue);
    } catch (err) {
      if (err instanceof BidPursuitInputError) return { kind: "need", missing: `the estimated value — ${err.message}` };
      throw err;
    }
  }

  const owner = input.owner ?? null;
  const architect = input.architect ?? null;
  const expectedGcs = input.expectedGcs ?? null;
  const note = input.note ?? null;

  const preview: PreviewLine[] = [
    { label: "Project", value: projectName },
    { label: "Stage", value: STAGE_LABELS[stage] },
    { label: "Owner", value: owner ?? "not set" },
    { label: "Architect", value: architect ?? "not set" },
    { label: "GC(s) expected", value: expectedGcs ?? "not set" },
    { label: "Expected bid date", value: expectedBidDate ? dayLabel(expectedBidDate) : "not set" },
    { label: "Estimated value", value: estimatedValue ? money(Number(estimatedValue)) : "not set" },
    { label: "Note", value: note ?? "none" },
  ];

  const resolved: ResolvedPayload = { projectName, stage, owner, architect, expectedGcs, expectedBidDate, estimatedValue, note };

  // The same project still being chased is this pursuit: the card links to
  // it and offers no button. A DROPPED one can be chased again.
  const twin = await prisma.bidPursuit.findFirst({
    where: {
      companyId: ctx.companyId,
      projectName: { equals: projectName, mode: "insensitive" },
      stage: { not: "DROPPED" },
    },
    select: { id: true, projectName: true, stage: true },
  });
  if (twin) {
    return {
      kind: "ready",
      resolved,
      preview,
      warnings,
      existing: { label: `${twin.projectName} is already on the pursuit list (${STAGE_LABELS[twin.stage as BidPursuitStage]})`, href: "/pipeline" },
    };
  }

  return { kind: "ready", resolved, preview, warnings };
}

async function executeAddBidPursuit(ctx: CommandContext, payload: ResolvedPayload): Promise<Executed> {
  const projectName = str(payload, "projectName");
  const stage = str(payload, "stage");
  const expectedBidDate = payload.expectedBidDate === null ? null : str(payload, "expectedBidDate");
  if (!projectName || !stage || (expectedBidDate !== null && !ISO_DAY.test(expectedBidDate))) {
    return { ok: false, error: "That card can't be executed. Ask again." };
  }
  const result = await throughAction("Add pursuit", () =>
    createBidPursuit(
      formDataFrom({
        projectName,
        stage,
        owner: str(payload, "owner"),
        architect: str(payload, "architect"),
        expectedGcs: str(payload, "expectedGcs"),
        expectedBidDate,
        estimatedValue: str(payload, "estimatedValue"),
        note: str(payload, "note"),
      }),
    ),
  );
  if (!result.ok) return { ok: false, error: result.error };
  const row = await prisma.bidPursuit.findFirst({
    where: { companyId: ctx.companyId, projectName },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return {
    ok: true,
    message: `Added ${projectName} to the pursuit list as ${STAGE_LABELS[stage as BidPursuitStage] ?? stage}.`,
    created: { label: projectName, href: "/pipeline", targetType: "BidPursuit", targetId: row?.id ?? projectName },
  };
}

export const addBidPursuitCommand: DirectCommandDefinition = {
  name: "add_bid_pursuit",
  description:
    "Adds a project to the company's own pre-bid pursuit list (the Pipeline page) — work somebody here is chasing BEFORE any GC has invited us to bid: the project's name, and whatever the person said of the owner, architect, the GC(s) expected to bid it, the expected bid date in their words, a rough value in their digits, a note, and a stage ONLY if they named one (watching, contacted, expecting invite, invited, dropped — it starts at watching otherwise). Needs the project name; ask if missing. Never invent, estimate or round a value or a date, and never choose a stage the person did not say. Does NOT log a bid invitation (that is log_bid_invitation, for when a GC has actually invited us), does not create a job or a contact, and sends nothing.",
  capability: "MANAGE_ESTIMATING",
  tier: "T1_DRAFT",
  mode: "DIRECT",
  action: "createBidPursuit",
  core: "createBidPursuit",
  title: "Add to the pursuit list",
  verb: "Preparing the pursuit",
  button: "Add pursuit",
  input_schema: {
    type: "object",
    properties: {
      projectName: { type: "string", description: "The project, as the person named it, e.g. 'Northgate Medical'. Required: ask if they did not say." },
      owner: { type: "string", description: "The project's owner or developer, in the person's words. Omit if not said." },
      architect: { type: "string", description: "The architect, in the person's words. Omit if not said." },
      expectedGcs: { type: "string", description: "The GC or GCs expected to bid it, in the person's words, e.g. 'Turner and Skanska'. Omit if not said." },
      expectedBidDate: { type: "string", description: "When the bid is expected, in the person's exact words, e.g. 'October 3', '11/15'. Omit if not said; never compute one." },
      estimatedValue: { type: "string", description: "A rough value in the digits the person said, e.g. '250000' or '250,000'. If they said '1.2 million', pass '1,200,000'. Omit if not said; never estimate one." },
      stage: { type: "string", description: "Only if the person named a stage: 'watching', 'contacted', 'expecting invite', 'invited' or 'dropped'. Omit otherwise; it starts at watching." },
      note: { type: "string", description: "Anything else they said about it, in their words. Omit if nothing." },
    },
  },
  resolve: resolveAddBidPursuit,
  execute: executeAddBidPursuit,
};

// ---------------------------------------------------------- set_pursuit_stage

async function resolveSetPursuitStage(ctx: CommandContext, input: CommandInput): Promise<Resolution> {
  if (!input.projectName && !input.pursuitId) return { kind: "need", missing: "which pursuit, by its project name" };

  let pursuit: { id: string; projectName: string; stage: string; bidInvitationId: string | null };
  if (input.pursuitId) {
    // From a chip only (a continuation key), re-asserted in-company.
    const row = await prisma.bidPursuit.findFirst({
      where: { id: input.pursuitId, companyId: ctx.companyId },
      select: { id: true, projectName: true, stage: true, bidInvitationId: true },
    });
    if (!row) return { kind: "refuse", reason: "That pursuit is no longer on your list.", href: "/pipeline" };
    pursuit = row;
  } else {
    const wanted = input.projectName ?? "";
    const rows = await prisma.bidPursuit.findMany({
      where: { companyId: ctx.companyId, projectName: { contains: wanted, mode: "insensitive" } },
      select: { id: true, projectName: true, stage: true, bidInvitationId: true },
      orderBy: { updatedAt: "desc" },
      take: 20,
    });
    const ranked = rankByName(
      rows.map((row) => ({ ...row, name: row.projectName })),
      wanted,
    );
    if (ranked.length === 0) {
      return { kind: "refuse", reason: `No pursuit matches "${wanted}". Add it first, or check the name on the Pipeline page.`, href: "/pipeline" };
    }
    if (ranked.length > 1) {
      return {
        kind: "clarify",
        field: "pursuitId",
        question: "Which pursuit?",
        options: ranked.map((row) => ({ value: row.id, label: row.projectName, detail: STAGE_LABELS[row.stage as BidPursuitStage] })),
      };
    }
    pursuit = ranked[0];
  }

  if (!input.stage) return { kind: "need", missing: `which stage to move ${pursuit.projectName} to` };
  const next = readStage(input.stage);
  if (!next) {
    return {
      kind: "clarify",
      field: "stage",
      question: `"${input.stage}" isn't one of the five stages — which should ${pursuit.projectName} move to?`,
      options: stageOptions(),
    };
  }
  const current = pursuit.stage as BidPursuitStage;
  if (current === next) {
    return { kind: "refuse", reason: `${pursuit.projectName} is already at ${STAGE_LABELS[next]}.`, href: "/pipeline" };
  }
  // The action's own rule, said before the card rather than after the tap.
  if (pursuit.bidInvitationId && next !== "INVITED") {
    return {
      kind: "refuse",
      reason: `${pursuit.projectName} is linked to a logged bid invitation, so it is Invited. Unlink the invitation on the Pipeline page first if the invite did not really come from this pursuit.`,
      href: "/pipeline",
    };
  }

  return {
    kind: "ready",
    resolved: { pursuitId: pursuit.id, projectName: pursuit.projectName, from: current, stage: next },
    preview: [
      { label: "Pursuit", value: pursuit.projectName },
      { label: "Stage now", value: STAGE_LABELS[current] },
      { label: "Moves to", value: STAGE_LABELS[next] },
    ],
    warnings:
      next === "INVITED"
        ? ["This marks the invite as arrived without linking a logged bid invitation. Log the invitation too if the GC sent one."]
        : [],
  };
}

async function executeSetPursuitStage(_ctx: CommandContext, payload: ResolvedPayload): Promise<Executed> {
  const pursuitId = str(payload, "pursuitId");
  const projectName = str(payload, "projectName");
  const stage = str(payload, "stage");
  if (!pursuitId || !projectName || !stage) return { ok: false, error: "That card can't be executed. Ask again." };
  const result = await throughAction("Change stage", () => setBidPursuitStage(pursuitId, stage));
  if (!result.ok) return { ok: false, error: result.error };
  return {
    ok: true,
    message: `Moved ${projectName} to ${STAGE_LABELS[stage as BidPursuitStage] ?? stage}.`,
    created: { label: projectName, href: "/pipeline", targetType: "BidPursuit", targetId: pursuitId },
  };
}

export const setPursuitStageCommand: DirectCommandDefinition = {
  name: "set_pursuit_stage",
  description:
    "Moves a project on the company's own pre-bid pursuit list (the Pipeline page) to the stage the person NAMED: watching, contacted, expecting invite, invited or dropped. Needs the project's name and the stage; ask for either if missing, and never pick a stage from how a conversation went — only from the stage word the person said. Refuses when the pursuit is already at that stage, and when it is linked to a logged bid invitation and the new stage is not invited. Does NOT log, change or link a bid invitation, and does not delete anything.",
  capability: "MANAGE_ESTIMATING",
  tier: "T2_MODIFY",
  mode: "DIRECT",
  action: "setBidPursuitStage",
  core: "setBidPursuitStage",
  title: "Change the pursuit's stage",
  verb: "Preparing the stage change",
  button: "Change stage",
  input_schema: {
    type: "object",
    properties: {
      projectName: { type: "string", description: "The pursuit's project, as the person named it, e.g. 'Northgate'. Required: ask if they did not say." },
      stage: { type: "string", description: "The stage the person said, in their words: 'watching', 'contacted', 'expecting invite', 'invited' or 'dropped'. Required: ask if they did not say one." },
    },
  },
  continuationKeys: ["pursuitId"],
  resolve: resolveSetPursuitStage,
  execute: executeSetPursuitStage,
};

export const pursuitCommands: DirectCommandDefinition[] = [addBidPursuitCommand, setPursuitStageCommand];
