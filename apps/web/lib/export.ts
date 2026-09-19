/**
 * Taking your data out.
 *
 * WHY THIS EXISTS AS A FEATURE RATHER THAN A SUPPORT TICKET
 *
 * The competitor research found the same complaint at four separate
 * vendors: no clean way to get your history out when you leave. One
 * platform put a 50% price rise in front of the door and then locked the
 * account. That is a deliberate retention mechanism, not an oversight, and
 * it is the cheapest thing on the whole list to be better at.
 *
 * It is also the same principle the rest of this codebase already runs on,
 * pointed at the customer instead of the screen: say what is true, say
 * what you do not know, and do not make the number up. An export that
 * quietly omits a table is the same defect as a costing row that quietly
 * omits a cost.
 *
 * THE COLUMN LISTS ARE AN ALLOWLIST, AND THAT IS THE SECURITY OF IT.
 *
 * A denylist of "fields not to export" is correct exactly until somebody
 * adds a column. Then it leaks, silently, with every check green — which is
 * the failure shape this project has met over and over. An allowlist fails
 * the other way: a new column is simply absent until a person adds it here,
 * and absence is visible while a leak is not.
 *
 * There are six credential-bearing columns in this schema right now and two
 * of them are PLAINTEXT (`QuickBooksConnection.accessToken` and
 * `.refreshToken` — sandbox-appropriate and documented as such, but real
 * strings). `Contact.portalToken` and `SignatureRequest.token` are live
 * bearer tokens: whoever holds one can open a client portal or sign a
 * contract. None of them appears below, and `export.test.ts` reads the
 * .prisma files and FAILS if any field matching a credential pattern ever
 * turns up in a column list here. That test is the actual guard; this
 * comment is just why.
 */

/** One exportable table: what it is called, what comes out, and how it is
 * narrowed to a single company. */
export type ExportDataset = {
  /** URL-safe key. Also the CSV filename. */
  key: string;
  /** Prisma delegate name on the client. */
  model: string;
  label: string;
  /** Said in the UI, so nobody has to infer coverage from a filename. */
  note: string;
  columns: string[];
  /**
   * The `where` that scopes rows to one company.
   *
   * Some models carry `companyId`; others only reach it through a relation
   * (a Payment belongs to an Invoice belongs to a Job). Written per dataset
   * rather than assumed, because assuming would silently export every
   * company's rows for the models that do not carry the column — the worst
   * possible bug in a feature whose entire job is handing over data.
   */
  scope: (companyId: string) => Record<string, unknown>;
};

const byCompany = (companyId: string) => ({ companyId });
const byJob = (companyId: string) => ({ job: { companyId } });

