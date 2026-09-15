import { prisma } from "@prova/db";
import {
  createPunchListItems,
  MAX_PUNCH_ITEMS,
  punchItemKey,
  splitPunchItems,
  tooManyPunchItems,
} from "@/lib/field/punch-list-items";
import { findJob } from "./findJob";
import type {
  CommandContext,
  CommandDefinition,
  DirectCommandDefinition,
  CommandInput,
  Exclusion,
  PreviewLine,
  ResolvedPayload,
  Resolution,
} from "../commands";

/**
 * A whole punch list, in one card, actually written.
 *
 * This replaced `add_punch_item`, which was HANDOFF (its card opened
 * /punch-lists with one item prefilled and the person saved it there) and
 * carried exactly one item per card. The reason was real at the time —
 * `createPunchListItem` threw its refusals, and a thrown Server Action
 * message is redacted in production — but the effect was that the assistant
 * told a foreman with a list of eight things that it does "one item per
 * card, so eight passes". That is the opposite of the product.
 *
 * So the action's body is lifted into lib/field/punch-list-items.ts, which
 * returns its refusals, and this is DIRECT: the tap writes every item in one
 * transaction. The old command is RETIRED rather than kept for the
 * single-item case — this one handles 1..N, and two commands for one job is
 * a coin flip the model makes mid-sentence.
 *
 * `CommandInput` is strings only (see commands.ts), so the list arrives as
 * ONE newline-separated string and is split here. Nothing about it is
 * trusted: the split, the cap, the blanks and the duplicates are all decided
 * in code, and every item that will be created is on the card before
 * anything is.
 */

/**
 * The same number as `MAX_MODEL_VALUE` in ../commands, declared again here
 * rather than imported, because commands.ts imports this file's registry: a
 * VALUE import back the other way is a cycle, and it fails by leaving
 * `punchListCommands` undefined at module init — which is how this was found,
 * not guessed. punchLists.test.ts pins the two numbers together, so this
 * cannot drift silently.
 */
export const MODEL_VALUE_CEILING = 1000;

const str = (payload: ResolvedPayload, key: string): string | null =>
  typeof payload[key] === "string" ? (payload[key] as string) : null;

const strings = (payload: ResolvedPayload, key: string): string[] => {
  const value = payload[key];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
};

async function resolveAddPunchItems(ctx: CommandContext, input: CommandInput): Promise<Resolution> {
  if (!(input.jobName || input.jobId)) {
    return { kind: "need", missing: "which job the items are on" };
  }
  const located = await findJob(ctx, input);
  if (located.kind !== "job") return located;
  const { job } = located;

  const raw = input.items ?? "";
  const { descriptions: listed, blanks } = splitPunchItems(raw);
  if (listed.length === 0) {
    return { kind: "need", missing: "what needs fixing — the items in the person's own words, one per line" };
  }
  if (listed.length > MAX_PUNCH_ITEMS) {
    return { kind: "refuse", reason: tooManyPunchItems(listed.length), href: "/punch-lists" };
  }

  // One query, the same one the punch list page makes: what is already open
  // on this job. Cheap enough to do every time, and the alternative is a
  // person walking a site adding the same thing twice because the assistant
  // could not see the list it was adding to.
  const open = await prisma.punchListItem.findMany({
    where: { companyId: ctx.companyId, jobId: job.id, isDone: false },
    select: { description: true },
  });
  const alreadyOpen = new Set(open.map((item) => punchItemKey(item.description)));

  const seen = new Set<string>();
  const descriptions: string[] = [];
  const repeated: string[] = [];
  const existing: string[] = [];
  for (const description of listed) {
    const key = punchItemKey(description);
    if (seen.has(key)) {
      repeated.push(description);
      continue;
    }
    seen.add(key);
    if (alreadyOpen.has(key)) {
      existing.push(description);
      continue;
    }
    descriptions.push(description);
  }

  if (descriptions.length === 0) {
    return {
      kind: "refuse",
      reason: `${listed.length === 1 ? "That item is" : "Every one of those items is"} already open on ${job.name}, so there is nothing to add.`,
      href: "/punch-lists",
    };
  }

  const warnings: string[] = [];
  // `schemaInput` truncates a model-supplied value at MAX_MODEL_VALUE, which
  // would cut the last line in half silently. It cannot be detected after
  // the fact, only suspected — the preview shows the mangled item, and this
  // says why it looks that way.
  if (raw.length >= MODEL_VALUE_CEILING) {
    warnings.push("That list arrived at the length limit, so the last item may be cut short — check it before confirming.");
  }
  if (blanks > 0) {
    warnings.push(`${blanks} blank ${blanks === 1 ? "line was" : "lines were"} ignored.`);
  }
  if (repeated.length > 0) {
    warnings.push(`Listed more than once, so added once: ${repeated.join("; ")}.`);
  }
  if (existing.length > 0) {
    warnings.push(`Already open on this job, so not added again: ${existing.join("; ")}.`);
  }

  // Every item, one preview line each — the person confirms the whole list
  // once, so the whole list has to be in front of them. Labels are unique
  // because AskProposalCard keys its rows on them.
  const preview: PreviewLine[] = [
    { label: "Job", value: job.name },
    { label: "Adding", value: `${descriptions.length === 1 ? "1 item" : `${descriptions.length} items`}` },
    ...descriptions.map((description, index) => ({ label: `Item ${index + 1}`, value: description })),
  ];

  return {
    kind: "ready",
    resolved: { jobId: job.id, jobName: job.name, descriptions },
    preview,
    warnings,
  };
}

