import type { PlanIngestStage } from "@prova/db";

/**
 * THE FREE DRAWING-SET READ — the offer itself, as data.
 *
 * What this is for: outreach. A contractor is handed one link, lands on
 * `/wall-takeoff`, and sends the drawing set they are bidding this week. We
 * read it and send back what we read. No charge, no account, no call booked
 * before they have seen anything.
 *
 * ── WHY THE PROMISES LIVE IN A MODULE RATHER THAN IN THE PAGE ──
 *
 * Because there are going to be at least three copies of them — the landing
 * page, the confirmation state, and the email that delivers the result — and
 * CLAUDE.md's rule for a value with a canonical list is to write BOTH guards:
 * one that the list is complete, and one that it is the only one. A promise
 * that drifts between the page and the email is not a cosmetic bug on a page
 * like this: the page is what a contractor agreed to before handing over a
 * bid set.
 *
 * ── EVERY DELIVERABLE NAMES THE CODE THAT PRODUCES IT ──
 *
 * `backing` is not documentation. `takeoff-offer.test.ts` resolves every one
 * of them — a stage against `RUNNABLE_STAGES`, a module symbol against the
 * file on disk — so a line promising something this app cannot do FAILS THE
 * BUILD rather than being caught by whoever reads the page next.
 *
 * That guard exists because of the specific way marketing copy goes wrong
 * here. `components/LandingPage.tsx`'s header records a brief that asked for
 * a panel comparing estimated against actual labour HOURS, which the app
 * does not do — caught by a person, during the build, by luck. The audience
 * is the same one: a sub who runs certified payroll every month and will know
 * in one glance whether a sheet index is real.
 *
 * ── WHAT IS DELIBERATELY NOT PROMISED HERE ──
 *
 * Wall quantities. `lib/takeoff/wallVectors.ts` finds walls and
 * `lib/takeoff-plan.ts` reads a scale, but both run in the plan VIEWER with a
 * person present, and neither is a `PlanIngestStage` — so neither can be part
 * of a "send it in and we mail you back" promise today. When wall measurement
 * becomes a stage, it gets a line here and the census will accept it. Until
 * then this page does not hint at it, because a free tool that over-promises
 * costs more than one that offers less: the drawing set is the one thing a
 * contractor cannot un-send.
 */

/** Where a promise comes from. Resolved by the census, not read by a human. */
export type Backing =
  | { kind: "stage"; stage: PlanIngestStage }
  | { kind: "module"; path: string; symbol: string };

export type Deliverable = {
  id: string;
  /** The heading, in the contractor's own words — never a feature name. */
  title: string;
  /** What arrives, concretely enough that a wrong answer is obvious. */
  body: string;
  /** How they check it in ten seconds. The whole offer rests on this being
   *  possible: a number they cannot check is a number they cannot trust. */
  check: string;
  backing: Backing;
};

/**
 * WHAT THEY GET. Three lines, each one a stage that runs unattended.
 *
 * Ordered by how fast a contractor can tell it is right, not by how
 * impressive it sounds. The sheet list is first because they know their own
 * sheet list by heart.
 */
export const DELIVERABLES: Deliverable[] = [
  {
    id: "sheet-index",
    title: "Every sheet, numbered and titled",
    body:
      "Your whole set listed out — sheet number, sheet title and discipline, in order, read off the title block of each page.",
    check: "You know your own sheet list. Run your eye down it.",
    backing: { kind: "stage", stage: "TITLE_BLOCK" },
  },
  {
    id: "duplicate-sheets",
    title: "Any sheet number that appears twice",
    body:
      "Two sheets stamped A-3 is how a scope hole gets bid. We list the repeats and which pages they are on.",
    check: "Open the two pages we name and look at the stamps.",
    backing: {
      kind: "module",
      path: "lib/plan-ingest/sheetIndex.ts",
      symbol: "duplicateSheetNumbers",
    },
  },
  {
    id: "schedules",
    title: "Every schedule on the set, typed out",
    body:
      "The partition schedule, the door schedule, the finish schedule — whatever tables are in there, rebuilt as rows and columns you can read, with the sheet each one came off.",
    check: "Put it next to the sheet. Every cell is on the drawing.",
    backing: { kind: "stage", stage: "SCHEDULE_ROWS" },
  },
  {
    id: "page-inventory",
    title: "The set's own particulars",
    body:
      "Page count, sheet size per page, and which pages have no text layer at all — the scanned ones nothing can read without a person.",
    check: "Compare the page count to the file you sent.",
    backing: { kind: "stage", stage: "PAGE_INVENTORY" },
  },
];