export const EXPORT_DATASETS: ExportDataset[] = [
  {
    key: "jobs",
    model: "job",
    label: "Jobs",
    note: "Every job, at every stage, including completed ones.",
    columns: [
      "id", "contactId", "name", "scope", "status", "startDate", "endDate",
      "operatingLocationId", "retainagePercent", "substantialCompletionDate",
      "createdAt", "updatedAt",
    ],
    scope: byCompany,
  },
  {
    key: "job-line-items",
    model: "jobLineItem",
    label: "Job line items",
    note:
      "The scope lines every estimate, budget, invoice and cost entry hangs off. " +
      "Includes lines marked deleted — isDeleted tells you which, and dropping them " +
      "here would erase the history that made a number what it is.",
    columns: [
      "id", "jobId", "description", "quantity", "unit", "laborHours",
      "craftClassificationId", "unitPrice", "sortOrder", "budgetedUnitCost",
      "currentEstimatedUnitCost", "estimatedCostToComplete", "isDeleted",
      "aiDrafted", "sourceCatalogEntryId", "originChangeOrderId",
      "createdAt", "updatedAt",
    ],
    scope: byJob,
  },
  {
    key: "estimate-versions",
    model: "estimateVersion",
    label: "Estimate versions",
    note: "Saved snapshots of the line items at a point in time. The snapshot column is JSON.",
    columns: ["id", "jobId", "versionNumber", "note", "snapshot", "createdByUserId", "createdAt"],
    scope: byJob,
  },
  {
    key: "change-orders",
    model: "changeOrder",
    label: "Change orders",
    note: "Numbers come from a counter that only increments, so a gap means one was deleted.",
    columns: [
      "id", "jobId", "number", "title", "description", "status", "submittedOn",
      "decidedOn", "decisionNotes", "appliedAt", "reopenedAt", "reopenNote",
      "supersedesId", "createdAt",
    ],
    scope: byJob,
  },
  {
    key: "invoices",
    model: "invoice",
    label: "Invoices / pay applications",
    columns: ["id", "jobId", "number", "description", "amount", "issuedAt", "dueAt", "retainageWithheld"],
    note: "retainageWithheld is what was held on that application, not a running balance.",
    scope: byJob,
  },
  {
    key: "invoice-line-items",
    model: "invoiceLineItem",
    label: "Invoice line items",
    note: "Joins an invoice to the job line item it billed against.",
    columns: ["id", "invoiceId", "lineItemId", "thisPeriodBilled", "materialsStoredValue"],
    scope: (companyId) => ({ invoice: { job: { companyId } } }),
  },
  {
    key: "payments",
    model: "payment",
    label: "Payments received",
    columns: ["id", "invoiceId", "amount", "method", "receivedAt", "note"],
    note: "What the GC actually paid, against which invoice.",
    scope: (companyId) => ({ invoice: { job: { companyId } } }),
  },
  {
    key: "cost-entries",
    model: "costEntry",
    label: "Costs",
    note: "Actual cost booked against a scope line. This is the actuals side of job costing.",
    columns: ["id", "lineItemId", "description", "amount", "incurredAt", "createdAt"],
    scope: (companyId) => ({ lineItem: { job: { companyId } } }),
  },
  {
    key: "time-entries",
    model: "timeEntry",
    label: "Labour hours",
    note:
      "Hours by employee, job and craft — the source certified payroll is built from. " +
      "Money is not on this row; rates live on the fringe and wage tables.",
    columns: [
      "id", "jobId", "lineItemId", "employeeUserId", "craftClassificationId",
      "date", "hours", "payType", "perDiemAmount", "travelPayAmount", "note", "createdAt",
    ],
    scope: byJob,
  },
  {
    // Missed when the crew schedule shipped (#304): a table of the company's
    // own planning, in no dataset and on no omission line — so the export
    // left it out without saying so. exportCompletenessCensus.test.ts now
    // fails the build on the next model that does that.
    key: "crew-schedule",
    model: "crewScheduleDay",
    label: "Crew schedule",
    note:
      "Who was planned on which job, which day. A plan, not a record of work — hours are " +
      "in the labour file. Crew members without a login appear by id only, since crew " +
      "records are not exported.",
    columns: [
      "id", "jobId", "workDate", "scheduledUserId", "crewMemberId",
      "craftClassificationId", "note", "createdByUserId", "createdAt", "updatedAt",
    ],
    scope: byCompany,
  },
  {
    key: "material-orders",
    model: "materialOrder",
    label: "Material orders",
    note: "lineItemId is attribution only — no money is summed through it, by agreement.",
    columns: [
      "id", "jobId", "number", "vendorId", "lineItemId", "description",
      "vendorReference", "notes", "orderedOn", "promisedFor", "orderedByUserId",
      "createdAt", "updatedAt",
    ],
    scope: byCompany,
  },
  {
    key: "contacts",
    model: "contact",
    label: "Contacts (GCs and clients)",
    note:
      "The client-portal token is deliberately NOT included — it is a live key to " +
      "that contact's portal, and a copy in a spreadsheet is a copy that leaks.",
    columns: [
      "id", "name", "email", "phone", "address", "defaultRetainagePercent",
      "paymentTermsDays", "standardFormsUsed", "createdAt", "updatedAt",
    ],
    scope: byCompany,
  },
  {
    key: "vendors",
    model: "vendor",
    label: "Vendors",
    columns: ["id", "name", "tradeScope", "contactName", "phone", "email", "notes", "createdAt", "updatedAt"],
    note: "Suppliers and the trades they cover.",
    scope: byCompany,
  },
  {
    key: "catalog",
    model: "lineItemCatalogEntry",
    label: "Price book",
    note: "Your own catalog of standard line items and their default rates.",
    columns: [
      "id", "description", "unit", "tradeScope", "defaultUnitPrice",
      "defaultBudgetedUnitCost", "defaultLaborHours", "craftClassificationId",
      "createdAt", "updatedAt",
    ],
    scope: byCompany,
  },
  {
    key: "rfis",
    model: "rfi",
    label: "RFIs",
    columns: [
      "id", "jobId", "number", "subject", "question", "drawingReference",
      "specSection", "status", "sentOn", "dueBy", "answeredOn", "answer",
      "costImpact", "scheduleImpact", "askedByUserId", "createdAt", "updatedAt",
    ],
    note: "Including the answer, which is the half that matters in a dispute.",
    scope: byCompany,
  },
  {
    key: "submittals",
    model: "submittal",
    label: "Submittals",
    note: "Revisions are their own records and are not flattened into this one.",
    columns: [
      "id", "jobId", "number", "title", "description", "specSection",
      "drawingReference", "lastRevision", "submittedByUserId", "createdAt", "updatedAt",
    ],
    scope: byCompany,
  },
  {
    key: "safety-incidents",
    model: "safetyIncident",
    label: "Safety incidents",
    note:
      "OSHA case records, including employee names. Handle the file accordingly — " +
      "this is the most sensitive export here and it is included because it is yours.",
    columns: [
      "id", "jobId", "caseNumber", "caseYear", "occurredAt", "employeeName",
      "jobTitle", "location", "description", "classification", "outcome",
      "daysAway", "daysRestricted", "reportedByUserId", "createdAt", "updatedAt",
    ],
    scope: byCompany,
  },
  {
    key: "punch-list-items",
    model: "punchListItem",
    label: "Punch list",
    columns: ["id", "jobId", "description", "raisedByUserId", "isDone", "completedAt", "createdAt", "updatedAt"],
    note: "Open and closed.",
    scope: byCompany,
  },
  {
    key: "field-reports",
    model: "dailyFieldReport",
    label: "Daily field reports",
    note: "Work performed, other trades on site, site conditions, the automatic weather, and older reports' typed delays — the daily record a delay claim rests on.",
    columns: [
      "id", "jobId", "reportDate", "crewPresent", "workPerformed", "weather",
      "weatherAuto", "delays", "filedByUserId", "createdAt", "updatedAt",
    ],
    scope: byCompany,
  },
  {
    key: "delays",
    model: "delayEvent",
    label: "Delays",
    note: "Each delay logged on a job: cause, who caused it, times, workers and crew-hours lost, and who at the GC was told, how and when.",
    columns: [
      "id", "jobId", "date", "cause", "responsibleParty", "responsibleName", "startMinute", "endMinute",
      "workersAffected", "hoursLost", "description", "gcNotifiedHow", "gcNotifiedWho", "gcNotifiedAt",
      "changeOrderId", "loggedByUserId", "createdAt", "updatedAt",
    ],
    scope: byCompany,
  },
];

