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
  { action: "proposals.*", reason: "Bid proposals are a scope + price + exclusions document built from a job's estimate; clauses are edited where the document is shown. Never a command." },
  { action: "wallTypes.*", reason: "Wall types are the company's partition schedule and a job's wall runs are measurements off the drawings; both are entered where the schedule and the runs are shown, and every run write regenerates estimate lines. Never a command." },
  { action: "quickbooks.*", reason: ADMIN },
  { action: "integrations.*", reason: ADMIN },
  // company.* was here. createContact became `add_contact`
  // (commands/contacts.ts), and the module's other actions are excluded
  // per action beside it.
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
  // Spreadsheet import. Owner-only bulk writes whose whole claim is that a
  // PERSON reads the preview — what will be created, what is already here,
  // which rows have problems — before anything is written. A command that
  // confirmed one would skip the only step the screen exists for.
  { action: "spreadsheetImport.*", reason: ADMIN + " Bulk import from a pasted file: the preview is the human judgement, so it is page only." },
  { action: "quickbooksImport.*", reason: ADMIN + " Importing customers, vendors and products from QuickBooks: a preview a person reads before confirming, so it is page only." },
  // Procore: linking is an OAuth-backed owner decision made against a live
  // project list, and the refresh is a button on the page it refreshes.
  { action: "procore.*", reason: ADMIN + " Linking a GC's Procore project to a job: picked from Procore's own live list, so it is page only." },
  { action: "procoreFeed.*", reason: "Refresh from Procore is a button on the page whose GC records it re-reads; nothing to resolve by name." },
  // ACC (Autodesk Construction Cloud): same shape as Procore's, same reason.
  { action: "acc.*", reason: ADMIN + " Linking a GC's ACC project to a job: picked from Autodesk's own live list, so it is page only." },
  { action: "accFeed.*", reason: "Refresh from ACC is a button on the page whose GC records it re-reads; nothing to resolve by name." },
  { action: "companycam.*", reason: ADMIN + " Linking a CompanyCam project to a job and importing its photos: picked from CompanyCam's own live list and pressed a batch at a time, so it is page only." },
  { action: "bluebeam.*", reason: ADMIN + " Linking a job to a new Bluebeam Studio Session, pushing a local PDF file, or connecting the account: an OAuth sign-in and a file picked from the caller's own computer, so it is page only." },
  { action: "calendarFeed.*", reason: "Creating or regenerating the caller's own calendar-subscription link — a credential, not work on a record, and there is nothing to resolve by name. Never a command." },
  { action: "jobber.*", reason: ADMIN + " Connecting to and importing from Jobber: an OAuth sign-in and a preview a person reads before confirming, so it is page only." },
  { action: "docusign.*", reason: ADMIN + " Sending a contract for signature through DocuSign, voiding one, or connecting the account: correspondence to a GC with a signer's name and email read on the page before it goes, and an OAuth sign-in, so it is page only." },
  { action: "mycoi.*", reason: ADMIN + " Importing certificates from a myCOI export: a pasted file and a preview a person reads before confirming, so it is page only." },
  // NOT ADMIN-prefixed, unlike the imports above: importPayrollRegister and
  // issuePayrollNumber are gated on MANAGE_COMPLIANCE, not owner. Still
  // page-only — a pasted register and a preview a person reads before
  // confirming, and the numbers on it land on a WH-347 signed under
  // penalty of perjury. Issuing a payroll number is a button on the page
  // whose sequence it advances; nothing to resolve by name.
  { action: "payrollRegister.*", reason: "A pasted payroll register and a preview a person reads before confirming; the deductions and net wages it writes land on a WH-347 signed under penalty of perjury, so it is page only." },
  { action: "sales.*", reason: "Prova-operator-only CRM, unreachable for any contractor tenant; excluded from the agent surface entirely." },
  { action: "alerts.*", reason: "Snooze and dismiss are done on the alert being read; nothing to resolve by name." },
  { action: "notifications.*", reason: "Sends the person their own digest; not a task anyone asks the box for." },
  { action: "gettingStarted.*", reason: "Hides the dashboard's getting-started card on this browser — a cookie about one card, not work anyone asks the box for. Never a command." },
  // Global search (lib/search). A read with its own box and its own
  // keyboard shortcut, not a fact Ask narrates — app_help already answers
  // "how do I find X" from the same walkthrough registry this reads for
  // its page half. Registering it as a command would let the model return
  // a company's own record titles and hrefs as an answer, second-guessing
  // capability filtering that already runs once, correctly, inside
  // globalSearch. Never a command.
  { action: "search.*", reason: "Its own box and shortcut, not a fact for Ask to narrate; app_help already answers 'how do I find X'. Never a command." },
  { action: "prevailingWage.*", reason: "Rule sets are compliance configuration edited on their own page; needs a File for determinations." },
  // The dates a prevailing-wage determination's standing is derived from
  // (lib/determination-standing.ts): the job's bid-advertisement date and
  // the document's issue/expiration dates and asterisk. Every one is read
  // off a document by a person, and a wrong one flips "in force" to "wrong
  // issue" on a GC-facing job — the exact date a model could plausibly
  // mis-supply on a confirm card. Reading the standing is the
  // `wage_determinations` tool; entering the dates is the Compliance tab.
  { action: "complianceFacts.*", reason: "Bid-advertisement, issue and expiration dates are read off documents by a person on the job's Compliance tab; a plausible wrong date from a card flips a determination's standing. Page only." },
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

  // The experience modification rate, per action rather than a wildcard,
  // because these are DECISIONS and not a placeholder: none of the three is
  // ever a command. The whole value of the figure is that a bureau issued it
  // and a person copied it off the worksheet. A command would put the number
  // in the MODEL'S hands — a model that, asked "what's our mod rate", has
  // every incentive to supply one — and a card the person confirms by reflex
  // is how an invented 0.85 reaches a GC's prequalification form.
  {
    action: "recordExperienceModRate",
    reason:
      "The rate is copied from the bureau's worksheet by a person. The model must never supply a rate number, so recording one is not a command — done on /compliance.",
  },
  {
    action: "updateExperienceModRate",
    reason:
      "Correcting a rate is the same act as recording one: the new figure has to come off the worksheet, not out of a model. Done on /compliance, beside the rate being changed.",
  },
  {
    action: "deleteExperienceModRate",
    reason: "Deletes are never commands (T5); owner-only on /compliance.",
  },

  // The employer burden percentage, for the same reason as the mod rate and
  // then some: one number here multiplies the labor inside every job's cost
  // to date, and therefore percent complete, earned revenue and the WIP
  // schedule a surety reads. It comes off an accountant's working, not out of
  // a model that — asked "what should our burden be" — has every incentive to
  // supply a plausible 20%. A card confirmed by reflex would restate every
  // job on the books.
  {
    action: "recordEmployerBurdenRate",
    reason:
      "The percentage comes from the company's accountant. The model must never supply one, so recording it is not a command — done on /settings, owner-only.",
  },
  {
    action: "updateEmployerBurdenRate",
    reason:
      "Correcting the percentage is the same act as recording it: the figure has to come off the accountant's working, not out of a model. Done on /settings, beside the rate being changed.",
  },
  {
    action: "deleteEmployerBurdenRate",
    reason:
      "Deletes are never commands (T5); owner-only on /settings, and removing a rate makes cost to date on already-costed jobs go DOWN.",
  },

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

  // Lien deadlines, per action, and NEVER commands — not a scope call. The
  // whole design rests on one rule: this app never computes a legal
  // deadline, every date is typed by a person from counsel or the statute.
  // A command would put a MODEL in the position of supplying that date, and
  // a plausible wrong one on a confirm card can cost lien rights. Reading
  // them is the `lien_deadlines` tool; writing them is the page.
  {
    action: "createLienDeadline",
    reason:
      "The deadline date is legal advice the app refuses to generate. A model proposing one — however it was worded — is the app computing a deadline by another route. Entered on /lien-deadlines by a person, from counsel or the statute. Never a command.",
  },
  {
    action: "updateLienDeadline",
    reason: "Changing a deadline date is the same judgement as setting one. Done on /lien-deadlines, where the row is visible. Never a command.",
  },
  {
    action: "markLienDeadlineServed",
    reason:
      "The served date is the date on the proof of service — evidence a person reads off a document, not something a model can know. Marked on /lien-deadlines. Never a command.",
  },
  {
    action: "clearLienDeadlineServed",
    reason: "Removes the fact that says a right was preserved; owner-only, one deliberate tap on the row. Never a command.",
  },
  { action: "deleteLienDeadline", reason: "T5: deletes are never commands." },
];
