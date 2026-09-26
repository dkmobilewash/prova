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

/**
 * One specific record the answer is about, and where to go and act on it.
 *
 * NOT a citation. A citation answers "where did this figure come from" and
 * is a PAGE — `/alerts`, `/certifications`. An item link answers "take me
 * to the one you just told me about" and is a ROW: the GC whose
 * prequalification is due, the job whose lien deadline is running out.
 * Diego, clicking the box on 2026-09-19: the answer named three things and
 * left him to go and find each one by hand.
 *
 * TWO RULES, AND THEY ARE THE WHOLE SAFETY OF THIS FIELD.
 *
 * 1. THE HANDLER BUILDS THESE FROM ITS OWN DATA. The model never supplies
 *    an href and never edits one. It cannot: `links` is not in `data`, so
 *    it is not in what the model is shown, and nothing parses hrefs back
 *    out of the model's prose. A link the model wrote would be a link it
 *    could invent — a confident button to a record that does not exist,
 *    which is worse than no button, and is exactly the failure this app
 *    refuses everywhere else (it does not let the model do arithmetic
 *    either).
 *
 * 2. THE ASKER MUST BE ABLE TO OPEN IT. A button is a stronger promise
 *    than a citation: it says "go here and fix it". Handing somebody a
 *    button to a page their capability refuses is a dead end with their
 *    name on it. So a handler may only put a row here once it has already
 *    filtered those rows for this person — which is why `needs_attention`
 *    can: `visibleToPrincipal` has dropped every alert whose page the
 *    asker could not open before the handler ever sees it.
 */
export type ItemLink = {
  /** The row in the person's own words — an alert's title, a job's name.
   * Taken from the record, never composed by the model. */
  label: string;
  href: string;
  /** Optional one-liner under the label: which one, and why now. */
  detail?: string;
};

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
   * The specific records this answer is about, each with somewhere to go
   * and do something. Optional: most tools answer a question that has no
   * single row behind it ("what is our backlog"), and a button under such
   * an answer would be inventing a destination.
   *
   * Read `ItemLink`'s own comment before adding these to a tool — both of
   * its rules are load-bearing, and the second one (the asker must be able
   * to open it) is not satisfied by default.
   */
  links?: ItemLink[];
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
  | "crew_schedule"
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
  | "dispatch_slips"
  // Was the census gap `q-emr` — see top-questions.ts.
  | "experience_mod_rate"
  // Was the census gap `q-lien-deadline`.
  | "lien_deadlines"
  // Was the census gap `q-pipeline`.
  | "bid_pursuits"
  // The morning question, the address book, and one job on one screen.
  | "needs_attention"
  | "contact_lookup"
  | "job_overview"
  // The dashboard's getting-started card, for a brand-new account.
  | "getting_started"
  /* ─── the estimating and takeoff features the assistant could not read ───
   *
   * Thirteen of them shipped between 22 and 26 September and not one had a
   * tool, so every question an estimator asks in the week before a bid is
   * due routed to nothing — or, worse, to the near-miss beside it.
   *
   * `drawing_currency` is that near-miss and is the reason this comment is
   * here rather than in a commit message: it reads `DrawingSet` /
   * `DrawingRevision`, the JOB's paper trail, and `takeoff_currency` reads
   * `TakeoffPlan.revisionLabel` / `sheetIssuedOn`, a sheet somebody was
   * emailed with an invitation to bid. `takeoff.prisma` says the two "must
   * not become" each other; a question about measured quantities answered
   * from the drawing register would be the right shape and the wrong paper.
   */
  | "takeoff_currency"
  | "wall_schedule"
  | "bid_levelling"
  | "bid_compliance"
  | "bid_alternates"
  | "bid_recap"
  | "conceptual_estimate"
  // "How do I…", from the app's own registered page walkthroughs — never
  // a fact about this company's data. See lib/ask/appHelp.ts.
  | "app_help";

