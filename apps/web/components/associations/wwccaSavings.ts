/**
 * The savings calculator on /associations/wwcca — the arithmetic and the
 * defaults, apart from the component that draws them
 * (./WwccaSavingsCalculator.tsx), so a plain test can
 * run the formula and check every default against its source.
 *
 * ── THE FORMULA ──────────────────────────────────────────────────────────
 *
 *   office hours per month  = hours per week × 4.33
 *   what you spend now      = current monthly spend + hours/month × rate
 *   hours C Stream removes  = hours per week × share
 *   with C Stream           = C Stream's price + (hours/month − removed/month) × rate
 *   saving                  = now − with C Stream        (NEGATIVE when it costs more)
 *   yearly                  = each monthly figure × 12
 *
 * IF C STREAM COSTS MORE, THE SAVING IS NEGATIVE AND THE PAGE SHOWS IT. There
 * is no clamp at zero anywhere in this file, on purpose: a calculator that
 * cannot say "this is not worth it for you" is an advertisement with input
 * boxes, and this one is shown to the association's own committee.
 *
 * ── WHAT IS AND IS NOT A FACT HERE ───────────────────────────────────────
 *
 * Every default is either sourced (with the source shown beside the field),
 * a labelled example, or a labelled assumption. Nothing on the calculator is
 * a C Stream measurement of anyone's savings: the product has no customers
 * whose time it has measured, and the result is computed from the numbers
 * the visitor types, which is why the page says "An estimate from the
 * numbers you enter, not a quote." A figure that once circulated internally
 * — "8.3 hours/week" — has no source and is deliberately not used.
 *
 * ── MONEY ────────────────────────────────────────────────────────────────
 *
 * Intermediate values are computed in CENTS and rounded once, so that
 * `10 × 4.33 × 38` does not reach the screen as `1645.3999999999999`. This is
 * lib/render-hours.ts's lesson (a floating-point sum printed on the one
 * screen that must be believed), applied before `money()` rather than
 * trusted to it.
 */

import { FOUNDING_OFFER } from "./wwcca";

/** Weeks in a month, as the brief states it. 52 / 12 is 4.333…; the two
 * differ by 0.08% and the page shows the rounder figure it uses. */
export const WEEKS_PER_MONTH = 4.33;

/** The largest value any field accepts. Not a clamp on the RESULT — the
 * saving goes as negative as the inputs make it — but a ceiling on each input
 * so that nothing typed can reach Infinity (`1e308 × 4.33` does). A million
 * of anything here is already absurd for a payroll office. */
export const INPUT_MAX = 1_000_000;

export interface SavingsInputs {
  /** People on the crew. Shown for scale; the formula does not use it — see
   * the note on `crewSize` in DEFAULTS. */
  crewSize: number;
  /** Office hours per week spent on certified payroll, fringe reports and
   * pay applications. */
  officeHoursPerWeek: number;
  /** Fully loaded cost of one office hour, in dollars. */
  loadedHourlyCost: number;
  /** What the company pays now, per month, for software, payroll services
   * and accountant time on this work, in dollars. */
  currentMonthlySpend: number;
  /** The share of those office hours C Stream removes: 0 to 1. An ASSUMPTION,
   * labelled as one on the page. */
  shareRemoved: number;
}

export interface SavingsResult {
  /** Office hours per month at the current rate of work. */
  officeHoursPerMonth: number;
  /** Office hours per month C Stream removes. */
  hoursSavedPerMonth: number;
  /** Dollars per month, rounded to the cent. */
  nowMonthly: number;
  withMonthly: number;
  /** now − with, per month. Negative when C Stream costs more. */
  savingMonthly: number;
  nowYearly: number;
  withYearly: number;
  savingYearly: number;
  /** True when C Stream costs more than the current setup. */
  costsMore: boolean;
}

/**
 * A default and where it came from. `source` is rendered beside the field,
 * verbatim, so the page never shows a number without saying what it is.
 * `kind` is what the label says: "sourced" carries a citation, "example"
 * says "example, use your own", "assumption" says so.
 */
export interface SavingsDefault {
  value: number;
  kind: "sourced" | "example" | "assumption";
  /** The line shown under the field. */
  source: string;
  /** Where a reader can check the source, when there is one. */
  href?: string;
}

/**
 * THE DEFAULTS, EACH WITH ITS SOURCE. page.test.ts asserts that every one of
 * these renders with its `source` text beside it, so a default cannot be
 * changed without its provenance changing in the same place.
 */