export function datasetByKey(key: string): ExportDataset | undefined {
  return EXPORT_DATASETS.find((d) => d.key === key);
}

/* ------------------------------------------- what the export does NOT hold
 *
 * THE PAGE USED TO CALL THIS "EVERYTHING", AND IT NEVER WAS.
 *
 * `/settings/export` said "Everything <company> has put into C Stream" over
 * a button reading "Download everything", and named exactly three
 * omissions: integration credentials, portal and signing links, and
 * uploaded files. The list above is 18 tables. The schema is 93 models.
 * Some of that gap is bookkeeping nobody wants — eight sequence counters,
 * sync logs, notification rows — but a lot of it is work somebody did: the
 * licences and bonds a GC asks for, retainage releases, backcharges, the
 * wage and fringe tables certified payroll is built from, photos, drawings,
 * the sales pipeline, closeout and warranty.
 *
 * One of the three omissions was also simply false. "Documents appear as
 * their metadata rows here" — they do not; `ComplianceDocument`,
 * `ContractDocument`, `DrawingRevision`, `DocumentIntake` and `JobMedia`
 * are not in any dataset above, so neither the file nor the row that points
 * at it comes out.
 *
 * This is the same defect as the one the module comment at the top of this
 * file is about, pointed at the customer: an export that quietly omits a
 * table is the same defect as a costing row that quietly omits a cost. It
 * was not caught because nothing could catch it — no test compared the copy
 * to the registry, and the copy had no number in it to be wrong.
 *
 * THE FIX IS COPY, NOT COVERAGE. Adding these datasets is a much larger
 * piece of work and some of the omissions are deliberate (see
 * `EXPORT_WITHHELD`). What changes here is that the page stops claiming
 * them. The lists below are the page's source of truth for that claim, and
 * `export.test.ts` holds them to the schema: every model named here has to
 * exist and has to be genuinely absent from `EXPORT_DATASETS`, so the day
 * one of these categories IS exported, this file fails rather than
 * under-promising forever.
 */

