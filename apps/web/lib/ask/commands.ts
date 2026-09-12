import type { AskToolDefinition } from "@prova/integrations";
import { can, type Capability, type Principal } from "@/lib/permissions";
import { equipmentCommands, equipmentExclusions } from "./commands/equipment";
import { estimatingCommands, estimatingExclusions } from "./commands/estimating";
import { notYetRegistered } from "./commands/exclusions";
import { billingCommands, billingExclusions } from "./commands/billing";
import { fieldCommands, fieldExclusions } from "./commands/field";
import { laborCommands, laborExclusions } from "./commands/labor";
import { punchListCommands, punchListExclusions } from "./commands/punchLists";
import { rfiCommands, rfiExclusions } from "./commands/rfis";

/**
 * The commands: what Ask can DO, as distinct from what it can answer.
 *
 * A command is the write-side twin of a read tool, and the difference is
 * the whole design. A read tool returns a result to the model. A command
 * never writes a business row from inside the model loop: `resolve` turns
 * the names the person used into ids, computes the preview IN CODE, and
 * the executor writes one AskProposal row and halts the stream. The person
 * sees a card. Their tap runs a Server Action (`confirmAskProposal`) that
 * claims the row and calls `execute` with the SERVER-HELD payload. So:
 *
 *   - the model proposes; a person confirms; deterministic code writes;
 *   - one command per question, enforced in the loop, so text injected
 *     into a job name or an RFI subject can at most produce a card the
 *     person reads before tapping — never a second, quieter write;
 *   - every number on a card was read from a row or typed by the person;
 *     the model supplies names and the person's own words, nothing else;
 *   - `companyId`, the user, and the person's role never appear in a
 *     schema (tools.ts's `toolsAcceptNoTenantInput` is run over this list
 *     too), and the capability check happens twice: the list is filtered
 *     before the model sees it, and `confirmAskProposal` checks again.
 *
 * Registrations live in per-lane files under ./commands so a Cyrus action
 * is registered or excluded in a Cyrus file (WORK-SPLIT.md); this file only
 * assembles them. commands.coverage.test.ts asserts every exported action
 * in lib/actions is either a command's `action` or excluded with a reason,
 * because "written, documented, and never called" is a recurring shape
 * here and its opposite — reachable from a prompt without anyone deciding
 * — would be worse.
 */

export type CommandName =
  | "create_estimate_job"
  | "draft_estimate_lines"
  | "add_catalog_line"
  | "log_daily_field_report"
  | "record_material_delivery"
  | "send_equipment_to_job"
  | "bring_equipment_back"
  | "raise_rfi"
  | "add_punch_items"
  | "draft_invoice"
  | "log_payment"
  | "log_time_entry";

/** Risk tier. T5 (delete, void, contract, admin, outward send without a
 * composer) has no member on purpose: it cannot be registered. */
export type CommandTier = "T1_DRAFT" | "T2_MODIFY" | "T3_MONEY_EVIDENCE" | "T4_OUTWARD";

/** DIRECT: the tap executes. HANDOFF: the tap is a link to the page named
 * by `handoffHref`, which reads `?draft=<card>`, loads the server-held
 * payload (lib/ask/drafts.ts) and opens its existing form prefilled; that
 * form's own Server Action is the write, and the form tells the card it
 * saved (`settleAskDraft`). A command may be DIRECT only when its
 * `execute` calls a lifted core or an action that returns ActionResult —
 * production redacts thrown messages, and a card cannot show a sentence
 * that never arrives — so an action that throws is HANDOFF until its
 * owner converts it. commands.coverage.test.ts holds both halves. */
export type CommandMode = "DIRECT" | "HANDOFF";

export type Actor = { companyId: string; userId: string; principal: Principal };

export type CommandContext = Actor & {
  /** The person's calendar date, resolved on the server by viewerToday().
   * The only "today" a command may use. */
  today: string;
};

export type PreviewLine = { label: string; value: string };
export type Link = { label: string; href: string };
export type Option = { value: string; label: string; detail?: string };

/** What the model supplied, after unknown keys were dropped. Strings only:
 * a quantity arrives as the person's typed digits and stays a string until
 * deterministic code parses it. */
export type CommandInput = Record<string, string>;
/** What `execute` will use. JSON, server-held, never client-echoed. */
export type ResolvedPayload = Record<string, unknown>;

export type Resolution =
  /** Everything needed is known; show the card. `existing` means the
   * natural key already matches a row: the card links to it and offers no
   * button, and the proposal is recorded as refused. */
  | { kind: "ready"; resolved: ResolvedPayload; preview: PreviewLine[]; warnings: string[]; existing?: Link }
  /** A name matched several rows. The person picks from chips; the answer
   * comes back as `field: option.value` and `resolve` runs again with no
   * model pass. At least two options, always. */
  | { kind: "clarify"; field: string; question: string; options: Option[] }
  /** Something the person never said. Returned to the MODEL so it asks one
   * short question; nothing is recorded, because nothing was proposed. */
  | { kind: "need"; missing: string }
  /** A policy refusal (wrong stage, nothing matches, already drafted). The
   * model narrates it; the row is recorded REFUSED. */
  | { kind: "refuse"; reason: string; href?: string };

export type Executed =
  | { ok: true; message: string; created?: Link & { targetType: string; targetId: string } }
  | { ok: false; error: string };

