import type { Principal } from "@/lib/permissions";
import type { ToolName } from "../tools";
import type { CommandName } from "../commands";
import { ACCOUNTING, ESTIMATOR, FIELD, OWNER } from "./cases";

/**
 * THE HUNDRED QUESTIONS, and a decision recorded against every one.
 *
 * Cyrus asked for "the top 100 projected most asked questions and tasks"
 * with a guarantee the assistant can execute them all. The guarantee is the
 * part worth being careful about: nobody can promise a model answers a
 * hundred questions well, and a list of a hundred questions with no check
 * against it is a wish. What CAN be made true at build time is the question
 * underneath it — **is there a capability behind each one at all** — and
 * that is what this file is.
 *
 * Every entry carries a ROUTE, and there are only four kinds:
 *
 *   - `tool` — one read tool answers it;
 *   - `command` — one write command does it, behind the confirm card;
 *   - `several` — it genuinely needs more than one tool in one answer,
 *     which the composing loop does (packages/integrations/src/ask.ts);
 *   - `gap` — NOTHING in the registry answers it, with the reason and the
 *     tool most likely to be reached for by mistake.
 *
 * There is no fifth state and no blank. `top-questions.test.ts` fails the
 * build if a question has no decision, if a route names a tool or command
 * that does not exist, if it names one the person asking is not OFFERED,
 * or if the number of gaps changes without somebody changing the declared
 * count below. **A gap is not a defect in this file; a SILENT gap is.**
 *
 * WHY THE GAPS ARE THE POINT. Thirteen of these hundred have no route, and
 * eight of those thirteen are questions about features this app ALREADY
 * HAS — certified payroll, the sales pipeline, T&M tickets, the estimate
 * itself, document intake, the team roster. Those are not missing
 * features. They are built screens the assistant cannot see, which is a
 * different and much cheaper problem, and it is invisible until somebody
 * writes the questions down next to the registry.
 *
 * WHY THIS IS NOT `cases.ts`. That file is organised around the REGISTRY
 * and its job is to cover every tool at least once — it starts from what
 * was built and asks what somebody might say to reach it. This one starts
 * from what a plastering contractor says on a Tuesday and asks whether
 * anything answers. The two find different things, and this one is the
 * only one that can find a hole, because a set derived from the registry
 * can never contain a question the registry does not serve.
 *
 * SYNTHESIZED, and said so — same caveat `cases.ts` carries. There are no
 * production transcripts yet. These are written from the trade (framing,
 * drywall, plaster, EIFS, ceilings, fireproofing, under a GC, union), from
 * the screens this app actually has, and from the click lists. **A
 * question that reads wrong to Cyrus is wrong**, and so is a route.
 */

/** The fifth principal, and the one the union tools are really for.
 * `cases.ts` exports four; PAYROLL_COMPLIANCE holds MANAGE_COMPLIANCE and
 * MANAGE_FIELD, which is the whole union-compliance lane and nothing else,
 * so a ratio or remittance question asked as an OWNER never tests that the
 * person who actually asks it can be offered the tool. */
export const PAYROLL: Principal = { role: "MEMBER", jobFunction: "PAYROLL_COMPLIANCE" };

export type QuestionRoute =
  | { kind: "tool"; name: ToolName }
  | { kind: "command"; name: CommandName }
  | { kind: "several"; names: ToolName[] }
  | {
      /** Somebody DECIDED this one is not offered, and the decision is in
       * the registry's own exclusion list. A refusal is not a hole and must
       * not be counted as one: conflating "nothing can do this" with "we
       * chose not to" is how a deliberate safety rule ends up on a list of
       * things to go and fix. */
      kind: "refused";
      why: string;
    }
  | {
      kind: "gap";
      /** The tool somebody would reach for and be wrong. Named because THAT
       * is the tool at risk of answering this confidently: the failure mode
       * of a gap is never silence, it is a near-miss delivered in the same
       * voice as a fact. null when nothing in the registry is even close. */
      nearest: ToolName | null;
      /** What is actually missing, in one sentence, and specific enough to
       * be acted on or argued with. */
      why: string;
      /** A distinctive fragment of the matching entry in tools.ts
       * KNOWN_GAPS — the list that is INJECTED INTO THE SYSTEM PROMPT.
       *
       * This is the load-bearing field on a gap and the reason it exists:
       * a gap recorded only here changes nothing about what the assistant
       * does. The model is told to refuse well by that list and by nothing
       * else, so a gap that is not on it is a gap the model will answer
       * from the nearest tool — which is the whole failure mode. The test
       * requires this fragment to actually appear in a KNOWN_GAPS topic,
       * so the two lists cannot drift apart in the one direction that
       * matters. */
      refusalTopic: string;
    };