/** A category of record the export does not reach. */
export type ExportOmission = {
  key: string;
  title: string;
  detail: string;
  /**
   * The schema models this line accounts for. Named rather than described
   * so the claim is checkable: the test insists each one exists and that
   * none of them is exported by a dataset above.
   */
  models: string[];
};

/** A secret that will never be exported, whatever else is added. */
export type ExportWithheld = {
  key: string;
  title: string;
  detail: string;
  /**
   * The credential COLUMNS this line is about — these are fields on models
   * that are otherwise exported or partly exported, not tables of their
   * own, which is why this list is columns where `ExportOmission` is
   * models. The test holds each one to the same credential pattern that
   * guards the dataset column lists.
   */
  columns: string[];
};

/**
 * Deliberately withheld, and it stays withheld even if every table below
 * is eventually exported. These are live keys, not records of work.
 */
export const EXPORT_WITHHELD: ExportWithheld[] = [
  {
    key: "integration-credentials",
    title: "Integration credentials",
    detail:
      "QuickBooks and other connection tokens. They are keys to another system, not a " +
      "record of your work, and a copy in a downloaded file is a copy that can leak.",
    columns: ["accessToken", "refreshToken", "encryptedAccessToken", "encryptedRefreshToken"],
  },
  {
    key: "portal-and-signing-links",
    title: "Client portal and signing links",
    detail:
      "Same reason — anyone holding one can open a client portal or sign a contract. The " +
      "Contacts file below is complete apart from this one column.",
    columns: ["portalToken", "token"],
  },
];

/**
 * Real records a person would look for in the file and not find. Ordered
 * roughly by how likely somebody is to go looking.
 */
