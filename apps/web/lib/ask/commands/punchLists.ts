import { findJob } from "./findJob";
import type {
  CommandContext,
  CommandDefinition,
  HandoffCommandDefinition,
  CommandInput,
  Exclusion,
  Resolution,
} from "../commands";

/**
 * Adding a punch list item, as a HANDOFF over Cyrus's page — the same
 * arrangement as rfis.ts. `createPunchListItem` throws its refusals, so
 * the card's primary is a link to /punch-lists?draft=<card>; the page
 * loads the server-held payload and PunchListForm opens with the job and
 * the item filled in. Save is the form's own submit. The form stays open
 * after a save on purpose (items get logged in bursts on a walkthrough),
 * and a draft does not change that: the card carries ONE item, and once
 * it is saved the form is the form again.
 */

async function resolveAddPunchItem(ctx: CommandContext, input: CommandInput): Promise<Resolution> {
  const description = input.description ?? "";
  if (!(input.jobName || input.jobId)) {
    return { kind: "need", missing: "which job the item is on" };
  }
  const located = await findJob(ctx, input);
  if (located.kind !== "job") return located;
  const { job } = located;
  if (!description) return { kind: "need", missing: "what needs fixing, in a few words" };

  return {
    kind: "ready",
    resolved: { jobId: job.id, jobName: job.name, description },
    preview: [
      { label: "Job", value: job.name },
      { label: "Item", value: description },
    ],
    warnings: [],
  };
}

export const addPunchItemCommand: HandoffCommandDefinition = {
  name: "add_punch_item",
  description:
    "Prepares one punch list item — a thing that still has to be fixed before a job closes out, such as \"ceiling grid out of level, east corridor\" — and opens the punch list page with the job and the item filled in; the person saves it there. Needs the job and the item in the person's own words. Does not mark anything done, does not edit or remove an item, and does not add more than one item per card: for several, propose the first and say the rest are next.",
  capability: "MANAGE_FIELD",
  tier: "T1_DRAFT",
  mode: "HANDOFF",
  action: "createPunchListItem",
  handoffHref: (proposalId) => `/punch-lists?draft=${proposalId}`,
  title: "Add a punch item",
  verb: "Preparing the punch item",
  button: "Open the punch list",
  input_schema: {
    type: "object",
    properties: {
      jobName: { type: "string", description: "The job the item is on, as the person named it." },
      description: {
        type: "string",
        description: "What needs fixing, in the person's words, including where on the job if they said.",
      },
    },
  },
  continuationKeys: ["jobId"],
  resolve: resolveAddPunchItem,
};

export const punchListCommands: CommandDefinition[] = [addPunchItemCommand];

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