export type TopQuestion = {
  id: string;
  /** In the words a contractor uses, never the registry's. A question
   * phrased in tool vocabulary grades the vocabulary, not the routing. */
  question: string;
  /** Who asks it in real life — which is also what makes the capability
   * check mean something. */
  asker: Principal;
  route: QuestionRoute;
};

const t = (id: string, question: string, name: ToolName, asker: Principal = OWNER): TopQuestion => ({
  id,
  question,
  asker,
  route: { kind: "tool", name },
});
const c = (id: string, question: string, name: CommandName, asker: Principal = OWNER): TopQuestion => ({
  id,
  question,
  asker,
  route: { kind: "command", name },
});
const many = (id: string, question: string, names: ToolName[], asker: Principal = OWNER): TopQuestion => ({
  id,
  question,
  asker,
  route: { kind: "several", names },
});
const refused = (id: string, question: string, why: string, asker: Principal = OWNER): TopQuestion => ({
  id,
  question,
  asker,
  route: { kind: "refused", why },
});
const gap = (
  id: string,
  question: string,
  nearest: ToolName | null,
  refusalTopic: string,
  why: string,
  asker: Principal = OWNER,
): TopQuestion => ({ id, question, asker, route: { kind: "gap", nearest, why, refusalTopic } });

export const TOP_QUESTIONS: TopQuestion[] = [
  // ══════════════════════════════════ money coming in
  t("q-owed-now", "who owes us money right now?", "receivables", ACCOUNTING),
  t("q-owed-gc", "is Turner late on anything?", "receivables", ACCOUNTING),
  t("q-cash-next-month", "what's coming in next month?", "cash_flow_forecast"),
  t("q-aging-60", "how much of what we're owed is more than 60 days out?", "cash_flow_forecast", ACCOUNTING),
  t("q-retainage-total", "how much of our money is being held in retainage?", "retainage_held"),
  t("q-retainage-job", "how much is Turner still holding on Riverside?", "retainage_held", ACCOUNTING),
  t("q-retainage-collect", "which retainage can we actually go and collect now?", "retainage_held"),
  t("q-payapp-where", "where is our last pay application sitting?", "pay_application_status", ACCOUNTING),
  t("q-payapp-disputed", "is anything we billed in dispute?", "pay_application_status", ACCOUNTING),
  t("q-payapp-sitting", "how long has Turner had pay app 4 on Riverside?", "pay_application_status", ACCOUNTING),
  c("q-invoice", "invoice Turner 45,000 on Riverside for the September progress", "draft_invoice", ACCOUNTING),
  c("q-payment", "log a 12,500 check against invoice 3 on Riverside, check 4471", "log_payment", ACCOUNTING),
  c("q-retainage-release", "Turner released 18,400 of the Cedar Park retainage on September 8", "release_retainage", ACCOUNTING),
  many(
    "q-paid-this-month",
    "are we going to get paid on Riverside this month?",
    ["pay_application_status", "receivables", "cash_flow_forecast"],
    ACCOUNTING,
  ),
  // The one every owner asks first and the one nothing can answer. Left in
  // deliberately rather than quietly dropped for being awkward.
  gap(
    "q-make-payroll",
    "do we have enough coming in to cover payroll on the 15th?",
    "cash_flow_forecast",
    "covers payroll",
    "No bank balance and no payroll liability are recorded anywhere in this app, so the cash side of the question has no data at all. `cash_flow_forecast` knows what is owed TO us and says so in its own description; answering from that alone would be a cash-position claim built from one side of the ledger.",
  ),

  // ══════════════════════════════════ cost and margin
  t("q-losing-money", "which jobs are losing money?", "job_margin"),
  t("q-margin-job", "how is Riverside doing against what we bid it at?", "job_margin", ESTIMATOR),
  t("q-over-under", "are we overbilled or underbilled right now?", "job_margin"),
  t("q-cost-to-complete", "what is Riverside going to cost us to finish?", "job_margin"),
  t("q-backlog", "how much work have we got left on the books?", "job_margin"),
  t("q-labor-job", "what has the crew cost us on Riverside?", "job_labor_cost", ESTIMATOR),
  t("q-backcharges", "what is Turner charging back to us?", "backcharge_exposure"),
  t("q-backcharge-clock", "have we still got time to object to that backcharge?", "backcharge_exposure", ACCOUNTING),
  t("q-co-pending", "what change orders is the GC sitting on?", "change_order_status"),
  t("q-co-value", "how much is tied up in change orders we haven't been paid for?", "change_order_status"),
  // WAS A GAP AND WAS WRONG ABOUT WHY. An approved change order writes its
  // added scope onto JobLineItem, and InvoiceLineItem points at JobLineItem,
  // so the join exists — see the handler, which reports the two places it
  // still cannot see rather than papering over them.
  t("q-co-unbilled", "which approved change orders haven't been invoiced yet?", "unbilled_change_orders", ACCOUNTING),

  // ══════════════════════════════════ what the GC is sitting on
  t("q-submittals-all", "what is the GC still sitting on?", "open_submittals"),
  t("q-submittals-job", "which submittals are out on Riverside?", "open_submittals", FIELD),
  t("q-submittals-late", "is anything past its due-back date with the architect?", "open_submittals"),
  t("q-rfis-open", "what am I waiting on answers for?", "open_rfis", FIELD),
  t("q-rfis-late", "which RFIs has Turner blown the response date on?", "open_rfis"),
  c("q-rfi-raise", "raise an RFI on Riverside — the door schedule conflicts with the plans at 2B", "raise_rfi", FIELD),
  c("q-email-gc", "email Turner that the studs are three weeks out", "send_email"),
  t("q-email-landed", "did that lien waiver email actually reach them?", "outbound_messages"),
  t("q-email-bounced", "has anything we sent bounced?", "outbound_messages"),
  t("q-gc-msa", "is our master agreement with Turner still current?", "gc_relationship"),
  t("q-gc-prequal", "can we still bid Skanska work or has our prequal lapsed?", "gc_relationship", ESTIMATOR),
  many(
    "q-attention-friday",
    "what needs my attention on Riverside before Friday?",
    ["open_rfis", "open_submittals", "open_punch_list", "material_deliveries"],
    FIELD,
  ),

  // ══════════════════════════════════ the field, day to day
  t("q-what-happened", "what happened on Riverside yesterday?", "daily_field_reports", FIELD),
  t("q-delays", "what delays have we written up on Riverside?", "daily_field_reports", FIELD),
  c(
    "q-report-log",
    "log today's report for Riverside — hung board on level 2, crew of six, hoist down three hours",
    "log_daily_field_report",
    FIELD,
  ),
  t("q-punch-open", "what's left on the punch list at Riverside?", "open_punch_list", FIELD),
  c(
    "q-punch-add",
    "add punch items on Riverside: patch the corner bead at 2B and re-tape the head of wall at 3A",
    "add_punch_items",
    FIELD,
  ),
  t("q-photos", "have we got pictures of the Riverside deck from before they poured?", "job_photos", FIELD),
  t("q-photos-shared", "have we sent the GC any photos off Riverside?", "job_photos", FIELD),
  t("q-drawings-current", "am I building off the latest sheet on Riverside?", "drawing_currency", FIELD),
  t("q-drawings-new", "has a revision been issued that we haven't got yet?", "drawing_currency", FIELD),
  t("q-deliveries", "did the board show up at Riverside?", "material_deliveries", FIELD),
  t("q-deliveries-late", "what material are we still waiting on?", "material_deliveries", FIELD),
  c("q-delivery-log", "the drywall delivery for Riverside just landed, all of it", "record_material_delivery", FIELD),
  t("q-equipment-where", "where is the scissor lift?", "equipment_location", FIELD),
  t("q-equipment-yard", "what's sitting in the yard doing nothing?", "equipment_location", FIELD),
  c("q-equipment-send", "send the scissor lift to Riverside", "send_equipment_to_job", FIELD),
  c("q-equipment-back", "bring the lift back from Riverside", "bring_equipment_back", FIELD),
  t("q-tm-ticket", "did the GC ever sign the T&M ticket from Tuesday on Riverside?", "tm_tickets", FIELD),

  // ══════════════════════════════════ crew and hours
  t("q-who-on-job", "who is assigned to Riverside?", "crew_assignments", FIELD),
  c("q-hours-log", "log 8 hours for Mike on Riverside", "log_time_entry", FIELD),
  c("q-hours-yesterday", "put Mike down for 8 hours on Riverside yesterday", "log_time_entry", FIELD),
  c("q-hours-ot", "Mike ran 10 hours of overtime on Riverside", "log_time_entry", FIELD),
  t("q-certs-expiring", "whose cards are about to expire?", "certification_expiry", FIELD),
  t(
    "q-certs-gate",
    "can the six men I'm sending to Maple tomorrow legally be on that site?",
    "certification_expiry",
    FIELD,
  ),
  // WAS A GAP until the crew schedule merged. JobAssignment carries no date,
  // so the roster answered this in the right shape and the wrong substance;
  // CrewScheduleDay is a planned day, which is the question.
  t("q-who-tomorrow", "who is on Riverside tomorrow?", "crew_schedule", FIELD),
  // WAS A GAP until the crew schedule merged. TimeEntry still has no
  // submitted state; what closes it is a PLANNED day with no hours against
  // it — and the tool says "nobody logged it", never "they did not work".
  t("q-missing-hours", "whose hours haven't been turned in for last week?", "crew_schedule"),
  // THE SECOND CASE THE MODEL EVAL FAILED, AND AGAIN THE QUESTION WAS
  // WRONG. This was routed to `team_roster` — whose own description says,
  // in capitals, that there is no per-person pay rate in this app and it
  // does not report one. The model read that and called NOTHING, which is
  // the correct reading of a tool that disclaims the question. A question
  // routed to a tool that refuses it is not covered; it is a gap wearing a
  // route, and the eval is what found that twice now.
  gap(
    "q-team-rate",
    "what is Mike on an hour?",
    "team_roster",
    "what a person is paid an hour",
    "There is no per-person pay rate in this app, by design: a rate belongs to a craft classification and the fringe schedule in force on a given date, which is why `job_labor_cost` prices an HOUR rather than a person. `team_roster` is the near-miss and knows it — it reports which crafts somebody has worked under and refuses the rate.",
  ),
  // What team_roster is actually for, and a question that gets asked before
  // every site orientation.
  t("q-team-certs-missing", "who on the crew has nothing on file at all?", "team_roster", FIELD),

  // ══════════════════════════════════ union compliance
  t("q-ratio-now", "are we in ratio?", "apprentice_ratio", PAYROLL),
  t("q-ratio-month", "did we stay in ratio in August?", "apprentice_ratio", PAYROLL),
  t("q-ratio-job", "which job is putting us out of ratio?", "apprentice_ratio", PAYROLL),
  t("q-apprentice-behind", "is anybody behind on their apprenticeship hours?", "apprenticeship_standing", PAYROLL),
  t("q-fringes-owed", "what do we owe the funds this month?", "fringe_remittance", PAYROLL),
  t("q-fringes-local", "what goes to Local 213 for July?", "fringe_remittance", PAYROLL),
  t("q-determination", "have we got the wage determination for Riverside on file?", "wage_determinations", PAYROLL),
  t(
    "q-determination-produce",
    "on the public jobs, is there anything we couldn't actually produce if we were audited?",
    "wage_determinations",
    PAYROLL,
  ),
  t("q-coi", "are we current on our general liability certificate?", "compliance_status"),
  t("q-license", "when does our contractor licence come up for renewal?", "compliance_status"),
  t("q-days-left", "how many days have we got left on Riverside?", "schedule_status", FIELD),
  t("q-certified-payroll", "is certified payroll in for last week on Riverside?", "certified_payroll", PAYROLL),

  // ══════════════════════════════════ safety
  t("q-recordables", "how many recordable injuries have we had this year?", "safety_record", FIELD),
  t("q-days-away", "how many days away have we lost this year?", "safety_record", FIELD),
  t("q-dispatch", "have we got dispatch slips on file for everybody on Riverside?", "dispatch_slips", PAYROLL),
  // WAS A GAP, nearest `safety_record`: the EMR was recorded nowhere, and the
  // OSHA log is what one is CALCULATED from by somebody else. Closed by
  // recording the bureau's rate on /compliance — never by deriving one — and
  // its KNOWN_GAPS entry was removed in the same change, since that list is
  // injected into the system prompt and would have told the model to refuse.
  t("q-emr", "what's our mod rate this year?", "experience_mod_rate"),

  // ══════════════════════════════════ estimating and bids
  t("q-bids-out", "what bids have we got out?", "bid_status", ESTIMATOR),
  t("q-bids-due", "what's due this week?", "bid_status", ESTIMATOR),
  c("q-bid-log", "Turner asked us to bid the Riverside fireproofing, bids due 10/3", "log_bid_invitation", ESTIMATOR),
  c("q-estimate-new", "start an estimate for Northgate Apartments for Skanska", "create_estimate_job", ESTIMATOR),
  c("q-estimate-lines", "draft the line items for Northgate off the scope", "draft_estimate_lines", ESTIMATOR),
  // THE ONE CASE THE MODEL EVAL FAILED, AND THE QUESTION WAS WRONG RATHER
  // THAN THE MODEL. This asked to CREATE a catalog item at a price, and
  // `add_catalog_line` puts a line on a job FROM the catalog — it "does NOT
  // invent an item or a price". The model called nothing, correctly. Fixed
  // to the question the command actually serves, and the one it does not
  // now sits below as a refusal rather than being lost.
  c("q-catalog-line", "put 200 sheets of 5/8 type X on the Northgate estimate", "add_catalog_line", ESTIMATOR),
  refused(
    "q-catalog-create",
    "add 5/8 type X to our catalog at 14.20 a sheet",
    "Deliberately excluded, not missing. `createLineItemCatalogEntry` is on the estimating exclusion list with the reason: a catalog entry carries a typed default price, and that is a number the model would be supplying. It is done on the catalog page, where the person types the money.",
    ESTIMATOR,
  ),
  t("q-vendor-quote", "what did we get quoted for 5/8 type X?", "vendor_pricing", ESTIMATOR),
  t("q-vendor-stale", "are those prices still good or have they run out?", "vendor_pricing", ESTIMATOR),
  t("q-estimate-read", "what's in the Northgate estimate?", "estimate_detail", ESTIMATOR),
  gap(
    "q-pipeline",
    "what have we got out chasing that we haven't bid yet?",
    "bid_status",
    "our own sales pipeline",
    "A subcontractor's own pre-bid pipeline is not modelled. SalesLead and SalesOpportunity look like the answer and are NOT: sales.prisma's first line says they are Prova's own CRM for selling this product, populated only on the operator company, so a tool over them would hand every tenant the vendor's sales pipeline. `bid_status` starts at the bid INVITATION, so it knows about work a GC has already asked us to price and nothing about what is being chased.",
    ESTIMATOR,
  ),

  // ══════════════════════════════════ schedule, closeout, warranty
  c("q-reschedule", "push Riverside's start to October 6", "reschedule_job"),
  t("q-closeout-job", "what is stopping us closing out Riverside?", "closeout_status"),
  t("q-closeout-all", "which jobs are closest to final payment?", "closeout_status"),
  t("q-warranty-job", "are we still on the hook for Cedar Park?", "warranty_obligations"),
  t("q-callbacks", "what has come back on us under warranty?", "warranty_obligations"),
  gap(
    "q-finish-on-time",
    "are we going to finish Riverside on time?",
    "job_margin",
    "finish on time",
    "Nothing forecasts a completion DATE. `schedule_status` now answers where a job stands against its dates, which is as far as the data goes; `job_margin`'s percent complete is cost-based — money spent against money expected — and a job can be 80% through its budget and nowhere near 80% through its programme. Reading one as the other is exactly the mistake a schedule question invites.",
  ),
  t("q-intake-unfiled", "what came in this week that nobody has filed yet?", "document_intake"),
  // WAS A GAP until LienDeadline existed: there was no lien, preliminary
  // notice or stop notice model at all — missing data, not a missing tool.
  // What closed it is a place to ENTER the date, not a way to compute one:
  // the app never works out a legal deadline, and `lien_deadlines` answers
  // only from dates a person typed in from counsel or the statute.
  t("q-lien-deadline", "when does our lien deadline run out on Riverside?", "lien_deadlines"),
];

