import type { AskToolDefinition } from "@prova/integrations";
import { money } from "@/lib/money";
import { formatHours } from "@/lib/render-hours";

/**
 * THE CALCULATOR: the one place Ask is allowed to produce a figure no tool
 * returned, and the reason it is allowed is that the model does not compute
 * it — TypeScript does.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS AT ALL
 *
 * `answer.ts`'s system prompt says "Never do arithmetic. Not addition, not
 * percentages, not differences, not 'roughly'", and that rule STAYS. It is
 * right twice over. The app already computes every figure it shows, in the
 * same libraries the pages render from, so a model that computes one too
 * creates a second source of truth that can disagree with the screen — the
 * #46/#97 scar, two retainage figures eighteen inches apart. And a model's
 * arithmetic can be CORRECT AND STILL MEANINGLESS: adding two retainage
 * balances taken at different withholding rates is a right sum of the wrong
 * things, and nothing about the sum itself says so.
 *
 * The cost of the rule was that "what do Turner and Halvorsen owe us
 * between them?" — an ordinary question — got "that is not available",
 * which makes the assistant look stupid about its own data. So the answer
 * is not to loosen the prompt. It is to move the addition into code.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE TRAP, AND THE SHAPE THAT AVOIDS IT
 *
 * A calculator that accepts NUMBERS from the model is a laundry. The model
 * types `48400`, the tool returns `48400` as a computed result, and an
 * invented figure has been given a tool's authority — defeating both the
 * prompt rule and the number-provenance guard (#462), which asks only
 * whether a figure appears in some tool result.
 *
 * So this tool takes REFERENCES, never values. The model names a figure by
 * its PATH in a tool result it has already been handed this turn —
 * `receivables.rows[0].outstanding` — and nothing it types is a number.
 * There is no operand for it to invent, because operands are not numbers in
 * this schema at all.
 *
 * The alternative shape — let the model pass values and refuse any that
 * does not appear in a prior tool result — was rejected for a reason worth
 * writing down, because it is not merely "references are stricter":
 *
 *   A VALUE MATCH CANNOT TELL YOU WHICH FIELD IT MATCHED, SO IT CANNOT TELL
 *   YOU THE KIND. `8` appears in a tool result as a count of invoices, as a
 *   day of the month, as 8 hours and as $8.00. A validator that says "yes,
 *   8 is in the rows" has licensed adding a count to a dollar amount. The
 *   refusal this tool most needs to make — dollars are not hours, a rate is
 *   not a total — is exactly the one a value matcher is blind to. A path
 *   names one field, and a field has a kind.
 *
 * A second, smaller reason: a value matcher would be a near-duplicate of
 * `provenance.ts` on #462, and two matchers that must agree are a bug
 * waiting for the day they stop agreeing. This file shares no matching code
 * with it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * HOW THE TWO FIT TOGETHER (#462)
 *
 * #462 holds back an answer whose figures do not appear in a tool result.
 * A calculated total appears in exactly one place: this tool's own result,
 * which the executor returns like any other, so the derived figure is
 * traceable BY CONSTRUCTION. That is not a coincidence to be reconciled
 * later — it is why the calculator is a tool rather than a post-processing
 * step on the answer text.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * KINDS, AND THE HONEST LIMIT ON THEM
 *
 * Tool results are plain JSON. There is no type information in them: a
 * money figure and a count of days are both `number`, and the only thing
 * distinguishing them is the FIELD NAME somebody chose in `handlers.ts`.
 *
 * Deriving a kind from a name by pattern was tried on paper and thrown out.
 * `job_labor_cost`'s summary carries `hoursLogged` (hours) next to
 * `jobsWithHours` (a count of jobs), and any rule that reads "hours" out of
 * the first reads it out of the second — which licenses adding a job count
 * to a number of hours and calling it hours. A wrong kind is worse than no
 * kind, because it produces a confident number.
 *
 * So the rule here is the narrowest one that can be defended: A FIGURE IS
 * COMBINABLE ONLY IF IT IS IN `COMBINABLE` BELOW, BY EXACT TOOL AND EXACT
 * FIELD NAME, with its kind written down by a person who read the handler.
 * Everything else refuses and says so. The table covers the nine tools that
 * return money and hours; it is small on purpose and grows by someone
 * reading a handler, never by a pattern widening on its own.
 *
 * The direction of the default is the point: an unlisted field costs an
 * answer, a guessed kind costs a wrong number in front of a GC.
 * `calculator.test.ts` checks every entry's field name still appears in
 * `handlers.ts`, so a rename fails the build rather than silently emptying
 * the table.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * A CANONICAL FIGURE ALWAYS WINS
 *
 * Where the app already computes a total in code — `loadRetainageHeld`,
 * the cash-flow forecast's AR outstanding, `job_labor_cost`'s own summary —
 * that total is the answer and this tool must not produce a second one.
 * `CANONICAL` below refuses a sum that covers EVERY row of a field with a
 * canonical total, and names the figure to use instead. A SUBSET of those
 * rows — two GCs out of five — is not a canonical question and is exactly
 * what this tool is for. That line, whole population versus subset, is the
 * whole of the rule and it is checkable rather than a matter of taste.
 */

