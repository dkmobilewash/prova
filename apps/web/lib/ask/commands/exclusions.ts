import type { Exclusion } from "../commands";

/**
 * Whole modules not yet registered, one reason each.
 *
 * A wildcard here is a placeholder with an expiry, not a decision about
 * every action in the file: when a lane registers its first command from a
 * module, it deletes that module's wildcard and lists the rest per action,
 * in its own file under ./commands. Phase 2 (Cyrus's lane) replaced the
 * field, equipment, RFI and punch list lines — field and equipment in
 * phase 2a as DIRECT over Cyrus's ActionResult actions (commands/field.ts,
 * commands/equipment.ts), RFIs and punch items in phase 2b as HANDOFF over
 * his throwing ones (commands/rfis.ts, commands/punchLists.ts). Phase 3
 * (Diego's lane) replaced billing and labor once the invoice counter
 * (#224) and the #102 guards (#213) existed — commands/billing.ts and
 * commands/labor.ts. Phase 4a replaced messages as HANDOFF into the
 * /messages composer, the first T4 command (commands/messages.ts). Phase
 * 4b registered reschedule_job, the first T2 that rewrites a row to values
 * the person stated, DIRECT over a lifted core (commands/schedule.ts) —
 * it replaced a per-action line in
 * commands/estimating.ts rather than a wildcard here, since jobs.ts had
 * commands already. Phase 4c did the same for createBidInvitation
 * (commands/bids.ts), once the contact resolver and the date parser the
 * per-action line had been waiting for both existed. Phase 4d did it for
 * createRetainageRelease (commands/retainage.ts), the per-action line in
 * commands/billing.ts that had been waiting for "a card that can show the
 * balance it draws down" — phase 3's money cards were that card.
 *
 * commands.coverage.test.ts fails the moment a new module appears with no
 * line here and no registration — so adding an action file is a decision
 * somebody makes, not something that happens.
 */
const CYRUS = "Cyrus's lane (WORK-SPLIT.md); registered per action from his own file under lib/ask/commands in phase 2.";
const MONEY = "Money or evidence tier (T3): registered per action from its own file under lib/ask/commands once its guards return sentences rather than throwing.";
const ADMIN = "Owner administration (T5): a permission or connection an assistant could widen is not a permission. Never a command.";

export const notYetRegistered: Exclusion[] = [
  // The tap itself. confirmAskProposal and cancelAskProposal EXECUTE a
  // card; a command that proposed confirming a card would be the model
  // confirming its own proposal, which is the one thing this design exists
  // to make impossible.
  { action: "ask.*", reason: "The confirm and cancel actions are the write path a card resolves to, and the connection check is a diagnostic button on the settings page; never a command." },

  // Asking a human. The box answering "ask us for help" by mailing us a
  // question it wrote is the model deciding what the person needed help
  // with — and if it knew that, they would not be asking. The panel is one
  // click away on every page and the words have to be theirs.
  { action: "help.*", reason: "Reaching a person is the one thing the assistant must not do on their behalf: the question has to be in their words, and a model-composed one arrives claiming to be. Never a command." },

  // Diego's lane, later phases.
  { action: "changeOrders.*", reason: "Change orders move contract value a sent pay application may depend on (T5 decisions, T3 drafts); a later phase." },
  { action: "backcharges.*", reason: MONEY },
  { action: "closeoutSubmissions.*", reason: "Counter-numbered closeout packages go to a GC; phase 3 once retries are safe." },
  { action: "quickbooks.*", reason: ADMIN },
  { action: "integrations.*", reason: ADMIN },
  { action: "company.*", reason: ADMIN + " Contact creation is reached through create_estimate_job's resolve-or-create instead." },
  { action: "permissions.*", reason: ADMIN },
  { action: "jobMedia.*", reason: "Site photos: recording one needs a real File in the blob store, and tags and deletes are edits made on the photo being looked at. Never a command." },
  // Document intake. Recording needs a real File already in the blob store,
  // the same reason jobMedia is excluded above — but the confirm is the one
  // worth spelling out, because it is the action that LOOKS most like a
  // command and must never be one. /intake's entire claim is that a PERSON
  // decides what each document is, with the machine's reasoning in front of
  // them and the uncertain rows at the top. An agent confirming those rows
  // is the machine agreeing with itself, which is precisely the failure the
  // screen was built to prevent.
  { action: "intake.*", reason: "Recording needs a real File in the blob store, and confirming a proposal is the human judgement the whole screen exists for — never a command." },
  { action: "compliance.*", reason: "Compliance documents need a real File and are evidence records; page only until a hand-off mode exists." },
  { action: "crm.*", reason: "Contact people and interactions: a natural T1 command, unassigned in WORK-SPLIT.md (open question in the plan)." },
  { action: "sales.*", reason: "Prova-operator-only CRM, unreachable for any contractor tenant; excluded from the agent surface entirely." },
  { action: "alerts.*", reason: "Snooze and dismiss are done on the alert being read; nothing to resolve by name." },
  { action: "notifications.*", reason: "Sends the person their own digest; not a task anyone asks the box for." },
  { action: "gettingStarted.*", reason: "Hides the dashboard's getting-started card on this browser — a cookie about one card, not work anyone asks the box for. Never a command." },
  { action: "prevailingWage.*", reason: "Rule sets are compliance configuration edited on their own page; needs a File for determinations." },
  { action: "apprenticeship.*", reason: "Enrollment and period sign-off are evidence with sign-off dates; page only for now." },
  { action: "unionCompliance.*", reason: "Craft, local and rate configuration; several writes are global reference data. Never a command." },
  // Phase codes. A company's cost-coding vocabulary is the thing every
  // cost report is grouped BY, so a model inventing or renaming one
  // silently re-labels history on jobs that are already invoiced — and
  // `@@unique([companyId, code])` means an invented code can also collide
  // with a real one. Retiring is the same shape from the other side: it
  // takes a code off every future picker. All three are owner-only edits
  // to reference data, made on the page that shows the list they change.
  { action: "phase-codes.*", reason: "The vocabulary every cost report is grouped by: inventing, renaming or retiring a code re-labels history on invoiced jobs. Owner-only reference data, edited on the settings page that shows the whole list. Never a command." },

  // Cyrus's lane, phase 2.
  { action: "vendors.*", reason: CYRUS },
  { action: "vendorPricing.*", reason: CYRUS },
  { action: "equipment.*", reason: CYRUS },
  { action: "safety.*", reason: CYRUS },
  { action: "submittals.*", reason: CYRUS },
  { action: "drawings.*", reason: CYRUS },
  { action: "closeout.*", reason: CYRUS },
  { action: "certifications.*", reason: CYRUS },

  // Correcting or removing a job's own identity. Deliberately NOT commands,
  // and the reason is the same for both: they are the two writes on this
  // page a person should have to look at while making. A rename reaches
  // every pay application and certified payroll that names the job, and a
  // removal is the one irreversible act in the product — neither is
  // something to confirm from a chat card where the thing being changed is
  // out of sight. Both refuse in a sentence, both are owner-gated where it
  // matters, and both live on the job they act on.
  {
    action: "updateJobDetails",
    reason:
      "A rename reaches every document that names the job. Done on the job, where the person can see what they are renaming.",
  },
  {
    action: "deleteEstimateJob",
    reason:
      "The only irreversible act in the product. Owner-only, estimate-only, and never from a card that could be confirmed by reflex.",
  },
];