export type ToolDefinition = {
  name: ToolName;
  /** Written for the model: what it answers, and what it does NOT, because
   * a tool description that oversells is how a model ends up answering a
   * question with the wrong data. */
  description: string;
  /** The capability the page this tool cites is guarded by. `null` means
   * the page is open to every signed-in member (the schedule is), and is a
   * decision written down rather than a default: tools.test.ts pins each
   * one against ROUTE_CAPABILITY.
   *
   * THAT LAST SENTENCE WAS FALSE UNTIL 2026-09-18 and is the reason the
   * guard now exists. tools.test.ts had nineteen tests and mentioned
   * neither `capability` nor `ROUTE_CAPABILITY`; commands.test.ts pins the
   * COMMANDS that way, which is where the claim seems to have come from. A
   * documented guard that does not exist is worse than an absent one,
   * because it is why nobody writes it.
   *
   * READ IT AS COVERING ONE PAGE, NOT ALL OF THEM. This is a single field
   * and a handler cites several pages, so it names the guard on the page
   * its author had in mind. The rest are checked by the test now, against
   * a mapping derived from the citations handlers.ts actually emits — and
   * four pairs disagree today, listed there with the reason each is
   * recorded rather than fixed. */
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

/** bid_pursuits: OPEN is the three still-being-chased stages together
 * (WATCHING, CONTACTED, EXPECTING_INVITE) — "what have we got out chasing"
 * is that question, and it is asked far more than any one stage. */
const pursuitStageFilter = {
  type: "object" as const,
  properties: {
    stage: {
      type: "string",
      enum: ["OPEN", "WATCHING", "CONTACTED", "EXPECTING_INVITE", "INVITED", "DROPPED"],
      description:
        "Optional. OPEN means still being chased — not yet invited and not dropped — and is what 'what are we chasing' means. Omit to cover every pursuit, open ones first.",
    },
  },
};

/** contact_lookup: one name, a company OR a person. */
const contactNameFilter = {
  type: "object" as const,
  properties: {
    name: {
      type: "string",
      description:
        "The company or the person to look up, as the person said it — 'Halvorsen', 'Turner', 'Dana'. Matched loosely and case-insensitively. For 'the PM at Halvorsen', pass the company, 'Halvorsen'; the people there come back with their titles.",
    },
  },
};

/** job_overview: the job is not optional — an overview of everything is the
 * dashboard, not this. */
const oneJob = {
  type: "object" as const,
  properties: {
    jobName: {
      type: "string",
      description: "The job to summarise, as the person named it, e.g. 'Riverside'. Required: ask which job if they did not say.",
    },
  },
};

/** app_help: what the person wants to do, in their own words. No enum —
 * this is matched against free text in the app's own walkthroughs
 * (lib/ask/appHelp.ts), not against a fixed list of topics. */
const appHelpFilter = {
  type: "object" as const,
  properties: {
    topic: {
      type: "string",
      description:
        "What the person wants to do or find, in their own words — 'log a backcharge', 'add a punch list item', 'connect QuickBooks'. Matched against the app's own page walkthroughs; not a fact about this company's data.",
    },
  },
};

/**
 * The bid tools take the PROJECT AS THE GC NAMED IT, not a job name.
 *
 * Not the same filter as `jobFilter` and deliberately not reusing it: at bid
 * time there is usually no job at all, and one GC sends three invitations per
 * building. A bid is connected to a job only when somebody says so
 * (`BidInvitation.wonJobId`, #491), so a tool that matched bids by job name
 * would silently answer about another project's bid form.
 */
const bidProjectFilter = {
  type: "object" as const,
  properties: {
    projectName: {
      type: "string",
      description:
        "Optional. Part of the project name on the bid invitation, as the GC named it — \"St. Mary's\", 'Harbor lofts'. Matched loosely and case-insensitively. Omit to cover every bid invitation.",
    },
  },
};

/**
 * conceptual_estimate: the building's gross area, as the person said it.
 *
 * A number the PERSON supplies, which is the one kind a tool may take — it is
 * not a figure derived from this company's data, it is the thing they are
 * asking about. The app multiplies it by the benchmark; the model never does,
 * and `conceptual-estimate.ts` explains at length why that figure is the most
 * dangerous one this product could produce.
 */
const grossAreaFilter = {
  type: "object" as const,
  properties: {
    areaSqFt: {
      type: "string",
      description:
        "Optional. The building's gross area in square feet, as the person said it — '40000' for a 40,000 SF office fit-out. Omit to get the per-square-foot range on its own, with nothing multiplied out.",
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
    // /schedule is open to every member; so is this.
    //
    // This description used to end "there is no per-day crew schedule".
    // There is one now — CrewScheduleDay, and the crew_schedule tool below
    // — so the sentence was corrected rather than left to go quietly false.
    // A claim about what the app does NOT have expires exactly as fast as a
    // claim about what it does, which this repo has paid for twice.
    //
    // THREE TIMES. It then ended "Does NOT know travel time, addresses, or
    // what tools to bring; none of those are recorded" — and `Job.siteAddress`
    // IS recorded, and geocoded to `siteLatitude`/`siteLongitude` for a daily
    // report's weather. No TOOL returns it, which is the true and narrower
    // claim; the wide one was a sentence a model could repeat to somebody who
    // can see the address on the job page. Corrected 2026-09-26, with the
    // matching KNOWN_GAPS reason.
    capability: null,
    description:
      "Jobs currently in progress, who is ASSIGNED to each, the job's scheduled start and end, and the GC contact. An assignment is a ROSTER and carries no date at all — it is everyone attached to the job, not who is there on a given day. For a question about a DAY, use crew_schedule; this tool cannot answer one and must never state or imply that somebody is on site today. It is still not an attendance record either: nothing here records who actually showed up. It does not return the job's SITE ADDRESS and no tool here does — the address is on the job's own page. Nothing in this app measures travel time or distance, and nothing records what to load for a job; never estimate either.",
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
      "Contract value, cost to date, forecast cost at completion, percent complete, earned revenue and over/under billing for active jobs, plus how much of each job's value actually carries a cost estimate. Answers 'are we making money on this'. It cannot tell you WHY a job's cost moved: it holds no vendor quotes and no material prices, so a job going over on material says nothing here about which supplier put their price up — that is `vendor_pricing`, which does hold a quote history and reports the movement.",
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
    // the job page's time entries, priced the way that page prices them —
    // wageCost + allowanceCost, same as jobWip.actualCostToDate's labor share
    capability: "VIEW_JOB_COSTS",
    description:
      "Burdened labor cost booked to a job from logged hours: base wage times the pay-type multiplier plus fringes (wageCost), PLUS any per diem and travel pay logged on those days (allowanceCost — TimeEntry.perDiemAmount/.travelPayAmount, real dollars the company pays to have the work done). The total is exactly what /jobs/[id]'s Actual cost figure counts as this job's labor — say so if asked why the two might otherwise seem to disagree. Answers 'what has the crew cost us on this job'. ALWAYS read the priced-hours share beside the total: hours on a craft with no rate schedule covering their date get $0 of WAGE and are excluded from wageCost, so the total can be nonzero from allowances alone while the wage side is still incomplete — that is what shareOfHoursPriced is for, and it must be read alongside the dollar figure, never dropped. It does NOT include material, equipment or subcontract cost — those reach a job as cost entries, and job_margin is the tool for total cost.",
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
    name: "lien_deadlines",
    // /lien-deadlines. MANAGE_BILLING, the page's own gate: a lien is how a
    // sub gets paid, and this tool answers what that page shows.
    capability: "MANAGE_BILLING",
    description:
      "Lien-rights deadlines recorded against each job — preliminary notices, mechanic's liens, stop payment notices and payment bond claims — with the deadline, who it goes to, whether it has been served, and for unserved ones how many days are left or how many days overdue. Answers 'when does our lien deadline run out on Riverside'. THIS APP NEVER COMPUTES A LEGAL DEADLINE AND NEITHER MAY YOU: every date here was ENTERED by a person from their counsel or the statute. Never work out, estimate or suggest a deadline from a first-furnishing date, a completion date, a state's rules or anything else — the rules vary by state, public versus private work and the contractor's tier, and a wrong date can cost lien rights. If nothing is recorded for a job, say that no deadline has been entered and that the date has to come from their attorney or the statute; an empty list is NOT evidence that no deadline is running. A row served after its entered date is still served; whether late service preserves the right is a question for counsel, not for you.",
    input_schema: jobFilter,
  },
  {
    name: "bid_pursuits",
    // /pipeline, where the chase list is shown and edited — MANAGE_ESTIMATING,
    // the same gate as bid_status's /bids.
    capability: "MANAGE_ESTIMATING",
    description:
      "The company's OWN pursuit list: projects somebody here is chasing BEFORE any GC has invited us to bid — by stage (watching, contacted, expecting invite, invited, dropped), with owner, architect, the GC(s) expected, the expected bid date and a rough value when entered. Answers 'what have we got out chasing that we haven't bid yet', which bid_status CANNOT: that tool starts at the invitation. Flags expected bid dates coming up in the next 30 days, expected bid dates that have PASSED with no invitation, and pursuits nobody has touched in 30 days (gone quiet). It knows NOTHING about a project until somebody here types it in — it is not a feed of upcoming work, so an empty or short list means nobody has entered more, never that nothing is out there. A passed bid date says only that the date went by with no invite logged, never why. Pass stage: OPEN for exactly the still-being-chased ones. Summary counts are over every matching pursuit, even if the list is capped.",
    input_schema: pursuitStageFilter,
  },
  {
    name: "apprenticeship_standing",
    // /union-compliance
    capability: "MANAGE_COMPLIANCE",
    description:
      "Every apprentice enrolled, their program and sponsor, which period they are in, the on-the-job hours recorded this period against what the program requires, and how short they are. Answers 'is anybody behind on their hours'. It distinguishes THREE things a summary would flatten into one: hours recorded and short, a program with no required figure on file so there is nothing to measure against, and a requirement with no hours recorded at all. An enrollment carrying both a completion AND a cancellation date is reported as contradictory rather than resolved by precedence — picking one would hide a data-entry error on a compliance record.",
    input_schema: noInput,
  },
  {
    name: "daily_field_reports",
    // /field-reports, and a job's own Field reports tab for the delay log.
    capability: "MANAGE_FIELD",
    description:
      "Daily field reports filed on a job, most recent first — the work performed, who else was on site, the foreman's weather note — AND the structured delay log for those days: each delay's cause, who was responsible, when it started and ended, crew-hours lost, whether the GC was told and how, and any change order drafted from it. Answers 'what happened on site', 'what did we write down about that delay' and 'how many hours did that cost us'. A delay is the contemporaneous record a claim is later built on, so reports carrying one are flagged, `delaysTheGcWasNotTold` is counted (notice is what makes a delay claimable), and a day whose delays were logged with NO REPORT FILED is still a row, marked `reportFiled: false` with `workPerformed: null` — a delay does not need a report to exist, and dropping it would be a confident zero. Reports filed before 2026-09-18 may instead carry `legacyDelayNote`, a single free-text sentence which is all that was recorded then: it has NO cause, no responsible party and no hours, so never present it as though it did. It knows only what was filed: a day with no report is a day nobody wrote up, which is not the same as a day nothing happened, and a delay nobody logged is not a day that ran clean.",
    input_schema: jobFilter,
  },
  {
    name: "wage_determinations",
    // /prevailing-wage
    capability: "MANAGE_COMPLIANCE",
    description:
      "The prevailing-wage determinations filed against each job, with the jurisdiction, whether the actual document is attached or linked, and each one's STANDING: in force on the job's bid-advertisement date, the wrong issue for that date, a predetermined increase now due past its expiration, or unchecked because the advertisement date or the document's issue date was never entered. Answers 'do we have the determination for this job on file' and 'is our determination still current'. The standing is derived from dates a person entered on the job's Compliance tab (the published DIR rule: the issue in force on the first advertisement for bids governs the job), never looked up, and no wage rate is known here. A determination row with NEITHER a file nor a source link is flagged: it is a determination in name only, and it cannot be produced in an audit. Whether a job is public works is only what somebody ENTERED (jobIsPublicWorks, null when nobody has), so it cannot tell you a determination is MISSING — only what has been filed and how it stands.",
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
      "Prices vendors have quoted, per material, with who quoted it, when, whether the quote is still inside its validity date, AND how that vendor's price for that material MOVED from their previous quote to this one — the percent change, both prices and both dates, exactly as the Movement block on /vendors/pricing shows it. Answers 'what did we get quoted for that', 'is that price still good' and 'has their price gone up'. A movement is only ever the SAME vendor and the SAME unit: across vendors it is a difference of opinion, across units it is arithmetic on unrelated numbers, and neither is a price change. `priceChange` is null when that vendor has only quoted the item once, and null on a quote a newer one of theirs supersedes — the movement is reported on the newer quote. Never work a percentage out yourself; use `changePercent`. A quote PAST its validity date is flagged as expired rather than listed as a current price — an expired quote carried into a bid is how a job is mis-priced. A quote with NO validity date recorded is reported as undated, never as valid indefinitely. It knows only quotes somebody entered here: it is not a vendor's published price list, and a material with one quote has no movement rather than a flat price.",
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
      "For each of the last eight payroll weeks on a job: how many workers, how many hours, the three things that would come out BLANK on a WH-347 — hours with no fringe rate schedule in force to price them, workers with no craft classification, and workers with no name on their account — and whether a certified-payroll DOCUMENT is on record here covering that whole week. Answers 'could we produce certified payroll for that week' and 'is there a certified payroll on file for that week'. TWO DIFFERENT FACTS, TWO FIELDS, NEVER ONE SENTENCE: `readyToProduce` is about the data behind the form; `documentOnRecord` is about a document somebody filed against a period — the same rows and the same whole-week containment as the CERTIFIED_PAYROLL alert in needs_attention, so the two cannot disagree. NEITHER IS PROOF OF FILING, and this is the part to say out loud every time: nothing in this app records a SUBMISSION — no agency, no date sent, no receipt — so say 'a certified payroll is on record for that week' or 'nothing is on record for that week', and never 'it was filed', 'it went in' or 'it was not filed'. `documentOnRecord: false` means nothing is recorded HERE, not that nobody filed; true means a document is here, not that it reached anybody. A document whose period only clips the week does not cover it and is not counted, because half a period is not evidence about a week.",
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
      "Each contracted or in-progress job's scheduled start and end, how far through that window today is, and how many days until — or past — the end date. Answers 'where does this job stand against its dates'. IT DOES NOT FORECAST A COMPLETION DATE AND NOTHING IN THIS APP CAN. `scheduleElapsedPercent` is a DATE fact and is not percent complete: percent complete is money spent against money expected and lives in job_margin, and a job can be 80% through its budget and 40% through its schedule. Never read one as the other, and do not offer an 'ahead or behind' verdict from the two together — a fit-out job front-loads material cost and a framing job does not, so the gap between them means different things on different work. A job missing a start or end date reports null rather than zero and is counted in `withoutBothDates`.",
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
    // MANAGE_FIELD, matching /certifications exactly — this tool's answer
    // is mostly that page: certifications on file and what is missing on
    // them. It was null for a while on the primary citation's reasoning
    // (/team is open, "a roster of who works here is not a tier") and the
    // secondary citation never came up, which tools.test.ts recorded as
    // "the one worth fixing". Fixed 2026-09-19.
    capability: "MANAGE_FIELD",
    description:
      "Everyone with an account on this company: name, email, role, job function, which craft classifications they have actually worked under, how many certifications are on file, and what is missing on them. THERE IS NO PER-PERSON PAY RATE IN THIS APP AND THIS DOES NOT REPORT ONE — a rate belongs to a craft classification and the fringe schedule in force on a given date, which is why job_labor_cost prices an hour rather than a person. What it does report is the blanks that break paperwork downstream: no name on an account is a blank in the name column of a WH-347, and hours with no craft are a blank in the classification column and are invisible to the ratio review.",
    input_schema: noInput,
  },
  {
    name: "dispatch_slips",
    capability: "MANAGE_COMPLIANCE",
    description:
      "Union dispatch slips on file — which worker the hall dispatched to which job, on what date, under which craft and local, and whether the actual slip document is attached. The worker is either a teammate with a login or a field crew member without one, and workerKind says which. Answers 'do we have dispatch on file for this job'. IT IS NOT A CREW SCHEDULE AND MUST NOT BE USED AS ONE: a slip records that somebody WAS dispatched, never that they are on site today or tomorrow. A slip row with no document attached proves nothing in an audit, the same distinction wage_determinations makes.",
    input_schema: jobFilter,
  },
  {
    name: "crew_schedule",
    // /schedule, which lib/permissions.test.ts records as open: "Job start
    // dates and who is assigned. No money on it, and everyone needs to know
    // where they are working." Writing the schedule is MANAGE_FIELD; reading
    // it takes the page's own gate, per the rule every row here follows.
    capability: null,
    description:
      "Who is PLANNED to be on which job on which day, for the next two weeks — and, separately, planned days in the last eight weeks that nobody logged hours against. Answers 'who is on Riverside tomorrow', which crew_assignments CANNOT: that tool is a roster of everyone attached to a job and carries no date at all. A planned day with no hours is a claim about PAPERWORK and never about a person — it means nobody logged that day, not that the person did not work, and it must never be reported as the second. It also only sees days somebody actually put on the schedule, so an empty missing-hours list is not proof that every hour was logged.",
    input_schema: jobFilter,
  },
  {
    name: "experience_mod_rate",
    // /compliance. The EMR is an insurance figure a GC asks for on the same
    // prequalification form as the certificates that page holds, so it takes
    // that page's gate — not /safety's, whose OSHA log is what a bureau
    // calculates an EMR FROM, which is the confusion this tool must not make.
    capability: "MANAGE_COMPLIANCE",
    description:
      "The company's experience modification rate (EMR, mod rate) as RECORDED from the rating bureau's worksheet: the current rate — the one with the latest effective date that has started — who issued it, any rate recorded for a policy year not yet started, and the history. Answers 'what is our mod rate' and 'what EMR do we put on this prequal'. IT NEVER COMPUTES, ESTIMATES OR PROJECTS AN EMR, and neither may you: the rate comes from the bureau, and the OSHA log (safety_record) is only one input to a calculation somebody else does with payroll and loss data this app does not hold. Never derive, adjust or forecast a rate from incidents, and never state a rate that is not in this tool's result. When nothing is recorded, say it is not recorded and that the figure comes from the carrier or broker. `currentIsPastItsPolicyYear` means the newest rate on file is from a policy year that has ended — say so rather than presenting it as this year's rate.",
    input_schema: noInput,
  },
  {
    name: "needs_attention",
    // /alerts, which lib/permissions.test.ts records as open with its
    // CONTENT filtered per person by lib/alerts-query.ts. This tool calls
    // that same loader with the asker's principal, so it is open for the
    // same reason and filtered by the same code.
    capability: null,
    description:
      "Everything with a date on it that nobody has dealt with, worst first — the same list as the Alerts page and the bell: cover about to lapse, backcharges nobody has answered, retainage now collectable, closeout packages the GC is sitting on, certified payroll owed, RFIs and submittals past their dates, drawing revisions not received, lien deadlines, follow-ups due, jobs forecast over contract. Answers 'what needs my attention today' and 'what's overdue'. Filtered to what THIS person may see, with money figures removed where their access does not include them. It only sees dates somebody has recorded, so an empty list means nothing recorded is due, never that nothing is; items the person silenced are counted separately and are not in the list. For one job's RFIs, submittals or punch list in detail, use that job's own tool.",
    input_schema: noInput,
  },
  {
    name: "contact_lookup",
    // /contacts, open: "names and phone numbers are not a tier". The PEOPLE
    // at an account render inside /contacts/[id]'s MANAGE_ESTIMATING branch,
    // and the handler withholds them on exactly that check — which is why
    // this row is null and the handler, not this field, carries the gate.
    capability: null,
    description:
      "Phone number, email and address for a GC, client, vendor or other account on this company's contacts list, and the individual people recorded at it with their titles, phones and emails. Answers 'what's the number for the PM at Halvorsen' and 'what's Dana's email'. Returns every person at a matching account with the title as typed ('PM', 'Project Manager', 'Super') — read the titles rather than assuming one. Individual people are shown only to someone with estimating access, as on the contact's own page; `peopleWithheld` says when they were not searched. It knows only what has been entered here, and never guesses a number.",
    input_schema: contactNameFilter,
  },
  {
    name: "job_overview",
    // /jobs/[id], open with its money branch withheld per person. The
    // handler gates each section on the capability its own tool takes,
    // before reading it.
    capability: null,
    description:
      "One job at a glance: its status, GC and scheduled dates; contract value, billed to date, cost to date and percent complete; and how many RFIs are open (and past their response date), punch items are open and change orders are pending or awaiting the GC. Answers 'how's Riverside looking' and 'give me the rundown on Maple'. Every figure comes from the same calculation as job_margin, open_rfis, open_punch_list and change_order_status — use those for the detail behind a count. IT HOLDS NO RECEIVABLES AND NO RETAINAGE: what the GC still owes on this job, how overdue any of it is, and what is being held back are NOT in this result, and billedToDate is not one of them — it is what was invoiced, not what was paid. So 'how is this job doing' in the money sense is this tool AND receivables, read together; add retainage_held when they ask what the GC is sitting on. Sections the person's access does not include are listed in `withheldFromYou` and must be described as withheld, never as zero. Needs one job: if several match, ask which.",
    input_schema: oneJob,
  },
  {
    name: "getting_started",
    // /dashboard is open. The STEPS are filtered per person by the card's own
    // lib/getting-started.ts, handed the asker's principal, so each step's
    // page is one this person can open — the same rule that keeps it off
    // their card.
    capability: null,
    description:
      "The Getting started checklist from the dashboard — the same steps, for this company and for THIS person: name the company, add the first job, bring in a spreadsheet or Jobber (optional), add the crew, put someone on the schedule, log the first day on site, connect QuickBooks (optional). Each step comes back done or not, what it means in the card's own words, its page, and `askCanDo` when a confirm-card command can do it for this person. Steps this person cannot do are left out, exactly as on their card — never call those done. Call this for 'help me finish getting started', 'what's left to set up', 'walk me through setup', or 'complete the get-started list', from ANY page. Answer by saying what is done in one line, then one bullet per OPEN step: when `askCanDo` is set, offer to do it and ask for exactly its `needsFromPerson` (call that command only once they have given it, one per question); otherwise give the step's page to do it there. Renaming the company, inviting people, importing a spreadsheet or Jobber, and connecting QuickBooks are done on their pages — never claim to have done them. `hiddenOnDashboard` true means they hid the card; mention it only if asked where the card went.",
    input_schema: noInput,
  },
  {
    name: "app_help",
    // No single page: the pages this tool may name are filtered per person
    // INSIDE the handler (reachableWalkthroughs, the same rule canReach()
    // states for the nav), not by this field. A FIELD member asking "how
    // do I" must never be taught a billing page's own steps just because
    // this tool has no one page to gate on — that is exactly the mistake
    // `capability` on every other tool here exists to prevent, at the
    // level this tool actually varies.
    capability: null,
    description:
      "How to DO something inside the app, from its own registered 'Walk me through this page' walkthroughs — never a fact about this company's data. Answers 'how do I log a backcharge', 'where do I add a punch list item', 'how do I connect QuickBooks'. Cites the page and quotes its own steps. Filtered to pages this person can actually open — a page they cannot reach is never named, and never invents a step the app does not have. `route` is always a path that opens; say exactly it and never a path of your own, and never one containing square brackets. When a result carries `insideOneJob`, its `route` is the list to START from and NOT the page — that page lives inside one job, so say to open the job from `route` first and then the tab named in `page` (\"A job — billing\" is the Billing tab). NOT for a question about the company's own records — a number, a list, a status, an amount: use the tool that reads that data instead, never this one. If nothing in the app's own walkthroughs matches, say so rather than guessing at a page.",
    input_schema: appHelpFilter,
  },

  /* ─── the bid and the takeoff ─────────────────────────────────────────
   *
   * Seven tools over the thirteen estimating features of 22-26 September.
   * Every one of them reuses the library the screen renders through, and
   * three of them exist mainly to REFUSE well: the strongest thing
   * `takeoff_currency` may ever say is "this was measured off Rev 2, and Rev
   * 3 has since been issued", `bid_levelling` will not call a quote lowest
   * without saying what it leaves out, and `conceptual_estimate` returns a
   * range with its sample size or nothing at all.
   */
  {
    name: "takeoff_currency",
    // The job's Takeoff tab, hard-gated on VIEW_JOB_COSTS (issue #383).
    capability: "VIEW_JOB_COSTS",
    description:
      "Whether the quantities measured off a drawing on a job came off drawings that are still current. Per measured plan: the revision label and issue date printed on the sheet, how many measurements were taken off it, whether anything has been ISSUED SINCE (a drawing revision on the job, or an addendum on the linked bid that changed work already priced), and the sentence the screen shows. Answers 'am I bidding off superseded drawings' and 'which of my numbers need re-checking'. IT NEVER RE-MEASURES AND NEVER RE-QUANTIFIES, and neither may you: the app cannot see what moved on the new sheet, so a corrected quantity would be a guess printed beside real measurements. Report what is suspect and say to go and look. A plan with no issue date recorded is UNKNOWABLE, not current — say exactly that, because it cannot be shown to be superseded and cannot be shown to be current either. This is NOT drawing_currency, which reads the job's drawing register — the architect's issued sets and what has reached the trailer. This reads the sheet somebody measured.",
    input_schema: jobFilter,
  },
  {
    name: "wall_schedule",
    // The job's Estimate tab, which withholds its content on VIEW_JOB_COSTS.
    capability: "VIEW_JOB_COSTS",
    description:
      "The wall schedule on a job being estimated: each wall run's length and height meeting its wall type, turned into studs, track, board, insulation and the labor hours those carry — summed per wall-type component the way an estimate reads ('W2 — 5/8\" Type X board: 4,260 sq ft'). Answers 'how much board on Riverside' and 'how many studs are we carrying'. Every quantity comes back computed, including waste and the round-up on whole sheets and studs. A run with NO HEIGHT of its own on a type with no default height produces no quantities at all and is listed in unpricedRuns — say which runs those are rather than treating them as zero, because a guessed ten feet is a number that looks right and gets bid. Only jobs still at ESTIMATE stage carry a wall schedule on screen; after award the runs are the record the contract was priced from and are changed by change order, so this does not answer for a contracted job. It does not know what a component costs — that is the estimate itself (estimate_detail) and the marked-up bid (bid_recap).",
    input_schema: jobFilter,
  },
  {
    name: "bid_levelling",
    // /bids
    capability: "MANAGE_ESTIMATING",
    description:
      "The quotes collected for one bid, laid side by side per scope package: who quoted what, cheapest and dearest, the spread, whether the quotes are COMPARABLE, and the caution naming what the cheapest one excludes that the others do not. Answers 'are these three quotes actually the same bid' and 'who is lowest on framing'. NEVER PRESENT THE LOW NUMBER AS THE ANSWER when `comparable` is false: read the `caution` out, because a sub who left the soffits out is cheaper and is not comparable, and a total that ignores that buys a hole in your own scope. A request nobody has answered is NOT a quote of nothing — those are in `outstanding` with the state of each (awaited, overdue, declined) and are deliberately absent from the comparison, so say the comparison is incomplete when any are open. With one quote `comparable` is null, which means nothing to compare against, never that it is fine. It does not price the excluded work back on, and neither may you: that number would be this app's guess at somebody else's scope.",
    input_schema: bidProjectFilter,
  },
  {
    name: "bid_compliance",
    // /bids
    capability: "MANAGE_ESTIMATING",
    description:
      "What would get a bid thrown out before anybody reads the price: addenda not acknowledged, alternates with no amount, unit prices with no rate, allowances with no sum, and the things only a person can attest to (bid bond, signed bid form, subcontractor list, insurance certificate, prequalification, participation forms) that are not recorded as done. Answers 'is my bid responsive' and 'what's left before I can send this'. THERE IS NO COMPLIANT VERDICT HERE AND YOU MUST NOT INVENT ONE. The strongest sentence available is `sentence`, which says nothing is outstanding THAT THIS APP CAN SEE — it has never read the GC's own Invitation to Bid, only what somebody typed in from it. Never say a bid is compliant, complete or ready to submit. `blockingCount` is the items that would actually sink it; an optional one outstanding is worth mentioning and is not non-responsiveness. `repriceWarnings` is a different thing again: an addendum that changed work already priced means a number may now be wrong, not that paperwork is missing.",
    input_schema: bidProjectFilter,
  },
  {
    name: "bid_alternates",
    // /bids
    capability: "MANAGE_ESTIMATING",
    description:
      "A bid's alternates, unit prices and allowances, and what the bid comes to with them: the base bid as entered, each alternate as an ADD or a DEDUCT with whether the GC has accepted it, the awarded total (base plus ACCEPTED alternates only), the allowances CARRIED INSIDE the base, and the unit prices held. Answers 'what are we at with the alternates in' and 'what unit prices did we give them'. NEVER ADD AN ALLOWANCE TO THE BASE — it is already inside it, and doing so sends a bid out high by exactly that amount with nothing on screen looking wrong. Never add unit prices to anything: a unit price is a rate for future change work and has no quantity, so it belongs to no total. Use `awardedTotal` and `alternatesAccepted` as given rather than working anything out; `undecidedCount` above zero means the award total is provisional and you should say so. For whether a blank alternate or unit price makes the bid non-responsive, that is bid_compliance.",
    input_schema: bidProjectFilter,
  },
  {
    name: "bid_recap",
    // The job's Estimate tab, which withholds its content on VIEW_JOB_COSTS.
    capability: "VIEW_JOB_COSTS",
    description:
      "The bid recap on a job being estimated: direct cost split by material, labor, subcontractor and other, then every step from there to the number the GC is asked to pay — markup per cost type, escalation, sales tax on material, overhead, profit, bond premium, contingency — each with the rate it used, what it added and the running total, ending at `bidTotal`. Answers 'what are we bidding Riverside at' and 'what does that come to with overhead and profit'. THE ORDER OF THOSE STEPS CHANGES THE BID and is already applied — read `steps` and `bidTotal` as given and never re-derive, re-order or recompute any of it. A rate nobody entered contributes nothing and its step is simply absent, which is not a zero somebody typed. Lines with NO COST TYPE are never marked up: `uncategorised` and `uncategorisedLineCount` say how much of the bid went through this layer untouched, and that must be reported rather than folded in silently. `appliedAt` means the recap was spread into the line prices; without it the bid total is a working figure the estimate lines do not yet show. Only a job still at ESTIMATE stage has a recap on screen.",
    input_schema: jobFilter,
  },
  {
    name: "conceptual_estimate",
    // /pipeline, where the helper sits beside a pursuit's estimated value.
    capability: "MANAGE_ESTIMATING",
    description:
      "What this company's OWN finished work has run at per square foot, for pricing something with no drawings and no takeoff yet — a range (low, middle, high) for what similar work SOLD for and what it COST, with the number of finished jobs behind it, optionally multiplied out by a gross area the person gives. Answers 'what has similar work run at' and 'roughly what would a 40,000 SF office fit-out be'. IT NEVER RETURNS A SINGLE NUMBER AND YOU MUST NEVER STATE ONE: give the range and say how many jobs it came from, every time. Below three finished jobs carrying a gross area there is NO range at all — `because` says why, and that sentence is the whole answer. This is an order-of-magnitude figure from gross area, not an estimate and not a price to send anybody; say so. It is drawn only from this company's finished jobs, never a published index, and it must not be summed with, compared against or presented beside a line-item estimate (estimate_detail, bid_recap) — those are a different kind of claim. Nothing here is written anywhere.",
    input_schema: grossAreaFilter,
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
    topic: "who ACTUALLY showed up on a day, as opposed to who was planned",
    why: "attendance is not recorded anywhere. crew_schedule holds who was PLANNED and TimeEntry holds hours somebody logged; neither is a register. A planned day with no hours means nobody logged it — never that the person was absent, which is a claim about a man rather than about paperwork.",
  },
  {
    topic: "where a machine physically is",
    why: "equipment is assigned to a job, not tracked. There is no GPS or telematics feed.",
  },
  {
    topic: "what tools or materials to load for a job",
    why: "nothing records what a job needs from the shop.",
  },
  /* "a vendor's recent price change" WAS HERE AND WAS FALSE — removed
   * 2026-09-26. Its reason read "the catalog records what work has cost, not
   * a vendor's price list over time", and `VendorPriceQuote` is a quote
   * history: `priceMovement()` (components/vendorPricing.ts) computes the
   * change between a vendor's last two quotes for an item and /vendors/pricing
   * renders it under "Movement". `vendor_pricing` now returns that figure.
   *
   * This list is INJECTED INTO THE SYSTEM PROMPT, so a stale entry here is
   * not a stale comment — it is a standing instruction to refuse a question
   * the product answers on screen, and it cost `job_margin` a matching false
   * sentence ("there is no vendor price history"). The EMR note further down
   * says the same thing about the same mistake; this is the second time.
   * Before adding a gap, and before leaving one, check the screen. */
  {
    topic: "who signed the safety talk",
    why: "the attendee roster is free text and the signature sheet is a photo, so a talk can be shown as logged but individual sign-off cannot be confirmed from the data.",
  },
  {
    topic: "driving directions or travel time",
    // HALF OF THIS REASON WENT STALE and was corrected 2026-09-26: it said
    // "job addresses are not modelled as coordinates", and they are —
    // `Job.siteLatitude`/`siteLongitude`, geocoded when the site address is
    // saved so a daily report can look up that day's weather. The gap is
    // real and the conclusion never changed; only the argument for it was
    // false, which is the version a model would have repeated.
    why: "there is no routing, distance or travel-time calculation anywhere in this app, and no tool returns a job's address. A job's site address IS recorded and geocoded to coordinates (for a daily report's weather), so do not say addresses are not held — say there is nothing here that measures a journey, and never estimate one.",
  },

  /* ─── the gaps the hundred-question census left standing ───
   *
   * Each one was asked, routed to nothing, and — this is the part that
   * makes them belong HERE rather than only in the census — each has a
   * tool that would answer it in the right SHAPE and the wrong substance.
   * A gap does not fail as silence. It fails as a confident near-miss in
   * the same voice as a fact, and the only thing standing between a
   * near-miss and a person acting on it is the model having been told.
   *
   * The payroll-cash question was already at the top of this list and is
   * the reason the list exists.
   *
   * The experience modification rate WAS here, and was removed when it
   * stopped being a gap: it is recorded on /compliance and answered by
   * `experience_mod_rate`. Leaving it would have told the model to refuse a
   * question it can now answer — this list is injected into the system
   * prompt. The reason it was a gap still governs the tool: the rate is
   * recorded from the bureau and never derived from the OSHA log. */
  {
    topic: "whether a job will finish on time, or a forecast completion date",
    why: "nothing forecasts a date. `schedule_status` says where a job stands against the dates somebody entered, which is as far as the data goes. Percent complete is COST-based — money spent against money expected — and a job can be 80% through its budget and nowhere near 80% through its schedule.",
  },
  {
    topic: "who is clocked in right now, or who has not clocked out",
    why: "a running clock lives only on the worker's phone until they clock out — the server stores an interval once it is CLOSED, as a time entry with its clock-in and clock-out times. So nothing here knows who is on the clock at this moment. crew_schedule says who was PLANNED on a day; it is not who clocked in, and must not be read as one.",
  },
  {
    topic: "what a person is paid an hour",
    why: "there is no per-person pay rate here, by design. A rate belongs to a CRAFT CLASSIFICATION and the fringe schedule in force on a given date — which is why job_labor_cost prices an hour rather than a person, and why the same man on two crafts in one week costs two different amounts. Say that, and name the crafts he has worked under (team_roster has them) rather than refusing flat: the classification and its schedule are where the number actually lives.",
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