async function executeAddPunchItems(ctx: CommandContext, payload: ResolvedPayload) {
  const jobId = str(payload, "jobId");
  const jobName = str(payload, "jobName");
  const descriptions = strings(payload, "descriptions");
  if (!jobId || !jobName || descriptions.length === 0) {
    return { ok: false as const, error: "That card can't be executed. Ask again." };
  }

  const result = await createPunchListItems(ctx.companyId, jobId, {
    descriptions,
    raisedByUserId: ctx.userId,
  });
  if (!result.ok) return { ok: false as const, error: result.error };
  const { items } = result.value;

  const count = items.length === 1 ? "1 item" : `${items.length} items`;
  return {
    ok: true as const,
    message: `Added ${count} to the punch list on ${jobName}.`,
    created: {
      label: `Punch list, ${jobName}`,
      href: "/punch-lists",
      targetType: "PunchListItem",
      targetId: items[0].id,
    },
  };
}

export const addPunchItemsCommand: DirectCommandDefinition = {
  name: "add_punch_items",
  description:
    "Puts things on a job's punch list — what still has to be fixed before that job closes out — and CREATES EVERY ONE OF THEM when the person confirms the card. Takes the whole list at once: pass every item in `items`, one per line, in the person's own words, however many they gave (one is fine, up to 25). Needs the job and at least one item; ask for either if missing. Blank lines are dropped and anything already open on that job is skipped, both said on the card. It does NOT mark anything done, does not edit or remove an item that already exists, does not split a list across several cards, does not invent items the person did not say, and refuses a list longer than 25.",
  capability: "MANAGE_FIELD",
  tier: "T1_DRAFT",
  mode: "DIRECT",
  action: "createPunchListItem",
  core: "createPunchListItems",
  title: "Add to the punch list",
  verb: "Preparing the punch list",
  button: "Add items",
  input_schema: {
    type: "object",
    properties: {
      jobName: { type: "string", description: "The job the items are on, as the person named it. Required." },
      items: {
        type: "string",
        description:
          "Every item the person gave, ONE PER LINE, separated by newlines, in their own words and including where on the job if they said — e.g. \"Ceiling grid out of level, east corridor\\nMissing corner bead at column B3\\nTouch-up paint, stair 2\". Pass the whole list in this one call; never one item per call. Required.",
      },
    },
  },
  continuationKeys: ["jobId"],
  resolve: resolveAddPunchItems,
  execute: executeAddPunchItems,
};

export const punchListCommands: CommandDefinition[] = [addPunchItemsCommand];

/** The rest of lib/actions/punchLists.ts, each with its reason. */
export const punchListExclusions: Exclusion[] = [
  {
    action: "updatePunchListItem",
    reason: "Rewords or moves the item being looked at, on its own row; a page edit rather than a command.",
  },
  {
    action: "setPunchListItemDone",
    reason: "Checking an item off is one reversible tap on its row; a card would be slower than the tap it replaces.",
  },
  { action: "deletePunchListItem", reason: "T5: deletes are never commands; the row's own two-step delete is the only path." },
];