/**
 * WHAT WE SAY WE WILL NOT DO — on the page, in the same type size as the
 * promises.
 *
 * This is the part that earns the next conversation. #672's whole subject was
 * an app that knew why it could not read a sheet and told nobody; two entire
 * bid packages turned out to have no text layer at all. A free read that says
 * "pages 14 and 15 are scans, I got nothing off them" is worth more to a
 * contractor than one that quietly returns four rows and lets them find out
 * at bid time.
 */
export const LIMITS: string[] = [
  "We do not price anything, and we do not send you a bid number.",
  "We do not measure walls or count doors off the drawing — that happens with you on the screen, not in an inbox.",
  "A page we could not read is named, with the reason. We would rather hand you a gap than a guess.",
  "Scanned sheets with no text layer get nothing off them, and we say which pages those are.",
];

/**
 * HOW THE RESULT ARRIVES — the delivery form, written down because it is the
 * half of this that a contractor is actually agreeing to.
 *
 * A LINK, NOT AN ATTACHMENT, and that is a deliverability decision rather
 * than a design one. `packages/integrations/src/email.ts`'s own header
 * records the finding this rests on: the most-repeated complaint about every
 * competitor is mail problems surfaced badly — quotes from the vendor's
 * domain going unopened. A first email from an unknown sender carrying a PDF
 * attachment is the single most filterable thing we could send. A short plain-
 * text mail with one link is not.
 *
 * It is also the only form that lets them forward it to their estimator
 * without re-sending a file, and the only one we can correct after the fact.
 */
export const DELIVERY = {
  /** What they hand over. */
  intake: "You send the drawing set as a PDF — the bid set, whatever the GC sent you.",
  /** How long it takes, stated as a ceiling we can hold rather than a boast. */
  turnaround: "within one business day",
  /** How it comes back. */
  form:
    "A plain email with one link. The link is a page with everything we read, laid out so you can put it beside the drawing. No attachment, no login, no account.",
  /** What they can do with it. */
  shareable: "Forward the link to your estimator or your PM. It keeps working.",
} as const;

/**
 * THE THREE STEPS, as the page shows them. Derived from DELIVERY above rather
 * than written again, which is the second-list guard applied to the one claim
 * most likely to get restated in prose.
 */
export const NEXT_STEPS: { step: number; title: string; body: string }[] = [
  { step: 1, title: "Tell us where to send it", body: "The form below. Name, company, email — that is all of it." },
  { step: 2, title: "Send the set", body: DELIVERY.intake },
  { step: 3, title: "We email you the link", body: `${DELIVERY.form} Normally ${DELIVERY.turnaround}.` },
];

/**
 * The trades this is built for, and the honest escape hatch.
 *
 * Same four this whole product is built for, plus OTHER — which is not
 * padding. A GC or a general-building sub landing here should be able to say
 * so, because the answer we give them is different, and a form with no row
 * for the truth gets a lie typed into it.
 */
export const OFFER_TRADES = [
  { value: "FRAMING_DRYWALL", label: "Metal framing & drywall" },
  { value: "PLASTER_LATH", label: "Lath & plaster" },
  { value: "EIFS", label: "EIFS" },
  { value: "CEILINGS", label: "Acoustical ceilings" },
  { value: "FIREPROOFING", label: "Fireproofing" },
  { value: "OTHER", label: "Something else" },
] as const;

export type OfferTrade = (typeof OFFER_TRADES)[number]["value"];

export const OFFER_TRADE_VALUES: readonly OfferTrade[] = OFFER_TRADES.map((t) => t.value);

export function offerTradeLabel(value: string): string | null {
  return OFFER_TRADES.find((t) => t.value === value)?.label ?? null;
}

/** What the form collects. Phone and the project fields are optional on
 *  purpose: every required field on a public form is a contractor who closes
 *  the tab, and we can ask for the rest in the reply. */
export type OfferRequest = {
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  trade: string;
  projectName: string;
  gcName: string;
};

/**
 * A very small sanity check on an address, NOT RFC validation — deliberately
 * permissive, for the reason `looksLikeEmail` in
 * `packages/integrations/src/email.ts` gives at length: real addresses are
 * stranger than most regexes allow, and rejecting a valid one is worse than
 * letting the provider reject an invalid one.
 *
 * IT IS A SECOND COPY OF THAT FUNCTION AND IS NOT ALLOWED TO DRIFT FROM IT.
 * The copy exists because this module is imported by a PUBLIC page and
 * `@prova/integrations`' barrel pulls the model SDK in behind it; a marketing
 * page must not ship that. So the duplication is deliberate and pinned:
 * `takeoff-offer.test.ts` runs both functions over one case table and fails if
 * they ever disagree. CLAUDE.md's rule for a canonical value is both guards —
 * the list is complete, and it is the only one. Here the honest version is to
 * admit the second one and nail it down.
 */
