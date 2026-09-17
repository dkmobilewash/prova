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
 * No tool writes a business row. A COMMAND (lib/ask/commands.ts) is the
 * shape a write takes: it resolves what the person named, writes at most
 * an AskProposal row, and ends the stream — only the person's tap on the
 * card executes anything. This file used to say "read-only, and none of
 * them should" write; that sentence was retired deliberately, and the
 * CHANGELOG entry for the command registry says why.
 *
 * 4. EVERY TOOL DECLARES WHO MAY CALL IT. `capability` names the same
 *    capability the page it cites is guarded by, and `toolsFor()` filters
 *    the list per person BEFORE the model sees it, with `runTool`
 *    re-checking at execution. Before this, the executor knew only the
 *    company: a FIELD-function member the dashboard withholds margin from
 *    could ask the box beside those tiles and be answered.
 */

import type { AskToolDefinition } from "@prova/integrations";
import { can, type Capability, type Principal } from "@/lib/permissions";

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
  | "receivables"
  | "cash_flow_forecast"
  | "retainage_held"
  | "change_order_status"
  | "job_labor_cost"
  | "safety_record"
  | "open_submittals"
  | "certification_expiry"
  | "apprentice_ratio"
  | "closeout_status"
  | "fringe_remittance"
  | "backcharge_exposure"
  | "apprenticeship_standing"
  | "daily_field_reports"
  | "wage_determinations"
  | "job_photos"
  | "vendor_pricing"
  | "gc_relationship"
  | "pay_application_status"
  | "warranty_obligations"
  | "outbound_messages"
  // The eight the assistant could not see. Every one reads a screen this
  // app already had — found by the hundred-question census in
  // lib/ask/eval/top-questions.ts, which asked what a contractor says
  // rather than what the registry was built to serve.
  | "certified_payroll"
  | "tm_tickets"
  | "unbilled_change_orders"
  | "schedule_status"
  | "estimate_detail"
  | "document_intake"
  | "team_roster"
  | "dispatch_slips";