export const EXPORT_OMISSIONS: ExportOmission[] = [
  {
    key: "compliance",
    title: "Licences, bonds, insurance and compliance documents",
    detail:
      "Contractor licences, bonds, insurance policies, experience modification rates, " +
      "worker certifications and the documents filed against them. The expiry dates and " +
      "mod rates a GC asks for are in the app; they are not in this file.",
    models: [
      // Review finding on #306: the table shipped and the export neither
      // carried it nor said so -- the exact defect this list exists for.
      "ExperienceModRate",
      "CompanyLicense",
      "CompanyBond",
      "CompanyInsurancePolicy",
      "ComplianceDocument",
      "WorkerCertification",
      "CertificationRequirement",
    ],
  },
  {
    key: "retainage-and-backcharges",
    title: "Retainage releases and backcharges",
    detail:
      "Invoices carry what was withheld on each application. The release records saying " +
      "when held money was billed back, and backcharges a GC passed down, are separate " +
      "rows and are not exported.",
    models: ["RetainageRelease", "Backcharge"],
  },
  {
    key: "payroll-rates",
    title: "Pay rates, crews, classifications and union agreements",
    detail:
      "Hours are exported; what they are worth is not. Craft classifications, fringe " +
      "schedules, prevailing wage determinations, union agreements, crew records, who works " +
      "under which craft, and apprenticeship enrolments all stay behind — which means the hours file cannot be " +
      "repriced somewhere else on its own, and the classification ids in it will not " +
      "resolve to names.",
    models: [
      "CrewMember",
      "CraftClassification",
      "FringeRateSchedule",
      "PrevailingWageDetermination",
      "PrevailingWageRuleSet",
      "CompanyUnionAgreement",
      "UnionLocal",
      "ApprenticeshipEnrollment",
      // Found by exportCompletenessCensus.test.ts: the sign-offs for each
      // indenture period, in no dataset and on no line.
      "ApprenticeshipPeriodRecord",
      "ApprenticeRatioRule",
      "DispatchSlip",
      // Which crafts each person can be logged under -- setup for the
      // phone's craft picker, not a record of work done.
      "WorkerCraft",
    ],
  },
  {
    key: "files-and-documents",
    title: "Photos, videos, drawings and contract documents",
    detail:
      "The uploaded files themselves are not something a CSV or a JSON file can hold — " +
      "they stay in storage. Neither are the rows that index them: job photos and their " +
      "annotations, drawing sets and revisions, contract documents, signature requests, " +
      "envelopes sent through DocuSign and anything filed through document intake.",
    models: [
      "JobMedia",
      "JobMediaAnnotation",
      "JobMediaTag",
      "JobMediaTagAssignment",
      "DrawingSet",
      "DrawingRevision",
      "ContractDocument",
      "SignatureRequest",
      "DocuSignEnvelope",
      "DocumentIntake",
    ],
  },
  {
    key: "revisions-and-deliveries",
    title: "Submittal revisions, deliveries and change order proposals",
    detail:
      "The submittals file names its current revision number but not the revision " +
      "records themselves. Deliveries booked against a material order, and the proposal " +
      "and line-item-edit trail behind a change order, are also their own rows.",
    models: [
      "SubmittalRevision",
      "MaterialOrderDelivery",
      "ChangeOrderProposal",
      "ChangeOrderLineItemEdit",
    ],
  },
  {
    key: "pipeline",
    title: "The sales pipeline and bidding",
    detail:
      "Leads, opportunities, bid invitations, the pre-bid chase list on the bid pipeline " +
      "page (projects being pursued before any GC invited you), vendor price quotes, and " +
      "the named people and call history behind a contact. The contact record itself is " +
      "exported; the work of winning it is not.",
    models: [
      "BidPursuit",
      "SalesLead",
      "SalesOpportunity",
      "SalesActivity",
      "SalesStageChange",
      "BidInvitation",
      "VendorPriceQuote",
      "ContactPerson",
      "ContactInteraction",
    ],
  },
  {
    // The next three lines were found by exportCompletenessCensus.test.ts on
    // its first run: real records, in no dataset and on no line, so the page
    // said "everything but these" while they quietly stayed behind.
    key: "tm-tickets",
    title: "Signed time-and-materials tickets",
    detail:
      "Time-and-materials tickets — the extra work on a day, what it was built from, and " +
      "the name of whoever signed it on site. They are in the app; they are not in this " +
      "file, so keep your own copy of anything a GC signed.",
    models: ["TmTicket"],
  },
  {
    key: "timesheet-signoffs",
    title: "Timesheet sign-offs",
    detail:
      "Which days' hours a foreman signed on the phone, the drawn signature, and when the " +
      "office approved or reopened them. The hours themselves are in the time entries above; " +
      "the signatures are in the app, not in this file.",
    models: ["TimesheetSignoff"],
  },
  {
    key: "messages",
    title: "Messages sent from the app",
    detail:
      "Emails and texts sent to GCs and contacts from inside the app, and the delivery " +
      "history the provider reported for each one.",
    models: ["OutboundMessage", "OutboundMessageEvent"],
  },
  {
    key: "phase-codes",
    title: "Phase codes",
    detail:
      "The cost codes you set up. Scope lines and costs are exported; the code list they " +
      "are grouped by is not.",
    models: ["PhaseCode"],
  },
  {
    key: "lien-deadlines",
    title: "Lien deadlines",
    detail:
      "The preliminary notice, mechanic's lien, stop payment notice and bond claim dates you " +
      "entered, and the dates you marked them served. They are in the app on the Lien " +
      "deadlines page; they are not in this file — so keep your own copy of the proofs of " +
      "service, which are the record that counts.",
    models: ["LienDeadline"],
  },
  {
    key: "closeout-warranty-equipment",
    title: "Closeout, warranty, equipment and toolbox talks",
    detail:
      "Closeout items and submissions, warranty periods and service calls, the equipment " +
      "list and who has it, and toolbox talk records.",
    models: [
      "CloseoutItem",
      "CloseoutSubmission",
      "WarrantyPeriod",
      "WarrantyServiceRequest",
      "Equipment",
      "EquipmentAssignment",
      "ToolboxTalk",
    ],
  },
  {
    key: "account",
    title: "Your company profile and your own people",
    detail:
      "The company record, its locations and trade scopes, your users, their invitations " +
      "and who is assigned to which job.",
    models: [
      "Company",
      "CompanyLocation",
      "CompanyTradeScope",
      "User",
      "Invite",
      "JobAssignment",
    ],
  },
];

