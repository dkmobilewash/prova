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
 * his throwing ones (commands/rfis.ts, commands/punchLists.ts); phase 3
 * (Diego's lane) replaces billing and labor once the invoice counter and
 * the #102 natural keys exist.
 *
 * commands.coverage.test.ts fails the moment a new module appears with no
 * line here and no registration — so adding an action file is a decision
 * somebody makes, not something that happens.
 */
const CYRUS = "Cyrus's lane (WORK-SPLIT.md); registered per action from his own file under lib/ask/commands in phase 2.";
const MONEY = "Money or evidence tier (T3): waits for the invoice counter and the #102 natural keys, phase 3 in Diego's lane.";
const ADMIN = "Owner administration (T5): a permission or connection an assistant could widen is not a permission. Never a command.";

export const notYetRegistered: Exclusion[] = [
  // The tap itself. confirmAskProposal and cancelAskProposal EXECUTE a
  // card; a command that proposed confirming a card would be the model
  // confirming its own proposal, which is the one thing this design exists
  // to make impossible.
  { action: "ask.*", reason: "The confirm and cancel actions are the write path a card resolves to; never a command." },

  // Diego's lane, later phases.
  { action: "billing.*", reason: MONEY },
  { action: "labor.*", reason: MONEY },
  { action: "changeOrders.*", reason: "Change orders move contract value a sent pay application may depend on (T5 decisions, T3 drafts); not before phase 3." },
  { action: "backcharges.*", reason: MONEY },
  { action: "closeoutSubmissions.*", reason: "Counter-numbered closeout packages go to a GC; phase 3 once retries are safe." },
  { action: "quickbooks.*", reason: ADMIN },
  { action: "integrations.*", reason: ADMIN },
  { action: "company.*", reason: ADMIN + " Contact creation is reached through create_estimate_job's resolve-or-create instead." },
  { action: "permissions.*", reason: ADMIN },
  { action: "jobMedia.*", reason: "Site photos: recording one needs a real File in the blob store, and tags and deletes are edits made on the photo being looked at. Never a command." },
  { action: "compliance.*", reason: "Compliance documents need a real File and are evidence records; page only until a hand-off mode exists." },
  { action: "crm.*", reason: "Contact people and interactions: a natural T1 command, unassigned in WORK-SPLIT.md (open question in the plan)." },
  { action: "sales.*", reason: "Prova-operator-only CRM, unreachable for any contractor tenant; excluded from the agent surface entirely." },
  { action: "alerts.*", reason: "Snooze and dismiss are done on the alert being read; nothing to resolve by name." },
  { action: "notifications.*", reason: "Sends the person their own digest; not a task anyone asks the box for." },
  { action: "messages.*", reason: "Outward email (T4): hand-off into the /messages composer in phase 4, never DIRECT." },
  { action: "prevailingWage.*", reason: "Rule sets are compliance configuration edited on their own page; needs a File for determinations." },
  { action: "apprenticeship.*", reason: "Enrollment and period sign-off are evidence with sign-off dates; page only for now." },
  { action: "unionCompliance.*", reason: "Craft, local and rate configuration; several writes are global reference data. Never a command." },

  // Cyrus's lane, phase 2.
  { action: "vendors.*", reason: CYRUS },
  { action: "vendorPricing.*", reason: CYRUS },
  { action: "equipment.*", reason: CYRUS },
  { action: "safety.*", reason: CYRUS },
  { action: "submittals.*", reason: CYRUS },
  { action: "drawings.*", reason: CYRUS },
  { action: "closeout.*", reason: CYRUS },
  { action: "certifications.*", reason: CYRUS },
];