export type ToolDefinition = {
  name: ToolName;
  /** Written for the model: what it answers, and what it does NOT, because
   * a tool description that oversells is how a model ends up answering a
   * question with the wrong data. */
  description: string;
  /** The capability the page this tool cites is guarded by. `null` means
   * the page is open to every signed-in member (the schedule is), and is a
   * decision written down rather than a default: tools.test.ts pins each
   * one against ROUTE_CAPABILITY. */
  capability: Capability | null;
  input_schema: {
    type: "object";
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
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

/** For bid_status: OUTSTANDING is the two not-yet-decided statuses
 * together (INVITED and SUBMITTED), because "which bids are outstanding"
 * is asked far more often than any one status by itself. */
const bidStatusFilter = {
  type: "object" as const,
  properties: {
    status: {
      type: "string",
      enum: ["OUTSTANDING", "INVITED", "SUBMITTED", "WON", "LOST", "DECLINED"],
      description:
        "Optional. Narrow to one status. OUTSTANDING means invited-or-submitted — not yet won, lost or declined — and is what 'which bids are outstanding' means. Omit to cover every bid invitation, most recent decision first.",
    },
  },
};

/** material_deliveries has no stored status to filter on — delivery state
 * is derived from the deliveries on every read, never stored, so
 * OUTSTANDING here means "not yet COMPLETE" computed the same way the
 * page computes it. */
const materialDeliveryFilter = {
  type: "object" as const,
  properties: {
    jobName: jobFilter.properties.jobName,
    status: {
      type: "string",
      enum: ["OUTSTANDING"],
      description:
        "Optional. OUTSTANDING narrows to orders that have not fully arrived — nothing delivered yet, or only partly delivered. Omit to cover every order, most recently promised first.",
    },
  },
};

/** change_order_status: PENDING is the two undecided statuses together —
 * "what has the GC not come back on" is the question actually asked, and
 * it spans DRAFT and SUBMITTED for different reasons (one is ours to send,
 * one is theirs to answer), which is why the result labels them apart. */
const changeOrderFilter = {
  type: "object" as const,
  properties: {
    jobName: jobFilter.properties.jobName,
    status: {
      type: "string",
      enum: ["PENDING", "DRAFT", "SUBMITTED", "APPROVED", "REJECTED"],
      description:
        "Optional. PENDING means drafted-or-submitted — not yet decided by the GC — and is what 'which change orders are outstanding' means. Omit to cover every change order.",
    },
  },
};

/** safety_record: a YEAR, because an OSHA case number is scoped to one and
 * the 300 log is filed per year. A four-digit year the person said, never a
 * range: "last year" is resolved by the app, not narrowed by the model. */
/** How far ahead to look for something that is about to lapse. Bounded and
 * defaulted by the app rather than by the model: "soon" is a word a model
 * will happily resolve to 365, and a card that expires in eleven months is
 * not an answer to "who is about to be turned away". */
const expiryWindowFilter = {
  type: "object" as const,
  properties: {
    withinDays: {
      type: "string",
      description:
        "Optional. How many days ahead to count as expiring soon, e.g. 30. Omit for 60, which is what an unqualified question means. Anything already expired is always included.",
    },
  },
};

/** A calendar month, because the ratio rule binds per day inside one and
 * the remittance that follows it is monthly. Resolved by the app when
 * omitted: "this month" is not a thing to let a model compute. */
const monthFilter = {
  type: "object" as const,
  properties: {
    month: {
      type: "string",
      description:
        "Optional. The month to review as YYYY-MM, e.g. 2026-09. Omit for the current month, which is what an unqualified question means.",
    },
  },
};

const safetyYearFilter = {
  type: "object" as const,
  properties: {
    year: {
      type: "string",
      description:
        "Optional. The four-digit calendar year to report, e.g. 2026. Omit for the current year, which is what an unqualified question means.",
    },
  },
};

export const TOOLS: ToolDefinition[] = [
  {
    name: "crew_assignments",
    // /schedule is open to every member; so is this
    capability: null,
    description:
      "Jobs currently in progress, who is ASSIGNED to each, the job's scheduled start and end, and the GC contact. An assignment is a roster, not an attendance record: there is no per-day crew schedule and nothing records who actually showed up, so never state or imply that someone is on site today — say who is assigned. Does NOT know travel time, addresses, or what tools to bring; none of those are recorded.",
    input_schema: noInput,
  },
  {
    name: "open_punch_list",
    // /punch-lists
    capability: "MANAGE_FIELD",
    description:
      "Punch list items not yet done, by job, with who raised them and when. Answers 'what is left before we get paid'.",
    input_schema: jobFilter,
  },
  {
    name: "compliance_status",
    // /compliance
    capability: "MANAGE_COMPLIANCE",
    description:
      "Certificates of insurance, contractor licences, insurance policies and bonds that are expired, expiring soon, or missing a date — ranked worst first. Answers 'is that certificate still active'. Covers the company's OWN records; it does not track a subcontractor's certificates unless one has been filed here.",
    input_schema: noInput,
  },
  {
    name: "drawing_currency",
    // /drawings
    capability: "MANAGE_JOBS",
    description:
      "Per drawing set: which revision is current, whether a newer revision has been issued but not received, and how old each is. Answers 'am I building off the latest sheet'. Current means most recently ISSUED by the architect, not most recently received.",
    input_schema: jobFilter,
  },
  {
    name: "job_margin",
    // the job page's costing section
    capability: "VIEW_JOB_COSTS",
    description:
      "Contract value, cost to date, forecast cost at completion, percent complete, earned revenue and over/under billing for active jobs, plus how much of each job's value actually carries a cost estimate. Answers 'are we making money on this'. Does NOT know vendor price changes — there is no vendor price history.",
    input_schema: jobFilter,
  },
  {
    name: "bid_status",
    // /bids
    capability: "MANAGE_ESTIMATING",
    description:
      "Bid invitations by status — invited, submitted, won, lost, declined — with the GC, trade and due date. Answers 'which bids are outstanding and who has not come back to us'. Pass status: OUTSTANDING for exactly that question. A result always carries the true total and outstanding counts, even if the list itself is capped.",
    input_schema: bidStatusFilter,
  },
  {
    name: "open_rfis",
    // /rfis
    capability: "MANAGE_JOBS",
    description:
      "RFIs that are sent and unanswered, with their job and GC, how many days they have been outstanding, the contractual response date, and whether that date has passed. Answers 'what am I waiting on'. It reports how long an RFI has been open; it cannot predict when an answer will arrive.",
    input_schema: jobFilter,
  },
  {
    name: "material_deliveries",
    // /material-orders
    capability: "MANAGE_FIELD",
    description:
      "Material orders with their delivery state — delivered, partly delivered, nothing yet — and how many days late against the promised date. Answers 'did the material actually turn up'. Pass status: OUTSTANDING for orders that have not fully arrived. A result always carries the true total and outstanding counts, even if the list itself is capped.",
    input_schema: materialDeliveryFilter,
  },
  {
    name: "equipment_location",
    // /equipment
    capability: "MANAGE_FIELD",
    description:
      "Which job each piece of equipment was last sent out to and not brought back from, the day it went out, and what is sitting in the yard. Answers 'who has the skid steer'. This is a DISPATCH RECORD, not a live location — there is no GPS or telematics, so it says where somebody logged it as going, not where it physically is.",
    input_schema: noInput,
  },
  {
    name: "receivables",
    // the dashboard's receivables tile
    capability: "MANAGE_BILLING",
    description:
      "Unpaid invoices with amounts outstanding and days overdue, using the same due-date rule as the AR aging page. Answers 'who owes us and how late are they'. Does NOT know the bank balance or upcoming payroll — neither is recorded, so it cannot answer whether there is cash to cover a specific bill.",
    input_schema: noInput,
  },
  {
    name: "cash_flow_forecast",
    // /cash-flow
    capability: "VIEW_COMPANY_FINANCIALS",
    description:
      "When money already invoiced is expected to arrive: a month-by-month projection of receivables and retainage, plus an overdue bucket and the AR aging split. Answers 'what is coming in next month'. Built ONLY from due dates, payment terms and substantial completion dates already on file — it is not a statistical forecast and it does not predict work not yet invoiced. It does NOT know the bank balance or any money going out, so it cannot say whether a specific bill can be paid. Retainage with no substantial completion date on file is reported as an explicit unscheduled total rather than being assigned a month.",
    input_schema: noInput,
  },
  {
    name: "retainage_held",
    // /cash-flow's retainage receivable section, and each job's Retainage panel
    capability: "MANAGE_BILLING",
    description:
      "Retainage withheld across the whole company and not yet released, with the balance per job and whether a job has a substantial completion date to collect against. Answers 'how much of our money is the GC still holding'. Counts EVERY job including completed ones, because retainage is collected at closeout — it is not limited to active work. A balance is what has been withheld less what has been released; it does not mean the GC has agreed to pay it.",
    input_schema: jobFilter,
  },
  {
    name: "change_order_status",
    // the job page's Change orders section
    capability: "VIEW_JOB_COSTS",
    description:
      "Change orders by job and status — draft, submitted and awaiting the GC, approved, rejected — with each one's value and how long a submitted one has been waiting. Answers 'what have we asked the GC for and what have they not answered'. Submitted value is EXPOSURE, not revenue: it is deliberately not part of contract value until approved. It does not know what the GC will decide or when, and it cannot tell you a change order is late — there is no agreed response time recorded for one, unlike an RFI.",
    input_schema: changeOrderFilter,
  },
  {
    name: "job_labor_cost",
    // the job page's time entries, priced the way that page prices them
    capability: "VIEW_JOB_COSTS",
    description:
      "Burdened labor cost booked to a job from logged hours — base wage times the pay-type multiplier plus fringes, using the rate schedule in force on each entry's own date. Answers 'what has the crew cost us on this job'. ALWAYS read the priced-hours share beside the total: hours on a craft with no rate schedule covering their date are NOT priced and are excluded from the money, so on a half-configured company the total is real but partial. It does NOT include material, equipment or subcontract cost — those reach a job as cost entries, and job_margin is the tool for total cost.",
    input_schema: jobFilter,
  },
  {
    name: "safety_record",
    // /safety
    capability: "MANAGE_FIELD",
    description:
      "The OSHA case log for one year: every incident with its classification and outcome, which cases are recordable on the 300 log, days away and days restricted, and the toolbox talks held. Answers 'what is our safety record this year'. Recordability is derived from the outcome, not stored. It CANNOT confirm that any individual signed a toolbox talk — the attendee roster is free text and the signature sheet is a photo — so it can say a talk was held and never that a named person attended it.",
    input_schema: safetyYearFilter,
  },
  {
    name: "open_submittals",
    // /submittals
    capability: "MANAGE_JOBS",
    description:
      "Submittals sent to the GC or architect and not yet returned, with their job, how many days they have been out, the date they were due back, and whether that date has passed. Answers 'what is the GC sitting on'. A submittal is open when its LATEST revision has no returned date: a rejected revision that was re-sent is open again on the new revision, not closed on the old one. It reports how long one has been out; it cannot predict when an answer will come back, and it does not know whether the work it covers has been released to start.",
    input_schema: jobFilter,
  },
  {
    name: "certification_expiry",
    // /certifications
    capability: "MANAGE_FIELD",
    description:
      "Worker certifications — OSHA 10 and 30, scaffold, aerial lift, fall protection, respirator fit test, first aid and the rest — that are EXPIRED or expiring soon, worst first, with whose they are and the date. Answers 'who is going to be turned away at the gate'. A certification with no expiry date recorded is reported as undated rather than as current, because an unknown date is not the same as a good one. It knows only what has been filed here: it cannot confirm that somebody holds a card nobody entered, and it does not know any GC's own site-access rules.",
    input_schema: expiryWindowFilter,
  },
  {
    name: "apprentice_ratio",
    // /union-compliance
    capability: "MANAGE_COMPLIANCE",
    description:
      "Whether each job stayed inside its apprentice-to-journeyman ratio for a month, per union local, with the days it went over and the worst single day's excess hours. Answers 'are we in ratio'. The ratio is checked PER DAY against the journeyman hours actually worked, not averaged across the month — a week of compliance does not buy a day over. A day with hours nobody has classified is reported as INCOMPLETE rather than compliant, because a day cannot honestly be certified while somebody on site is unaccounted for. It reports what the logged hours show; it does not know who was physically on site, and it cannot tell you whether a local has granted a variance.",
    input_schema: monthFilter,
  },
  {
    name: "closeout_status",
    // /closeout
    capability: "MANAGE_JOBS",
    description:
      "How close each job is to closing out: the stage it has reached, what is blocking it in the order that matters, the retainage the GC is still holding on it, and how long the GC has had the current closeout package. Answers 'what is stopping us getting paid the last of it'. Retainage outstanding is reported ALONGSIDE the blockers and is never itself one — it is what the blockers are costing. It does not know a GC's internal approval steps, and it cannot say when they will release.",
    input_schema: jobFilter,
  },
  {
    name: "fringe_remittance",
    // /union-compliance/remittance
    capability: "MANAGE_COMPLIANCE",
    description:
      "What is owed to each union local's trust funds for a month — hours, and the pension, vacation, health-and-welfare and training components priced from the fringe schedule in force on each day worked — and whether the month has been filed. Answers 'what do we owe the funds'. Hours that could NOT be priced are reported separately with the names behind them and are never valued at zero: an unpriced hour is a hole in the remittance, not a free one. It prices what the logged hours and the schedules on file say; it does not know what a fund has actually received or credited.",
    input_schema: monthFilter,
  },
  {
    name: "backcharge_exposure",
    // /backcharges
    capability: "MANAGE_BILLING",
    description:
      "Backcharges a GC has issued against this company — what is claimed, on which job, its status, and the date by which we must object, with whether that date has passed. Answers 'what is being charged back to us and what have we not answered'. A backcharge with no respond-by date recorded is reported as undated rather than as having time left. The claimed amount is what the GC asserts, never an agreed figure, and this cannot tell you whether the claim is valid.",
    input_schema: jobFilter,
  },
  {
    name: "apprenticeship_standing",
    // /union-compliance
    capability: "MANAGE_COMPLIANCE",
    description:
      "Every apprentice enrolled, their programme and sponsor, which period they are in, the on-the-job hours recorded this period against what the programme requires, and how short they are. Answers 'is anybody behind on their hours'. It distinguishes THREE things a summary would flatten into one: hours recorded and short, a programme with no required figure on file so there is nothing to measure against, and a requirement with no hours recorded at all. An enrollment carrying both a completion AND a cancellation date is reported as contradictory rather than resolved by precedence — picking one would hide a data-entry error on a compliance record.",
    input_schema: noInput,
  },
  {
    name: "daily_field_reports",
    // /field-reports
    capability: "MANAGE_FIELD",
    description:
      "Daily field reports filed on a job, most recent first — the work performed, who was on the crew, the weather and any delay recorded that day. Answers 'what happened on site' and 'what did we write down about that delay'. A delay noted here is the contemporaneous record a claim is later built on, so reports WITH a delay are flagged. It knows only what was filed: a day with no report is a day nobody wrote up, which is not the same as a day nothing happened.",
    input_schema: jobFilter,
  },
  {
    name: "wage_determinations",
    // /prevailing-wage
    capability: "MANAGE_COMPLIANCE",
    description:
      "The prevailing-wage determinations filed against each job, with the jurisdiction and whether the actual document is attached or linked. Answers 'do we have the determination for this job on file'. A determination row with NEITHER a file nor a source link is flagged: it is a determination in name only, and it cannot be produced in an audit. It does not know whether a job is public works, so it cannot tell you a determination is MISSING — only what has been filed.",
    input_schema: jobFilter,
  },
  {
    name: "job_photos",
    // /photos
    capability: "MANAGE_FIELD",
    description:
      "Site photos on each job: how many there are, when the most recent was TAKEN, how many carry a caption, and how many have been shared with the GC by link. Answers 'do we have pictures of that'. The date reported is when the photo was taken, not when somebody uploaded it, because that is the date a dispute turns on. A count is not proof of coverage — it cannot tell you whether the thing you need a picture OF was photographed, only how many exist.",
    input_schema: jobFilter,
  },
  {
    name: "vendor_pricing",
    // /vendors/pricing
    capability: "MANAGE_ESTIMATING",
    description:
      "Prices vendors have quoted, per material, with who quoted it, when, and whether the quote is still inside its validity date. Answers 'what did we get quoted for that' and 'is that price still good'. A quote PAST its validity date is flagged as expired rather than listed as a current price — an expired quote carried into a bid is how a job is mis-priced. A quote with NO validity date recorded is reported as undated, never as valid indefinitely.",
    input_schema: noInput,
  },
  {
    name: "gc_relationship",
    // /contacts, which lib/permissions.test.ts records as deliberately open:
    // "the address book — names and phone numbers are not a tier". This tool
    // takes that page's gate, which is the rule this file states. Worth a
    // reviewer's eye all the same: an MSA expiry is a commercial term rather
    // than a phone number, and if a tighter gate is right here then the page
    // needs it first — a tool must not be stricter than the screen beside it,
    // or the box refuses what the person can already read.
    capability: null,
    description:
      "For each GC and client: whether the master service agreement has lapsed, whether prequalification has expired, and whether their portal link is live or revoked. Answers 'can we still bid this GC' and 'who can see our portal right now'. A date that was never recorded is reported as unrecorded rather than as current. It knows only what is filed here — it does not know a GC's own approved-bidder list, and an in-date MSA is not the same as being invited to bid.",
    input_schema: noInput,
  },
  {
    name: "pay_application_status",
    // the job page's pay applications section
    capability: "MANAGE_BILLING",
    description:
      "Where each pay application and invoice sits in the GC's process — submitted, approved, partly paid, paid or DISPUTED — with its amount, the job, and how long it has been sitting at that status. Answers 'has the GC approved it yet'. This is about the GC's PROCESS, not about whether the money arrived: `receivables` answers who owes what and how overdue. A disputed application is called out because it stops being a timing problem and becomes a conversation. It reports the status recorded here; it cannot see the GC's own accounting system.",
    input_schema: jobFilter,
  },
  {
    name: "warranty_obligations",
    // /closeout
    capability: "MANAGE_JOBS",
    description:
      "Jobs still inside their warranty period, when each period ends, and the callbacks reported against them — open and resolved. Answers 'are we still on the hook for that' and 'what has come back on us'. The end date is derived from the start date and the number of months, never stored. A job with no warranty period recorded is reported as unrecorded rather than as out of warranty: nothing here knows what a subcontract actually obliges, only what somebody entered.",
    input_schema: jobFilter,
  },
  {
    name: "outbound_messages",
    // /messages, which lib/permissions.test.ts records as open: the delivery
    // log is open to every signed-in person, and sending is the action's
    // problem rather than the page's.
    capability: null,
    description:
      "Email this company has sent, with the latest delivery event for each — queued, sent, delivered, bounced, complained or failed — and the reason on the ones that failed. Answers 'did that actually reach them'. SENT means handed to the provider and is NOT the same as arrived; DELIVERED is the only status that means the receiving server took it. Absence of an OPEN is never evidence of anything, because image-blocking makes it meaningless, so this reports opens and never concludes from their absence.",
    input_schema: noInput,
  },

  /* ─────────────── the eight the assistant could not see ─────────────── */

  {
    name: "certified_payroll",
    // /jobs/[id]/certified-payroll — a dynamic route, guarded at the page.
    // MANAGE_COMPLIANCE is the gate the union-compliance lane uses and the
    // one the PAYROLL_COMPLIANCE function is built around.
    capability: "MANAGE_COMPLIANCE",
    description:
      "For each of the last eight payroll weeks on a job: how many workers, how many hours, and the three things that would come out BLANK on a WH-347 — hours with no fringe rate schedule in force to price them, workers with no craft classification, and workers with no name on their account. Answers 'could we produce certified payroll for that week'. It does NOT and CANNOT say whether a week was FILED: nothing in this app records a payroll submission, the form is computed live every time it is opened, so a week reported as ready to produce has not been sent anywhere.",
    input_schema: jobFilter,
  },
  {
    name: "tm_tickets",
    // Written by the phone app; there is no web page for these at all.
    capability: "MANAGE_FIELD",
    description:
      "Time-and-material tickets signed on site — the job, the day, what was done, who signed and how long ago. Answers 'did the GC sign the ticket from Tuesday'. Every ticket carries a signature by construction, so the question this really answers is which signed tickets are getting old. It does NOT know whether a ticket was ever BILLED: nothing links a ticket to a change order or an invoice, so a signed ticket and a paid one are indistinguishable here.",
    input_schema: jobFilter,
  },
  {
    name: "unbilled_change_orders",
    capability: "VIEW_JOB_COSTS",
    description:
      "Approved change orders with the value they added to the contract, how much of that has been billed through pay-application line items, and what is left. Answers 'which approved change orders have we not invoiced'. TWO BLIND SPOTS IT REPORTS RATHER THAN HIDES: a change order billed on a plain lump-sum invoice has no line breakdown to read, so `lumpSumInvoicesOnJob` counts the invoices on that job this cannot see into; and a change order that only EDITED existing lines rather than adding new ones is flagged `editsOnly` and given no unbilled figure, because nothing separates its uplift from the line's original value.",
    input_schema: jobFilter,
  },
  {
    name: "schedule_status",
    // /schedule, which lib/permissions.test.ts records as open with the
    // reason this tool is shaped by: "No money on it, and everyone needs to
    // know where they are working." That is why no cost figure is in here.
    capability: null,
    description:
      "Each contracted or in-progress job's scheduled start and end, how far through that window today is, and how many days until — or past — the end date. Answers 'where does this job stand against its dates'. IT DOES NOT FORECAST A COMPLETION DATE AND NOTHING IN THIS APP CAN. `scheduleElapsedPercent` is a DATE fact and is not percent complete: percent complete is money spent against money expected and lives in job_margin, and a job can be 80% through its budget and 40% through its programme. Never read one as the other, and do not offer an 'ahead or behind' verdict from the two together — a fit-out job front-loads material cost and a framing job does not, so the gap between them means different things on different work. A job missing a start or end date reports null rather than zero and is counted in `withoutBothDates`.",
    input_schema: jobFilter,
  },
  {
    name: "estimate_detail",
    capability: "VIEW_JOB_COSTS",
    description:
      "The actual line items on a job's estimate — description, quantity, unit, unit price, labor hours, trade scope, craft, and whether the line arrived on an approved change order rather than in the original bid. Answers 'what is in that estimate'. A line with NO price is reported with a null price and counted in `linesWithNoPrice`, never as zero; the total is called `pricedLinesTotal` for that reason and is not the estimate's value when unpriced lines exist.",
    input_schema: jobFilter,
  },
  {
    name: "document_intake",
    // /intake, which lib/permissions.test.ts records among the guarded
    // routes for the jobs lane.
    capability: "MANAGE_JOBS",
    description:
      "Documents sitting in the intake tray that nobody has filed or dismissed yet, with what the classifier proposed each one is, its confidence, its reason, and how many days it has been waiting. Answers 'what came in that nobody has dealt with'. The proposed kind is a GUESS and is labelled as one; a job HINT from the classifier is reported separately from a job somebody actually filed it against, because a hint presented as a filing is how a pay application ends up on the wrong job.",
    input_schema: noInput,
  },
  {
    name: "team_roster",
    // /team, which lib/permissions.test.ts records as open — a roster of
    // who works here is not a tier.
    capability: null,
    description:
      "Everyone with an account on this company: name, email, role, job function, which craft classifications they have actually worked under, how many certifications are on file, and what is missing on them. THERE IS NO PER-PERSON PAY RATE IN THIS APP AND THIS DOES NOT REPORT ONE — a rate belongs to a craft classification and the fringe schedule in force on a given date, which is why job_labor_cost prices an hour rather than a person. What it does report is the blanks that break paperwork downstream: no name on an account is a blank in the name column of a WH-347, and hours with no craft are a blank in the classification column and are invisible to the ratio review.",
    input_schema: noInput,
  },
  {
    name: "dispatch_slips",
    capability: "MANAGE_COMPLIANCE",
    description:
      "Union dispatch slips on file — which worker the hall dispatched to which job, on what date, under which craft and local, and whether the actual slip document is attached. Answers 'do we have dispatch on file for this job'. IT IS NOT A CREW SCHEDULE AND MUST NOT BE USED AS ONE: a slip records that somebody WAS dispatched, never that they are on site today or tomorrow. A slip row with no document attached proves nothing in an audit, the same distinction wage_determinations makes.",
    input_schema: jobFilter,
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

  /* ─── the six the hundred-question census left standing ───
   *
   * Each one was asked, routed to nothing, and — this is the part that
   * makes them belong HERE rather than only in the census — each has a
   * tool that would answer it in the right SHAPE and the wrong substance.
   * A gap does not fail as silence. It fails as a confident near-miss in
   * the same voice as a fact, and the only thing standing between a
   * near-miss and a person acting on it is the model having been told.
   *
   * The seventh, the payroll-cash question, was already at the top of this
   * list and is the reason the list exists. */
  {
    topic: "who is on a job tomorrow, or any day's crew",
    why: "there is no per-day crew schedule. A job ASSIGNMENT is a roster of who is attached to the job, and a DISPATCH SLIP records that the hall sent somebody — neither says who is on site on a given day. Both answer in the right shape, which is what makes guessing from them dangerous: a foreman reads a list of names as tomorrow's crew.",
  },
  {
    topic: "whose timecard is missing, or who has not turned hours in",
    why: "a TimeEntry has no submitted, approved or locked state — an hour is either recorded or it does not exist. So nothing distinguishes a man who did not hand his hours in from a man who did not work, and reporting the second as the first puts an accusation in somebody's mouth.",
  },
  {
    topic: "the experience modification rate, or mod rate",
    why: "the EMR comes from the carrier's rating bureau and is not recorded here. The OSHA log is what an EMR is calculated FROM by somebody else, so a figure derived from it would be a number no insurer has ever quoted us.",
  },
  {
    topic: "lien deadlines, preliminary notices or stop notices",
    why: "none of it is modelled — not a date, not a document, not a reminder. This is missing DATA rather than a missing screen, and the cost of a confident wrong answer is total: on California public work the preliminary notice window is 20 days from first furnishing and missing it forfeits the remedy.",
  },
  {
    topic: "whether a job will finish on time, or a forecast completion date",
    why: "nothing forecasts a date. `schedule_status` says where a job stands against the dates somebody entered, which is as far as the data goes. Percent complete is COST-based — money spent against money expected — and a job can be 80% through its budget and nowhere near 80% through its programme.",
  },
  {
    topic: "what a person is paid an hour",
    why: "there is no per-person pay rate here, by design. A rate belongs to a CRAFT CLASSIFICATION and the fringe schedule in force on a given date — which is why job_labor_cost prices an hour rather than a person, and why the same man on two crafts in one week costs two different amounts. Say that, and name the crafts he has worked under (team_roster has them) rather than refusing flat: the classification and its schedule are where the number actually lives.",
  },
  {
    topic: "our own sales pipeline — work being chased before anyone invites us to bid",
    why: "a subcontractor's pre-bid pipeline is not modelled. `bid_status` starts at the bid INVITATION, so it knows about work a GC has already asked us to price and nothing about what is being chased. (The SalesLead model in this database is Prova's own CRM for selling this product and is not your data.)",
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
 *
 * Takes the tool list as an argument, defaulting to the real one, ONLY so
 * the test can hand it a tenant-carrying tool and watch this return false.
 * It used to be uncallable that way, so the test re-implemented the check
 * inline instead — and emptying the `forbidden` list below left the whole
 * suite green (issue #108). Every caller in the app uses the default.
 */
export function toolsAcceptNoTenantInput(
  tools: readonly Pick<ToolDefinition, "input_schema">[] = TOOLS,
): boolean {
  const forbidden = [
    "companyid",
    "company",
    "tenant",
    "userid",
    "user",
    "orgid",
    // Added with the command registry: an actor is as much "whose data" as
    // a tenant is, and a proposal id is a handle on a row the executor
    // must find for itself.
    "role",
    "jobfunction",
    "actorid",
    "ownerid",
    "proposalid",
  ];
  return tools.every((tool) =>
    Object.keys(tool.input_schema.properties).every(
      (key) => !forbidden.includes(key.toLowerCase()),
    ),
  );
}

/** The read tools this person may be offered. The filter is what the model
 * sees; `runTool` checks again when a call arrives, because the tool list
 * is advisory and the check is the boundary — the same "nav is cosmetic,
 * page guard is the boundary" rule lib/permissions.ts states for routes. */
export function toolsFor(principal: Principal): ToolDefinition[] {
  return TOOLS.filter((tool) => tool.capability === null || can(principal, tool.capability));
}

/**
 * Projects a registry entry to exactly the fields the API accepts — the
 * read-tool twin of commands.ts's `toToolDefinition`.
 *
 * `capability` is for this side of the boundary (`toolsFor` filters on it,
 * `runTool` re-checks it) and the API rejects the WHOLE request over any
 * field it does not know on a tool object — issue #251, where
 * "tools.0.custom.capability: Extra inputs are not permitted" took every
 * Ask question down. An explicit pick rather than a strip of the fields
 * known today, so the next internal field added to ToolDefinition never
 * reaches the request either.
 */
export function toAskToolDefinition(tool: ToolDefinition): AskToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema,
  };
}