/**
 * Models that are neither exported nor disclosed, because they are not
 * anybody's work — each with the reason, so adding one is a sentence
 * somebody has to be willing to write.
 *
 * This is the third bucket `exportCompletenessCensus.test.ts` accepts. Every
 * model in the schema must sit in EXACTLY ONE of: a dataset,
 * `EXPORT_OMISSIONS`, or this list. A model in none of them is a table the
 * page says nothing about, which is how `CrewScheduleDay`, `TmTicket` and
 * the outbound message log were left out silently; a model in two is a
 * claim that contradicts itself.
 *
 * Not a place to hide real records. If a person would go looking for it in
 * their file, it belongs in `EXPORT_OMISSIONS`, where the page says so. The
 * panel's closing sentence ("sequence counters, sync logs…") is the promise
 * this list is held to.
 */
export const EXPORT_INTERNAL_MODELS: Record<string, string> = {
  BackchargeCounter: "sequence counter — the numbers it issued are on the rows themselves",
  ChangeOrderCounter: "sequence counter — the numbers it issued are on the exported change orders",
  CloseoutSubmissionCounter: "sequence counter — the numbers it issued are on the rows themselves",
  ContractDocumentVersionCounter: "sequence counter — the numbers it issued are on the rows themselves",
  EstimateVersionCounter: "sequence counter — the numbers it issued are on the exported estimate versions",
  InvoiceCounter: "sequence counter — the numbers it issued are on the exported invoices",
  MaterialOrderCounter: "sequence counter — the numbers it issued are on the exported material orders",
  RfiCounter: "sequence counter — the numbers it issued are on the exported RFIs",
  SafetyCaseCounter: "sequence counter — the numbers it issued are on the exported incidents",
  SubmittalCounter: "sequence counter — the numbers it issued are on the exported submittals",
  QuickBooksConnection: "an integration connection: tokens into another system, withheld above",
  IntegrationConnection: "an integration connection: tokens into another system, withheld above",
  QuickBooksAccountMapping: "integration plumbing — which QuickBooks account a posting goes to, meaningless without that QuickBooks company",
  QuickBooksEntityLink: "integration plumbing — our id against QuickBooks' id for the same record",
  QuickBooksSyncAttempt: "sync log — each attempt to post a record to QuickBooks",
  IntegrationSyncLog: "sync log — each run of an integration, and what it moved",
  ProcoreProjectLink: "integration plumbing — which GC Procore project feeds which job, meaningless without that Procore login",
  ProcoreItem: "a cached copy of the GC's own Procore records — theirs, kept in Procore, not this company's",
  CompanyCamProjectLink: "integration plumbing — which CompanyCam project feeds which job, meaningless without that CompanyCam login. The photos it imports are ordinary JobMedia rows and export with every other photo.",
  CalendarFeedToken: "notification record — a person's own subscribable-calendar credential, not a record about the company's work",
  NotificationDispatch: "notification record — which alert was sent to whom, not the thing it was about",
  AlertAcknowledgement: "notification record — who dismissed or snoozed an alert",
  DeviceToken: "notification record — a phone's push address, and a credential in its own right",
  AskUsage: "AI usage metering",
  AskProposal: "AI usage — a change the assistant proposed and waited on; anything confirmed is in the real tables",
  LicenseClassificationReference: "shared reference table of licence classifications, the same for every company",
};