export const DEFAULTS: Record<keyof SavingsInputs, SavingsDefault> = {
  // For scale only: the figures below are per office, not per worker, and
  // the formula never multiplies by this. It is on the page because the
  // visitor's first question is "for a crew of what size?", and 25 is the
  // size of shop the founding offer's flat price is written for.
  crewSize: {
    value: 25,
    kind: "example",
    source: "use your own. Shown for scale; the result is per office, not per worker.",
  },
  // NOT the "8.3 hours/week" figure that circulated internally, which has no
  // source. An example the visitor replaces with their own.
  officeHoursPerWeek: {
    value: 10,
    kind: "example",
    source: "use your own.",
  },
  // BLS Occupational Employment and Wage Statistics, May 2023, occupation
  // 43-3051 (Payroll and Timekeeping Clerks): mean hourly wage $26.29. Wages
  // are roughly 70% of employer cost per the BLS Employer Costs for Employee
  // Compensation release, so the loaded hour is about $38. California runs
  // about $42 on the same method.
  loadedHourlyCost: {
    value: 38,
    kind: "sourced",
    source:
      "BLS payroll clerk mean wage $26.29/hr (May 2023), loaded at wages ≈ 70% of employer cost per BLS ECEC. California is about $42.",
    href: "https://www.bls.gov/oes/2023/may/oes433051.htm",
  },
  // An example, with two public price lists for reference — READ OFF THE
  // SITES on 2026-09-21, not from the brief that requested this calculator,
  // which quoted "$1,000–$5,000/month managed services" for
  // certifiedpayrollpro.com and "$99–$399" for Knowify. Neither figure is on
  // those pages today: certifiedpayrollpro.com lists software plans at
  // $49, $99 and $249 a month plus a per-report fee, and knowify.com/pricing
  // lists Core $99 and Advanced $329 a month. A reference price the reader
  // can check and find wrong is worse than none, so the page carries the
  // checked ones and the date they were checked.
  currentMonthlySpend: {
    value: 750,
    kind: "example",
    source:
      "use your own. For reference, checked 2026-09-21: Knowify lists $99–$329/month (knowify.com/pricing); CertifiedPayrollPro lists $49–$249/month plus a per-report fee (certifiedpayrollpro.com). Neither includes the office hours.",
  },
  // AN ASSUMPTION. Nobody has measured this; it is the number the visitor
  // should argue with first, which is why it is a field and labelled.
  shareRemoved: {
    value: 0.5,
    kind: "assumption",
    source: "not a measurement; change it.",
  },
};

export const DEFAULT_INPUTS: SavingsInputs = {
  crewSize: DEFAULTS.crewSize.value,
  officeHoursPerWeek: DEFAULTS.officeHoursPerWeek.value,
  loadedHourlyCost: DEFAULTS.loadedHourlyCost.value,
  currentMonthlySpend: DEFAULTS.currentMonthlySpend.value,
  shareRemoved: DEFAULTS.shareRemoved.value,
};

/**
 * C Stream's monthly price, as a number, read out of the offer string so the
 * calculator cannot quote a price the offer does not. FOUNDING_OFFER.price is
 * the one place the price is set (see wwcca.ts); this parses its first dollar
 * figure rather than repeating it. wwccaSavings.test.ts asserts they agree.
 */
export function cStreamMonthlyPrice(): number {
  const match = FOUNDING_OFFER.price?.match(/\$([\d,]+)/);
  if (!match) throw new Error("FOUNDING_OFFER.price carries no dollar figure; the calculator has no price to use");
  return Number(match[1].replace(/,/g, ""));
}

/** A typed value as a finite number in [0, INPUT_MAX]: NaN, Infinity, negative
 * and absent all become 0, and anything above the ceiling becomes it. */
export function sanitise(value: unknown, max = INPUT_MAX): number {
  const n = typeof value === "number" ? value : Number(String(value ?? "").replace(/[$,%\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, max);
}

/** Dollars rounded to the cent, via integer cents. */
function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}

export function calculateSavings(raw: SavingsInputs, price = cStreamMonthlyPrice()): SavingsResult {
  const hoursPerWeek = sanitise(raw.officeHoursPerWeek);
  const rate = sanitise(raw.loadedHourlyCost);
  const current = sanitise(raw.currentMonthlySpend);
  const share = sanitise(raw.shareRemoved, 1);

  const officeHoursPerMonth = hoursPerWeek * WEEKS_PER_MONTH;
  const hoursSavedPerMonth = officeHoursPerMonth * share;

  // Cents from here on: one rounding per figure, never a rounded figure fed
  // back into arithmetic that could re-introduce dust.
  const nowCents = toCents(current) + toCents(officeHoursPerMonth * rate);
  const withCents = toCents(price) + toCents((officeHoursPerMonth - hoursSavedPerMonth) * rate);
  const savingCents = nowCents - withCents;

  return {
    officeHoursPerMonth: Math.round(officeHoursPerMonth * 100) / 100,
    hoursSavedPerMonth: Math.round(hoursSavedPerMonth * 100) / 100,
    nowMonthly: nowCents / 100,
    withMonthly: withCents / 100,
    savingMonthly: savingCents / 100,
    nowYearly: (nowCents * 12) / 100,
    withYearly: (withCents * 12) / 100,
    savingYearly: (savingCents * 12) / 100,
    costsMore: savingCents < 0,
  };
}
