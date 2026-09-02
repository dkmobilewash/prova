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
    note: "Crew, work performed, weather and delays — the daily record a delay claim rests on.",
    columns: [
      "id", "jobId", "reportDate", "crewPresent", "workPerformed", "weather",
      "delays", "filedByUserId", "createdAt", "updatedAt",
    ],
    scope: byCompany,
  },
];

export function datasetByKey(key: string): ExportDataset | undefined {
  return EXPORT_DATASETS.find((d) => d.key === key);
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