/**
 * The same disclosure, written into the JSON bundle itself.
 *
 * THE FILE OUTLIVES THE ACCOUNT, which is the whole argument for the
 * feature — so a caveat that exists only on a page the person has cancelled
 * their way out of is a caveat they cannot read when it matters. The route
 * already carried a `notIncluded` array for this reason; it was three
 * hand-typed strings, one of them wrong, and nothing connected them to the
 * page they were a copy of. Derived here so there is one list and one place
 * to change it.
 */
export function exportNotIncludedLines(): string[] {
  return [
    ...EXPORT_WITHHELD.map((item) => `${item.title} — ${item.detail}`),
    ...EXPORT_OMISSIONS.map((item) => `${item.title} — ${item.detail}`),
  ];
}

/** What the bundle says about its own scope, counted rather than claimed. */
export function exportCoverageNote(): string {
  return (
    `This file holds the ${EXPORT_DATASETS.length} tables listed under "datasets". It is not ` +
    `the whole account — see "notIncluded" for what it leaves out.`
  );
}

/**
 * Characters that make a spreadsheet treat a cell as a formula.
 *
 * A description reading `=1+1` is a string in the database and an executed
 * formula the moment Excel opens it. Values here can arrive from a CSV
 * import or from a GC's document, so "it is only what our own users typed"
 * is not true.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * One CSV cell: RFC-4180 quoting, plus formula neutralisation.
 *
 * THIS DELIBERATELY CHANGES THE VALUE, AND ONLY IN THE CSV.
 *
 * A leading `=` gets a `'` in front of it, which is what a spreadsheet
 * needs to show the text rather than run it — and which means the CSV is
 * not byte-faithful to the database. That is a real cost and it is why the
 * JSON export exists beside this one and does NOT do it: JSON is the
 * faithful copy for moving to another system, CSV is the one you open in
 * Excel. Picking one behaviour for both would make one of those two jobs
 * wrong, quietly.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text: string;
  if (value instanceof Date) text = value.toISOString();
  // Prisma hands back Decimal objects for every money and quantity column,
  // and they are objects, so the JSON branch below would turn 4200 into
  // """4200""" — a quoted string inside a quoted cell. Duck-typed on toFixed
  // rather than imported, because this module stays free of Prisma so it can
  // be tested without a database, like wip.ts and retainage.ts beside it.
  else if (typeof (value as { toFixed?: unknown }).toFixed === "function") {
    text = (value as { toString(): string }).toString();
  } else if (typeof value === "object") text = JSON.stringify(value);
  else text = String(value);

  if (FORMULA_LEAD.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** A whole CSV, header row first. Column order is the dataset's order. */
export function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const lines = [columns.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => csvCell(row[c])).join(","));
  }
  // Trailing newline: some tools drop the last row without it.
  return `${lines.join("\n")}\n`;
}

/** `prova-export-jobs-2026-09-02.csv` — dated, so two exports do not collide
 * in a downloads folder and nobody has to guess which is newer. */
export function exportFilename(key: string, today: Date, extension: string): string {
  return `prova-export-${key}-${today.toISOString().slice(0, 10)}.${extension}`;
}
