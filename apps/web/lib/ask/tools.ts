/**
 * The questions Prova can answer about a company's own data.
 *
 * A contractor's real questions are relational and numeric — "what's left
 * on this punch list", "is that COI still good", "am I building off the
 * current sheet" — so this is tool-calling over the real tables, not
 * retrieval over a pile of text. The model picks a tool and writes the
 * sentence; the tool computes the answer.
 *
 * Three rules hold every tool in this file, and they are the reason it is
 * shaped this way rather than as one "query the database" escape hatch:
 *
 * 1. THE MODEL NEVER DOES ARITHMETIC. Every figure comes back already
 *    computed by the same libraries the pages use — lib/wip.ts,
 *    lib/compliance-expiry.ts, the label helpers. ARCHITECTURE.md already
 *    settled this for the WIP narrative: deterministic code owns every
 *    number on screen, the model only narrates numbers it was handed.
 *
 * 2. THE MODEL NEVER CHOOSES WHOSE DATA. `companyId` is not in any input
 *    schema below. It is supplied by the executor from the signed-in
 *    session. Job names, RFI text and notes are user-written and flow
 *    into the prompt, so a model that could be talked into changing which
 *    company it queries would be a data breach with extra steps.
 *
 * 3. EVERY ANSWER CITES ITS ROWS. Each result carries links to the pages
 *    the figures came from. A number nobody can click through to is a
 *    number nobody should act on — this project spent a day proving that.
 *
 * Read-only. No tool writes, and none of them should: "send the reminder
 * for me" is a different feature with a different risk profile.
 */

/** A place in the app a figure came from. Rendered as a link under the
 * answer. */
export type Citation = { label: string; href: string };

/** What every handler returns. `data` is what the model narrates; it never
 * sees anything else. */
export type ToolResult = {
  /** Already-computed values. Numbers here are final. */
  data: unknown;
  /**
   * Counts and totals the model would otherwise have to work out for
   * itself. Anything a person is likely to ask "how many" or "how much"
   * about belongs here, computed in TypeScript.
   *
   * Added after Ask answered "three overdue invoices" and listed four,
   * against a dashboard tile reading four. It had the rows and no count,
   * so counting them was the only way to answer, and a number the model
   * derives can differ between two runs of the same question.
   */
  summary?: Record<string, number>;
  citations: Citation[];
  /**
   * Set when the question is reasonable but the data to answer it does not
   * exist. The model is instructed to say this plainly rather than reach
   * for something adjacent — "we don't track that" is a better answer than
   * a confident number about something else.
   */
  unavailable?: string;
};

export type ToolName =
  | "crew_assignments"
  | "open_punch_list"
  | "compliance_status"
  | "drawing_currency"
  | "job_margin"
  | "bid_status"
  | "open_rfis"
  | "material_deliveries"
  | "equipment_location"
  | "receivables";

export type ToolDefinition = {
  name: ToolName;
  /** Written for the model: what it answers, and what it does NOT, because
   * a tool description that oversells is how a model ends up answering a
   * question with the wrong data. */
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
};

const noInput = { type: "object" as const, properties: {} };

const jobFilter = {
  type: "object" as const,
  properties: {
    jobName: {
      type: "string",
      description:
        "Optional. Part of a job name to narrow to one job. Matched loosely and case-insensitively. Omit to cover every active job.",
    },
  },
};