type CommandBase = {
  name: CommandName;
  /** For the model: what it does AND does not do, and what it needs. */
  description: string;
  capability: Capability;
  /** Extra capabilities, all required. `create_estimate_job` needs
   * VIEW_JOB_COSTS as well, because the job page hides the estimate from
   * anyone without it and a job you cannot price is a dead end. */
  requiresAlso?: Capability[];
  tier: CommandTier;
  mode: CommandMode;
  /** The exported name in lib/actions/*.ts this stands in for. */
  action: string;
  /** The card's heading: "Create the job". */
  title: string;
  /** Status line while resolving: "Preparing the job". */
  verb: string;
  /** The card's primary button: "Create job". */
  button: string;
  /** `required` is ALWAYS empty: a missing field is a `need`, never a
   * schema error, so the person is asked in words. */
  input_schema: AskToolDefinition["input_schema"];
  /** Keys a chip answer may carry that the model may not — resolved ids
   * such as `contactId`. Anything else the browser sends is dropped. */
  continuationKeys?: string[];
  /** Reads only. Never writes. */
  resolve: (ctx: CommandContext, input: CommandInput) => Promise<Resolution>;
};

/** The tap executes. */
export type DirectCommandDefinition = CommandBase & {
  mode: "DIRECT";
  /** What `execute` calls: a lifted core in lib/estimating, or an
   * ActionResult-returning action called through commands/adapter.ts.
   * commands.coverage.test.ts checks the name is real. */
  core: string;
  /** Writes, through a core or an ActionResult action. Called only by
   * `confirmAskProposal` after the claim. */
  execute: (ctx: CommandContext, resolved: ResolvedPayload) => Promise<Executed>;
  handoffHref?: never;
};

/** The tap is a link; the page's own form is the write. */
export type HandoffCommandDefinition = CommandBase & {
  mode: "HANDOFF";
  /** Where the card's primary goes, given the card id. The page must be
   * the one `ROUTE_CAPABILITY` guards with this command's capability, and
   * it reads `?draft=` (lib/ask/drafts.ts). */
  handoffHref: (proposalId: string) => string;
  core?: never;
  execute?: never;
};

/** One or the other, never a command that both executes and links: the
 * confirm action refuses a HANDOFF card outright rather than reaching for
 * an execute it does not have. */
export type CommandDefinition = DirectCommandDefinition | HandoffCommandDefinition;

/** An exported action that is deliberately NOT a command. `action` is the
 * export name, or `module.*` for a whole file with one reason. */
export type Exclusion = { action: string; reason: string };

export const COMMANDS: CommandDefinition[] = [
  ...estimatingCommands,
  ...fieldCommands,
  ...equipmentCommands,
  ...rfiCommands,
  ...punchListCommands,
  ...billingCommands,
  ...laborCommands,
];

export const EXCLUSIONS: Exclusion[] = [
  ...estimatingExclusions,
  ...fieldExclusions,
  ...equipmentExclusions,
  ...rfiExclusions,
  ...punchListExclusions,
  ...billingExclusions,
  ...laborExclusions,
  ...notYetRegistered,
];

const BY_NAME = new Map<string, CommandDefinition>(COMMANDS.map((command) => [command.name, command]));

export function isCommandName(name: string): name is CommandName {
  return BY_NAME.has(name);
}

export function commandNamed(name: CommandName): CommandDefinition {
  const command = BY_NAME.get(name);
  if (!command) throw new Error(`No command called ${name}`);
  return command;
}

export function canRunCommand(principal: Principal, command: CommandDefinition): boolean {
  if (!can(principal, command.capability)) return false;
  return (command.requiresAlso ?? []).every((capability) => can(principal, capability));
}

/** The commands this person may be offered. Same rule as `toolsFor`: the
 * list the model sees is filtered, and the confirm action checks again. */
export function commandsFor(principal: Principal): CommandDefinition[] {
  return COMMANDS.filter((command) => canRunCommand(principal, command));
}

/** A command as the model sees it — indistinguishable from a read tool in
 * shape, which is the point: the model picks it the same way, and the
 * executor is where the two diverge. */
export function toToolDefinition(command: CommandDefinition): AskToolDefinition {
  return {
    name: command.name,
    description: command.description,
    input_schema: { ...command.input_schema, required: [] },
  };
}

/** The longest single value the model may supply. Exported because a
 * command that takes a LIST in one string (`add_punch_items`) is the one
 * place where hitting this ceiling is invisible rather than harmless: the
 * slice below would cut the last line in half, so that command warns on the
 * card when its value arrives at exactly this length. */
export const MAX_MODEL_VALUE = 1000;
const MAX_CONTINUATION_VALUE = 200;

/**
 * Keeps only what the schema (and, for a chip answer, the continuation
 * keys) allow, as trimmed strings. The model can put any key in a tool
 * call; this is where `contactId: "someone-else's"` from the model dies,
 * because the model's schema does not list it and only a chip may add it —
 * and `execute` re-asserts every id in-company regardless.
 */
export function schemaInput(
  command: CommandDefinition,
  raw: unknown,
  source: "model" | "continuation",
): CommandInput {
  const allowed = new Set(Object.keys(command.input_schema.properties));
  if (source === "continuation") {
    for (const key of command.continuationKeys ?? []) allowed.add(key);
  }
  const cap = source === "model" ? MAX_MODEL_VALUE : MAX_CONTINUATION_VALUE;
  const input: CommandInput = {};
  if (typeof raw !== "object" || raw === null) return input;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!allowed.has(key)) continue;
    if (typeof value === "string") {
      const trimmed = value.trim().slice(0, cap);
      if (trimmed) input[key] = trimmed;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      input[key] = String(value);
    }
  }
  return input;
}
