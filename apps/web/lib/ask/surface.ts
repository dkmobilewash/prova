import type { Principal } from "@/lib/permissions";
import { commandsFor, type CommandDefinition, type CommandName } from "./commands";

/**
 * WHERE A QUESTION WAS ASKED FROM — and the one thing that changes because of
 * it: which commands the model is offered.
 *
 * Ask is mounted in the CRM (the launcher, /ask, /ai, the dashboard) and, since
 * the Bid job screen's box was wired, inside C Stream Bid. Bid has a rule the
 * CRM does not: NOTHING IT DRAWS MAY TAKE A PERSON INTO THE CRM
 * (`lib/bid/bidLinkCensus.test.ts`, founder's call 2026-10-25). Most commands
 * end in a card whose confirm writes in place — but plenty of them write a CRM
 * record (an invoice, a time entry, a field report), and two of them are
 * HANDOFF cards whose whole button is a link to `/messages` or `/rfis`. Offered
 * from Bid, those are doors the census cannot see, because the href is built on
 * the server at runtime.
 *
 * So the surface NARROWS the list, and it can only ever narrow it:
 *
 *   - `askSurfaceOf` accepts exactly one word, `"bid"`. Anything else a caller
 *     sends — a typo, an object, `"crm"`, `"admin"` — is `undefined`, which is
 *     byte-identical to sending nothing: the CRM's list, unchanged.
 *   - `commandsForSurface` starts from `commandsFor(principal)` (the capability
 *     filter) and FILTERS it. There is no branch that adds a command, so no
 *     value of `surface` can offer something the person's capabilities did not
 *     already allow. `surface.test.ts` holds both halves.
 *   - the same predicate is applied again where a command is EXECUTED from a
 *     model's tool call or a chip answer (`commandAllowedOn`, in
 *     lib/ask/answer.ts), so a model that invents a name it was not offered is
 *     refused there too — the same belt-and-braces `canRunCommand` already
 *     gets.
 *
 * A surface is a HINT about where the person is standing, exactly like
 * `pagePath`. It cannot widen access, which is what makes it safe to read from
 * a request body.
 */

export type AskSurface = "bid";

/** The one word this route understands, or nothing. */
export function askSurfaceOf(value: unknown): AskSurface | undefined {
  return value === "bid" ? "bid" : undefined;
}

/**
 * THE COMMANDS THE BID JOB BOX MAY OFFER. An allowlist, not a denylist, for
 * the reason `lib/bid/surface.ts` gives about its own segments: a new command
 * added anywhere in the app should NOT appear in Bid until somebody decides it
 * belongs there, and an allowlist drifts in that safe direction.
 *
 * Each member writes IN PLACE on the estimate the person is looking at, from a
 * DIRECT card whose confirm runs a lifted core and links nowhere Bid draws (the
 * card's "created" link is a CRM path and the Bid box renders it as plain
 * text — see `components/bid/guide/JobGuideAskBox.tsx`):
 *
 *   - `draft_estimate_lines`: drafts lines from the job's scope, each flagged
 *     for review. Estimate-stage jobs only.
 *   - `add_catalog_line`: one line from the company's own catalog, at the
 *     catalog's price. Estimate-stage jobs only.
 *
 *   - `adjust_estimate`: one lump-sum line for a percent or flat adder ("add
 *     10% for night work"), the amount computed in code from the bid as it
 *     stands. Estimate-stage jobs only; refuses if the bid moved since the card.
 *
 * Everything else is in `BID_EXCLUDED_COMMANDS` below with its reason, and
 * `surface.test.ts` requires every registered command to be in exactly one of
 * the two — so a new command cannot reach Bid, or sit unexamined, without
 * somebody choosing.
 */
export const BID_ASK_COMMANDS: readonly CommandName[] = [
  "draft_estimate_lines",
  "add_catalog_line",
  "adjust_estimate",
];

/** Every other command, and why the Bid box does not offer it. */
export const BID_EXCLUDED_COMMANDS: Readonly<Partial<Record<CommandName, string>>> = {
  create_estimate_job:
    "Makes a DIFFERENT job, not this one, and its card's 'already exists' and 'created' links are /jobs/<id>. Starting a bid has its own screen in Bid (/bid/estimates/new).",
  log_daily_field_report: "A field record on a job in progress — the CRM's world, not the pre-award chain Bid covers.",
  record_material_delivery: "A field record on a job in progress; Bid covers the pre-award chain only.",
  send_equipment_to_job: "Equipment logistics on a job in progress; not part of Bid.",
  bring_equipment_back: "Equipment logistics on a job in progress; not part of Bid.",
  raise_rfi: "A HANDOFF card: its button is a link to /rfis, a CRM page.",
  add_punch_items: "Punch lists happen after award; not part of Bid.",
  draft_invoice: "Billing a contracted job; not part of Bid.",
  log_payment: "Money received on a contracted job; not part of Bid.",
  release_retainage: "Retainage on a contracted job; not part of Bid.",
  log_time_entry: "Payroll time on a job in progress; not part of Bid.",
  send_email: "A HANDOFF card: its button is a link to /messages, a CRM page.",
  ask_who_would_know: "A HANDOFF card: its button is a link to /messages, a CRM page.",
  reschedule_job: "Moves a job's schedule dates; its refusals and 'created' link point at /jobs/<id>, and scheduling is post-award.",
  log_bid_invitation: "Writes to the bid log — a different record from the estimate on screen — and its links are /bids and /contacts.",
  record_bid_outcome: "Marks a bid won or lost, which moves the job out of the estimate stage and into the CRM; its links are /bids.",
  add_bid_pursuit: "The pre-bid pursuit list lives on /pipeline, a CRM page, and is not about this job.",
  set_pursuit_stage: "The pre-bid pursuit list lives on /pipeline, a CRM page, and is not about this job.",
  schedule_crew: "Crew scheduling is post-award; not part of Bid.",
  add_contact: "Contacts live on /contacts, a CRM page; its 'created' link goes there.",
  find_bid_leads: "Lead search for NEW projects, filed to /pipeline — not about this job, and its links are CRM pages.",
};

/** May this command run on this surface? `undefined` is the CRM: everything. */
export function commandAllowedOn(surface: AskSurface | undefined, name: CommandName): boolean {
  if (!surface) return true;
  return BID_ASK_COMMANDS.includes(name);
}

/**
 * The commands this person may be offered HERE. Always a subset of
 * `commandsFor(principal)` — the filter below is the only thing applied to it.
 */
export function commandsForSurface(principal: Principal, surface: AskSurface | undefined): CommandDefinition[] {
  return commandsFor(principal).filter((command) => commandAllowedOn(surface, command.name));
}

/**
 * Said to the model when the question comes from the Bid job box, beside the
 * page sentence. Bid draws no link into the CRM, and the model is the one
 * thing on the page that could still NAME one ("go to /jobs/… and…"). The
 * answer renders as plain text, so a path would not be a link — but it would be
 * an instruction to go somewhere this product does not have.
 */
export const BID_SURFACE_RULE =
  "The person is asking from C Stream Bid, the estimating product, on this job's estimate screen. " +
  "Answer about this job's bid. Do not tell them to open other pages, and never write a URL or a path such as /jobs/… — " +
  "this product has no such pages. If something can only be done elsewhere, say what it is in plain words.";