// ─────────────────────────────────────────────────────────────────────────
// The ledger: every number the model was actually handed this turn.
// ─────────────────────────────────────────────────────────────────────────

export type FigureKind = "money" | "hours" | "days" | "count";

/** One number in one tool result, at the path the model can name it by. */
export type Figure = {
  /** `receivables.rows[0].outstanding` — what the model passes. */
  path: string;
  /** The ledger root it came from: `receivables`, or `receivables#2` for a
   * second call to the same tool in one turn. */
  root: string;
  /** The tool's real name, without the `#2`. */
  tool: string;
  /** The last key in the path: `outstanding`. */
  field: string;
  /** The row index, when the figure sits inside a `rows` array. Null for a
   * summary figure or anything else. Used only by the canonical check. */
  row: number | null;
  value: number;
};

/** What `record` reports about its own walk. The SIZE half of the
 * derived-set rule: a walker that stops matching returns an empty ledger,
 * and nothing is ever missing from an empty ledger. `registered` must
 * always equal `numbers`, which is counted by a different mechanism
 * entirely — `JSON.parse`'s own reviver, which cannot drift with the walk
 * below because it is not this code. `calculator.test.ts` asserts it. */
export type RecordReport = { root: string; registered: number; numbers: number };

/** Counts numeric leaves using the platform's JSON parser rather than the
 * walk below, so the two cannot break together. */
export function countNumbers(json: string): number {
  let seen = 0;
  JSON.parse(json, (_key, value) => {
    if (typeof value === "number" && Number.isFinite(value)) seen += 1;
    return value;
  });
  return seen;
}

function walk(node: unknown, path: string, visit: (path: string, field: string, value: number) => void): void {
  if (Array.isArray(node)) {
    node.forEach((item, index) => walk(item, `${path}[${index}]`, visit));
    return;
  }
  if (typeof node === "object" && node !== null) {
    for (const [key, value] of Object.entries(node)) walk(value, `${path}.${key}`, visit);
    return;
  }
  if (typeof node === "number" && Number.isFinite(node)) {
    const dot = path.lastIndexOf(".");
    visit(path, dot === -1 ? path : path.slice(dot + 1), node);
  }
}

/** `receivables.rows[3].outstanding` -> 3. Null when the figure is not
 * inside a `rows` array. */
function rowIndexOf(path: string): number | null {
  const match = /\.rows\[(\d+)\]\./.exec(path);
  return match ? Number(match[1]) : null;
}

/**
 * Everything the model was handed this turn, addressable.
 *
 * Built from the CONTENT STRING the executor returned — not from
 * `result.data` — for the same reason `provenance.ts` reads content: the
 * model can only reference what it was shown, and a ledger richer than the
 * prompt would resolve paths the model could not have read.
 */