export const TOOLS: ToolDefinition[] = [
  {
    name: "crew_assignments",
    description:
      "Jobs currently in progress, who is ASSIGNED to each, the job's scheduled start and end, and the GC contact. An assignment is a roster, not an attendance record: there is no per-day crew schedule and nothing records who actually showed up, so never state or imply that someone is on site today — say who is assigned. Does NOT know travel time, addresses, or what tools to bring; none of those are recorded.",
    input_schema: noInput,
  },
  {
    name: "open_punch_list",
    description:
      "Punch list items not yet done, by job, with who raised them and when. Answers 'what is left before we get paid'.",
    input_schema: jobFilter,
  },
  {
    name: "compliance_status",
    description:
      "Certificates of insurance, contractor licences, insurance policies and bonds that are expired, expiring soon, or missing a date — ranked worst first. Answers 'is that certificate still active'. Covers the company's OWN records; it does not track a subcontractor's certificates unless one has been filed here.",
    input_schema: noInput,
  },
  {
    name: "drawing_currency",
    description:
      "Per drawing set: which revision is current, whether a newer revision has been issued but not received, and how old each is. Answers 'am I building off the latest sheet'. Current means most recently ISSUED by the architect, not most recently received.",
    input_schema: jobFilter,
  },
  {
    name: "job_margin",
    description:
      "Contract value, cost to date, forecast cost at completion, percent complete, earned revenue and over/under billing for active jobs, plus how much of each job's value actually carries a cost estimate. Answers 'are we making money on this'. Does NOT know vendor price changes — there is no vendor price history.",
    input_schema: jobFilter,
  },
  {
    name: "bid_status",
    description:
      "Bid invitations by status — invited, submitted, won, lost, declined — with the GC, trade and due date. Answers 'which bids are outstanding and who has not come back to us'.",
    input_schema: noInput,
  },
  {
    name: "open_rfis",
    description:
      "RFIs that are sent and unanswered, with their job and GC, how many days they have been outstanding, the contractual response date, and whether that date has passed. Answers 'what am I waiting on'. It reports how long an RFI has been open; it cannot predict when an answer will arrive.",
    input_schema: jobFilter,
  },
  {
    name: "material_deliveries",
    description:
      "Material orders with their delivery state — delivered, partly delivered, nothing yet — and how many days late against the promised date. Answers 'did the material actually turn up'.",
    input_schema: jobFilter,
  },
  {
    name: "equipment_location",
    description:
      "Which job each piece of equipment is assigned to, and what is unassigned. Answers 'who has the skid steer'. This is an ASSIGNMENT, not a live location — there is no GPS or telematics, so it says which job it is booked to, not where it physically is.",
    input_schema: noInput,
  },
  {
    name: "receivables",
    description:
      "Unpaid invoices with amounts outstanding and days overdue, using the same due-date rule as the AR aging page. Answers 'who owes us and how late are they'. Does NOT know the bank balance or upcoming payroll — neither is recorded, so it cannot answer whether there is cash to cover a specific bill.",
    input_schema: noInput,
  },
];

/**
 * Questions worth recognising and refusing well.
 *
 * These come up constantly and the data genuinely is not there. Naming
 * them explicitly means the answer is "we don't track that, here is what
 * would be needed" rather than the model quietly answering a nearby
 * question with the wrong figures.
 */
export const KNOWN_GAPS: { topic: string; why: string }[] = [
  {
    topic: "cash in the bank, and whether it covers payroll",
    why: "no bank balance and no payroll liability are recorded. The cash-flow page forecasts money coming IN from invoices; it does not know what is going out or what is on hand.",
  },
  {
    topic: "where a machine physically is",
    why: "equipment is assigned to a job, not tracked. There is no GPS or telematics feed.",
  },
  {
    topic: "what tools or materials to load for a job",
    why: "nothing records what a job needs from the shop.",
  },
  {
    topic: "a vendor's recent price change",
    why: "the catalog records what work has cost, not a vendor's price list over time.",
  },
  {
    topic: "who signed the safety talk",
    why: "the attendee roster is free text and the signature sheet is a photo, so a talk can be shown as logged but individual sign-off cannot be confirmed from the data.",
  },
  {
    topic: "driving directions or travel time",
    why: "job addresses are not modelled as coordinates and there is no routing.",
  },
];

/** Loose, case-insensitive name match — what a person means when they type
 * half a job name. */
export function matchesJobName(jobName: string, filter: string | undefined): boolean {
  if (!filter || filter.trim() === "") return true;
  return jobName.toLowerCase().includes(filter.trim().toLowerCase());
}

/**
 * Guards the boundary rule: no tool may ever accept a company, user or
 * tenant identifier from the model. Asserted in a test rather than left as
 * a comment, because this is the one mistake here that would be a breach
 * rather than a bug.
 */
export function toolsAcceptNoTenantInput(): boolean {
  const forbidden = ["companyid", "company", "tenant", "userid", "user", "orgid"];
  return TOOLS.every((tool) =>
    Object.keys(tool.input_schema.properties).every(
      (key) => !forbidden.includes(key.toLowerCase()),
    ),
  );
}