/**
 * The declared number of unanswerable questions.
 *
 * WAS THIRTEEN. Eight of those thirteen turned out to be about features
 * this app already had — built screens the assistant could not see — and
 * they are tools now (lib/ask/handlers.ts, "the eight the assistant could
 * not see"). A ninth, the unbilled change orders, was a gap that was WRONG:
 * the join existed the whole time. Recorded rather than quietly amended,
 * because a gap list that is wrong in that direction is the worse kind —
 * it stops anybody looking.
 *
 * Asserted rather than counted from the array, and that is the whole
 * point: without it, adding a gap makes the list longer and nothing
 * happens, which is how a gap list becomes wallpaper. A route that
 * DISAPPEARS — a tool renamed or retired, leaving a question with nothing
 * behind it — would also just quietly become a fourteenth gap. This number
 * has to be edited by a person, in a diff somebody reads.
 *
 * It goes DOWN when a gap is closed. It going UP is a decision, not an
 * accident.
 *
 * 6 -> 5 when `q-emr` closed: the mod rate is now RECORDED from the bureau
 * on /compliance and read by `experience_mod_rate`.
 * 5 -> 4 on 2026-09-18: the lien deadline, closed by LienDeadline and the
 * `lien_deadlines` tool. BOTH branches had written "6 -> 5" and set the
 * literal to 5; git merged the identical edit as agreement and kept 5.
 * Two gaps closed, so it is 4 — the literal exists to make somebody add up.
 */