export function looksLikeEmailAddress(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 3 || trimmed.length > 320) return false;
  if (/\s/.test(trimmed)) return false;
  const at = trimmed.indexOf("@");
  if (at < 1) return false;
  if (at !== trimmed.lastIndexOf("@")) return false;
  const domain = trimmed.slice(at + 1);
  if (!domain.includes(".")) return false;
  if (domain.startsWith(".") || domain.endsWith(".")) return false;
  return true;
}

/**
 * Why this request cannot be accepted, in one sentence a contractor can act
 * on — or null when it can.
 *
 * Returns the FIRST problem rather than a list, because this form has three
 * required fields and a list of three sentences under a three-field form
 * reads as a failure rather than a correction.
 */
export function requestProblem(request: OfferRequest): string | null {
  if (!request.companyName.trim()) return "Add your company name so we know who the set belongs to.";
  if (!request.contactName.trim()) return "Add your name.";
  if (!request.email.trim()) return "Add an email address — that is where the link goes.";
  if (!looksLikeEmailAddress(request.email)) return "That email address does not look right. Check it and try again.";
  if (request.trade && !OFFER_TRADE_VALUES.includes(request.trade as OfferTrade)) {
    return "Pick one of the trades listed.";
  }
  return null;
}

/**
 * How long two requests from the same address count as the same request.
 *
 * A PUBLIC FORM IS DOUBLE-CLICKED, and CLAUDE.md is explicit that no create
 * action in this app is idempotent — #19 disabled 57 create buttons for that
 * reason. A button that is disabled while in flight does not cover the case
 * here: a contractor who is not sure it worked comes back and fills the form
 * in again twenty minutes later. Two identical leads in `/sales` is not a
 * data problem, it is a sales problem — somebody rings them twice.
 */
export const DEDUPE_WINDOW_HOURS = 24;

export function withinDedupeWindow(existingCreatedAt: Date, now: Date): boolean {
  const elapsedHours = (now.getTime() - existingCreatedAt.getTime()) / 3_600_000;
  return elapsedHours >= 0 && elapsedHours < DEDUPE_WINDOW_HOURS;
}

/**
 * The most leads this form will create in one hour before it stops.
 *
 * Not security — a ceiling. This endpoint writes rows to Prova's own
 * operating company, and an unauthenticated write with no ceiling is how a
 * CRM becomes unusable in an afternoon. Twenty is far above any real day of
 * inbound from a page handed out by hand, and far below the volume that would
 * bury the pipeline. When it trips, nothing is lost: the refusal says to
 * email us instead, and names the address.
 */
export const HOURLY_LEAD_CEILING = 20;

export function overCeiling(recentCount: number): boolean {
  return recentCount >= HOURLY_LEAD_CEILING;
}

/**
 * What gets written as the lead's first activity, so nothing the contractor
 * typed is lost to a column we do not have.
 *
 * `SalesLead` has no project, GC or trade column, and this page is not the
 * place to add three. A NOTE activity is where this app already keeps the
 * things somebody said — and it is an evidence record, so it survives the
 * lead being edited.
 */
export function requestNote(request: OfferRequest): string {
  const lines = ["Asked for a free drawing-set read from /wall-takeoff."];
  const trade = offerTradeLabel(request.trade);
  if (trade) lines.push(`Trade: ${trade}`);
  if (request.projectName.trim()) lines.push(`Project: ${request.projectName.trim()}`);
  if (request.gcName.trim()) lines.push(`GC: ${request.gcName.trim()}`);
  if (request.phone.trim()) lines.push(`Phone: ${request.phone.trim()}`);
  return lines.join("\n");
}

/**
 * What the page says once the form has been accepted.
 *
 * NAMES THE NEXT ACTION AS THEIRS, which is the whole reason this is a
 * separate state rather than a toast. Nothing happens until they send the
 * set, and a confirmation that only says "thanks, we will be in touch" leaves
 * a contractor waiting for an email that is waiting for them.
 */
export function confirmation(request: OfferRequest): { heading: string; body: string } {
  const name = request.contactName.trim().split(/\s+/)[0] || "Thanks";
  return {
    heading: `${name} — we have your details.`,
    body: `Reply to the email we just sent and attach the drawing set, or send it to the address in it. ${DELIVERY.form} Normally ${DELIVERY.turnaround} from when the set lands.`,
  };
}