export class FigureLedger {
  private readonly figures = new Map<string, Figure>();
  private readonly seenRoots = new Map<string, number>();

  /** Registers one tool result. Returns the walk's own accounting. */
  record(toolName: string, content: string): RecordReport {
    const times = (this.seenRoots.get(toolName) ?? 0) + 1;
    this.seenRoots.set(toolName, times);
    const root = times === 1 ? toolName : `${toolName}#${times}`;

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      // A tool that answered in prose rather than JSON ("A card is in front
      // of the person") holds no figures. Not an error.
      return { root, registered: 0, numbers: 0 };
    }

    let registered = 0;
    walk(parsed, root, (path, field, value) => {
      registered += 1;
      this.figures.set(path, { path, root, tool: toolName, field, row: rowIndexOf(path), value });
    });
    return { root, registered, numbers: countNumbers(content) };
  }

  get(path: string): Figure | undefined {
    return this.figures.get(path);
  }

  /** Every path, in the order they were registered. */
  paths(): string[] {
    return [...this.figures.keys()];
  }

  size(): number {
    return this.figures.size;
  }

  /** Every path registered for one root and field that sits inside `rows` —
   * the whole population, for the canonical check. */
  rowPathsFor(root: string, field: string): string[] {
    return [...this.figures.values()]
      .filter((figure) => figure.root === root && figure.field === field && figure.row !== null)
      .map((figure) => figure.path);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// What may be combined, by exact tool and exact field.
// ─────────────────────────────────────────────────────────────────────────

/** A field name that means the same thing in every rowed tool result:
 * `forModel` adds it, and it is a count of rows. */
const UNIVERSAL_COUNT = "count";

/**
 * Every figure this tool will touch, read out of `handlers.ts` one handler
 * at a time. `tool` is the tool name; `field` is the exact key.
 *
 * Nothing is here by pattern. If a figure is not listed, `calculate`
 * refuses it and says which field it refused — see the header for why that
 * default points the way it does.
 */
export const COMBINABLE: { tool: string; field: string; kind: FigureKind }[] = [
  // receivables — what each GC still owes, net of retainage.
  { tool: "receivables", field: "amount", kind: "money" },
  { tool: "receivables", field: "paid", kind: "money" },
  { tool: "receivables", field: "retainageWithheld", kind: "money" },
  { tool: "receivables", field: "outstanding", kind: "money" },
  { tool: "receivables", field: "daysOverdue", kind: "days" },
  { tool: "receivables", field: "outstandingInvoiceCount", kind: "count" },
  { tool: "receivables", field: "overdueInvoiceCount", kind: "count" },
  { tool: "receivables", field: "notYetDueInvoiceCount", kind: "count" },

  // retainage_held — withheld and not yet released.
  { tool: "retainage_held", field: "withheldToDate", kind: "money" },
  { tool: "retainage_held", field: "releasedToDate", kind: "money" },
  { tool: "retainage_held", field: "stillHeld", kind: "money" },
  { tool: "retainage_held", field: "companyWideStillHeld", kind: "money" },
  { tool: "retainage_held", field: "jobsHoldingRetainage", kind: "count" },
  { tool: "retainage_held", field: "jobsWithNoCompletionDate", kind: "count" },

  // job_margin — per job. `percentComplete` and the two coverage shares are
  // deliberately absent: they are formatted STRINGS in the handler (issue
  // #103), so they never reach the ledger, and a percentage is not
  // something to add up anyway.
  { tool: "job_margin", field: "contractValue", kind: "money" },
  { tool: "job_margin", field: "costToDate", kind: "money" },
  { tool: "job_margin", field: "forecastCostAtCompletion", kind: "money" },
  { tool: "job_margin", field: "earnedRevenue", kind: "money" },
  { tool: "job_margin", field: "billedToDate", kind: "money" },
  { tool: "job_margin", field: "overUnderBilling", kind: "money" },
  { tool: "job_margin", field: "forecastVarianceAgainstContract", kind: "money" },

  // job_labor_cost — hours and burdened dollars, per job and company-wide.
  { tool: "job_labor_cost", field: "hoursLogged", kind: "hours" },
  { tool: "job_labor_cost", field: "hoursPriced", kind: "hours" },
  { tool: "job_labor_cost", field: "hoursNotPriced", kind: "hours" },
  { tool: "job_labor_cost", field: "burdenedLaborCost", kind: "money" },
  { tool: "job_labor_cost", field: "wageCost", kind: "money" },
  { tool: "job_labor_cost", field: "allowanceCost", kind: "money" },
  { tool: "job_labor_cost", field: "jobsWithHours", kind: "count" },

  // cash_flow_forecast — the company totals. `months` and `agingByBucket`
  // are left out: their fields were not read for this table, and an unread
  // field is an unknown kind.
  { tool: "cash_flow_forecast", field: "arOutstanding", kind: "money" },
  { tool: "cash_flow_forecast", field: "retainageOutstanding", kind: "money" },
  { tool: "cash_flow_forecast", field: "overdueNow", kind: "money" },
  { tool: "cash_flow_forecast", field: "retainageWithNoCompletionDate", kind: "money" },

  // change_order_status — the value delta a change order carries.
  { tool: "change_order_status", field: "value", kind: "money" },

  // backcharge_exposure
  { tool: "backcharge_exposure", field: "claimedAmount", kind: "money" },
  { tool: "backcharge_exposure", field: "openClaimedTotal", kind: "money" },
  { tool: "backcharge_exposure", field: "backcharges", kind: "count" },
  { tool: "backcharge_exposure", field: "openBackcharges", kind: "count" },

  // pay_application_status
  { tool: "pay_application_status", field: "amount", kind: "money" },
  { tool: "pay_application_status", field: "awaitingApprovalTotal", kind: "money" },
  { tool: "pay_application_status", field: "disputedTotal", kind: "money" },
  { tool: "pay_application_status", field: "daysSinceIssued", kind: "days" },
  { tool: "pay_application_status", field: "applications", kind: "count" },
  { tool: "pay_application_status", field: "awaitingApproval", kind: "count" },
  { tool: "pay_application_status", field: "disputed", kind: "count" },

  // unbilled_change_orders
  { tool: "unbilled_change_orders", field: "addedValue", kind: "money" },
  { tool: "unbilled_change_orders", field: "billedToDate", kind: "money" },
  { tool: "unbilled_change_orders", field: "unbilled", kind: "money" },
  { tool: "unbilled_change_orders", field: "daysSinceApproved", kind: "days" },
];

const COMBINABLE_BY_KEY = new Map(COMBINABLE.map((entry) => [`${entry.tool}.${entry.field}`, entry.kind]));

export function kindOf(tool: string, field: string): FigureKind | null {
  if (field === UNIVERSAL_COUNT) return "count";
  return COMBINABLE_BY_KEY.get(`${tool}.${field}`) ?? null;
}

/**
 * Where the app already owns a whole-population total. Keyed by the ROW
 * field a naive sum would walk; the value names the figure that wins and
 * says where it comes from, because "use this instead" without a reason is
 * an instruction nobody follows.
 */
export const CANONICAL: { tool: string; field: string; instead: string; why: string }[] = [
  {
    tool: "receivables",
    field: "outstanding",
    instead: "the cash_flow_forecast tool's arOutstanding",
    why: "the company's total AR is computed by lib/cash-flow.ts, which is what /cash-flow shows",
  },
  {
    tool: "retainage_held",
    field: "stillHeld",
    instead: "retainage_held's own companyWideStillHeld",
    why: "loadRetainageHeld is the single source for retainage held (issue #97) and is already in that result",
  },
  {
    tool: "job_labor_cost",
    field: "burdenedLaborCost",
    instead: "job_labor_cost's own burdenedLaborCost outside the rows",
    why: "that tool already totals burdened labor cost across every job it returned",
  },
  {
    tool: "job_labor_cost",
    field: "hoursLogged",
    instead: "job_labor_cost's own hoursLogged outside the rows",
    why: "that tool already totals hours across every job it returned",
  },
];

const CANONICAL_BY_KEY = new Map(CANONICAL.map((entry) => [`${entry.tool}.${entry.field}`, entry]));

// ─────────────────────────────────────────────────────────────────────────
// Arithmetic, in integers.
// ─────────────────────────────────────────────────────────────────────────

/**
 * The unit each kind is counted in, so every sum is integer arithmetic and
 * the ONE rounding happens on the way out.
 *
 * Money is cents because `0.1 + 0.2` is `0.30000000000000004` and this is a
 * figure somebody sends a GC. Hours are hundredths because `TimeEntry.hours`
 * is `Decimal(5,2)` — the same reasoning `lib/render-hours.ts` gives for
 * rounding to two places: the column's own precision cannot lose an entered
 * figure, it can only remove digits a float sum invented.
 */
const SCALE: Record<FigureKind, number> = { money: 100, hours: 100, days: 1, count: 1 };

function display(value: number, kind: FigureKind): string {
  switch (kind) {
    case "money":
      return money(value);
    case "hours":
      return `${formatHours(value)} ${value === 1 ? "hour" : "hours"}`;
    case "days":
      return `${value} ${value === 1 ? "day" : "days"}`;
    case "count":
      return String(value);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// The tool.
// ─────────────────────────────────────────────────────────────────────────

export const CALCULATE_TOOL_NAME = "calculate";

export const OPERATIONS = ["sum", "difference", "percentage_of", "average", "count"] as const;
export type Operation = (typeof OPERATIONS)[number];

/** A hard ceiling on operands, in the spirit of `forModel`'s row cap: a
 * request naming two hundred paths is a confused loop, not a question. */
export const MAX_FIGURES = 40;

export const CALCULATE_TOOL: AskToolDefinition = {
  name: CALCULATE_TOOL_NAME,
  description: `Adds, subtracts, averages, counts or takes a percentage of figures a tool has ALREADY returned in this conversation. The arithmetic runs in code, not in your head — this is the only way you may produce a figure no tool returned.

You do not pass numbers. You pass the PATH of a figure inside a tool result you have already been given, exactly as the JSON is shaped: the tool's name, then the keys, e.g. receivables.rows[0].outstanding, retainage_held.rows[2].stillHeld, job_margin.rows[0].contractValue, cash_flow_forecast.arOutstanding. If you call the same tool twice in one question, the second result is receivables#2. A path that is not in this conversation's tool results is refused, and the refusal lists the paths that are.

figures: the paths to combine, separated by commas. For sum, average and count, two or more (count takes one or more). For difference, exactly two, first minus second. For percentage_of, exactly two: the part first, then the whole.

It refuses to combine figures of different kinds — dollars with hours, a count with an amount — and refuses fields it does not have a kind for.

DO NOT USE IT WHEN A TOOL ALREADY HAS THE TOTAL. Company-wide AR is cash_flow_forecast's arOutstanding. Company-wide retainage is retainage_held's companyWideStillHeld. Total hours and total burdened labor cost are in job_labor_cost's own result outside its rows. Every rowed result carries a count. Those figures come from the code that draws the screens, so they win — call the tool that has one rather than adding its rows up here. This tool is for a SUBSET the app does not total for you: two GCs out of five, three jobs out of nine, one job against another.`,
  input_schema: {
    type: "object",
    properties: {
      operation: {
        type: "string",
        enum: [...OPERATIONS],
        description:
          "sum, difference (first minus second), percentage_of (the first as a percentage of the second), average, or count (how many of the figures you named).",
      },
      figures: {
        type: "string",
        description:
          "The paths of the figures to combine, separated by commas — e.g. 'receivables.rows[0].outstanding, receivables.rows[3].outstanding'. Never a number.",
      },
    },
    required: ["operation", "figures"],
  },
};

/** A refusal the model should report and stop on. */
type Unavailable = { unavailable: string };
/** A refusal the model can recover from by calling again. */
type Problem = { problem: string; instruction: string; availableFigures?: string[] };

export type CalculationResult = {
  operation: Operation;
  /** The figure to say, formatted the way the pages format it. */
  result: string;
  resultValue: number;
  kind: FigureKind | "percent";
  /** "$30,000.00 + $18,400.00 = $48,400.00" — the answer showing its work. */
  working: string;
  operands: { path: string; tool: string; field: string; display: string }[];
  instruction: string;
};

export type CalculateOutcome = CalculationResult | Unavailable | Problem;

/** The paths offered back on a miss. Bounded: a turn that read four rowed
 * tools holds hundreds, and a wall of them is not help. */
const MAX_SUGGESTED_PATHS = 60;

function suggest(ledger: FigureLedger): string[] {
  return ledger
    .paths()
    .filter((path) => {
      const figure = ledger.get(path);
      return figure !== undefined && kindOf(figure.tool, figure.field) !== null;
    })
    .slice(0, MAX_SUGGESTED_PATHS);
}

function parsePaths(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * Runs one `calculate` call against this turn's ledger.
 *
 * Pure: it reads the ledger and returns an outcome. No database, no clock,
 * no company scope — it cannot reach anything the model was not already
 * shown, which is why it needs no capability of its own.
 */
export function calculate(ledger: FigureLedger, input: unknown): CalculateOutcome {
  const raw = (input ?? {}) as Record<string, unknown>;
  const operation = raw.operation;
  if (typeof operation !== "string" || !OPERATIONS.includes(operation as Operation)) {
    return {
      problem: `calculate has no operation called ${JSON.stringify(operation ?? null)}.`,
      instruction: `Call it again with operation set to one of: ${OPERATIONS.join(", ")}.`,
    };
  }
  const op = operation as Operation;

  const paths = parsePaths(raw.figures);
  if (paths.length === 0) {
    return {
      problem: "No figures were named.",
      instruction:
        "Pass `figures` as the comma-separated paths of figures from tool results in this conversation. Never numbers.",
      availableFigures: suggest(ledger),
    };
  }
  if (paths.length > MAX_FIGURES) {
    return {
      unavailable: `That is more than ${MAX_FIGURES} figures at once. Ask about a shorter list.`,
    };
  }

  // A duplicate path is the one way a reference schema could still inflate
  // a figure: naming the same row twice doubles it. Refused rather than
  // deduplicated, because which of the two the model meant is not knowable.
  const duplicates = paths.filter((path, index) => paths.indexOf(path) !== index);
  if (duplicates.length > 0) {
    return {
      problem: `The same figure was named more than once: ${[...new Set(duplicates)].join(", ")}.`,
      instruction: "Name each figure once. If you meant two different rows, use their two different paths.",
    };
  }

  const figures: Figure[] = [];
  for (const path of paths) {
    const figure = ledger.get(path);
    if (!figure) {
      return {
        problem: `There is no figure at ${path} in this conversation's tool results.`,
        instruction:
          "Call calculate again using paths from availableFigures, copied exactly. If the figure you want is not there, call the tool that would return it first.",
        availableFigures: suggest(ledger),
      };
    }
    figures.push(figure);
  }

  const kinds = figures.map((figure) => kindOf(figure.tool, figure.field));
  const unknownAt = kinds.findIndex((kind) => kind === null);
  if (unknownAt !== -1) {
    const figure = figures[unknownAt];
    return {
      unavailable: `I can't combine ${figure.field} — nothing records what unit that figure is in, so adding it to anything could be wrong without looking wrong. Say the figures separately instead.`,
    };
  }
  const kindSet = new Set(kinds as FigureKind[]);
  if (kindSet.size > 1) {
    const described = figures
      .map((figure, index) => `${figure.field} (${kinds[index]})`)
      .join(" and ");
    return {
      unavailable: `Those figures are not the same kind of thing: ${described}. I can't combine them.`,
    };
  }
  const kind = kinds[0] as FigureKind;

  if (op === "difference" || op === "percentage_of") {
    if (figures.length !== 2) {
      return {
        problem: `${op} needs exactly two figures; ${figures.length} were named.`,
        instruction:
          op === "difference"
            ? "Call it again with two paths: the one to subtract from first."
            : "Call it again with two paths: the part first, then the whole.",
      };
    }
  } else if (op !== "count" && figures.length < 2) {
    return {
      problem: `${op} needs at least two figures; one was named.`,
      instruction: "Name the other figures too, or just say the one figure you have.",
    };
  }

  // A canonical figure wins. Only a sum or an average over the WHOLE
  // population of a field is the canonical question; a subset is this
  // tool's job.
  if (op === "sum" || op === "average") {
    const first = figures[0];
    const canonical = CANONICAL_BY_KEY.get(`${first.tool}.${first.field}`);
    if (canonical && figures.every((figure) => figure.root === first.root && figure.field === first.field)) {
      const population = ledger.rowPathsFor(first.root, first.field);
      const named = new Set(paths);
      if (population.length > 0 && population.every((path) => named.has(path))) {
        return {
          problem: `That is every ${first.field} row, and the app already has that total: ${canonical.instead} — ${canonical.why}.`,
          instruction: `Use ${canonical.instead} instead of adding the rows up. If it is not in this conversation yet, call the tool that returns it. Use calculate only for some of the rows, not all of them.`,
        };
      }
    }
  }

  const scale = SCALE[kind];
  const scaled = figures.map((figure) => Math.round(figure.value * scale));
  const shown = figures.map((figure) => display(figure.value, kind));
  const operands = figures.map((figure, index) => ({
    path: figure.path,
    tool: figure.tool,
    field: figure.field,
    display: shown[index],
  }));
  const say = (value: number, resultKind: FigureKind | "percent") =>
    resultKind === "percent" ? `${value}%` : display(value, resultKind);

  let resultValue: number;
  let resultKind: FigureKind | "percent" = kind;
  let working: string;

  switch (op) {
    case "sum": {
      const total = scaled.reduce((running, value) => running + value, 0);
      resultValue = total / scale;
      working = `${shown.join(" + ")} = ${say(resultValue, kind)}`;
      break;
    }
    case "difference": {
      const total = scaled[0] - scaled[1];
      resultValue = total / scale;
      working = `${shown[0]} - ${shown[1]} = ${say(resultValue, kind)}`;
      break;
    }
    case "average": {
      const total = scaled.reduce((running, value) => running + value, 0);
      // ONE rounding, on the scaled total, so the average of three cents
      // figures is a cents figure and not a float.
      resultValue = Math.round(total / figures.length) / scale;
      working = `(${shown.join(" + ")}) / ${figures.length} = ${say(resultValue, kind)}`;
      break;
    }
    case "percentage_of": {
      if (scaled[1] === 0) {
        return {
          unavailable: `${figures[1].field} is zero, so there is no percentage of it to give.`,
        };
      }
      // Computed from the scaled integers, so the ratio is taken on exact
      // cents rather than on floats, then rounded once to one decimal.
      resultValue = Math.round((scaled[0] / scaled[1]) * 1000) / 10;
      resultKind = "percent";
      working = `${shown[0]} is ${resultValue}% of ${shown[1]}`;
      break;
    }
    case "count": {
      resultValue = figures.length;
      resultKind = "count";
      working = `${resultValue} of them`;
      break;
    }
  }

  return {
    operation: op,
    result: say(resultValue, resultKind),
    resultValue,
    kind: resultKind,
    working,
    operands,
    instruction:
      "Say `result` exactly as written. It was computed in code from the figures in `operands`; do not recompute it, round it or restate it in other units.",
  };
}