export const CENSUS_GAPS = 4;

/** Questions the registry deliberately refuses. Counted APART from the
 * gaps and asserted separately, because the two must never be added
 * together: a refusal is a decision somebody made and defended, and
 * folding it into a gap list turns a safety rule into a to-do. */
export const CENSUS_REFUSALS = 1;

/** How many questions there are. Same reasoning: a census that can shrink
 * without failing is a census that has already shrunk. */
export const TOTAL_QUESTIONS = 100;

/**
 * The routable ninety-seven, as eval cases, so the model half of the
 * guarantee can actually be run: `pnpm ask:eval` grades these the same way
 * it grades `cases.ts`.
 *
 * A `several` question becomes a case expecting the FIRST of its tools,
 * which is deliberately the weakest honest expectation: the composing loop
 * may reach the others on a later pass, and the eval only watches the first
 * round. `top-questions.eval.ts` grades those with its own check —
 * any one of the named tools, and no command — rather than pretending this
 * conversion is exact.
 *
 * The thirteen gaps convert too, as `no_command`. That grades the one thing
 * that matters most and is checkable: a question nothing can answer must
 * not produce a CARD. Whether the model refuses gracefully or near-misses
 * off `nearest` is the real risk in a gap and this eval CANNOT see it —
 * grading that needs the answer text, and the harness records tool calls.
 * Said here rather than left for somebody to assume it is covered.
 */
export function topQuestionCases(): import("./cases").EvalCase[] {
  return TOP_QUESTIONS.map((q) => ({
    id: q.id,
    question: q.question,
    principal: q.asker,
    expect:
      q.route.kind === "tool"
        ? ({ kind: "tool", name: q.route.name } as const)
        : q.route.kind === "command"
          ? ({ kind: "command", name: q.route.name } as const)
          : q.route.kind === "several"
            ? ({ kind: "tool", name: q.route.names[0] } as const)
            : ({ kind: "no_command" } as const),
  }));
}
