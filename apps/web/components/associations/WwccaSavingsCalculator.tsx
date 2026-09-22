"use client";

import { useId, useState } from "react";
import { money } from "@/lib/money";
import { formatHours } from "@/lib/render-hours";
import {
  calculateSavings,
  cStreamMonthlyPrice,
  DEFAULTS,
  INPUT_MAX,
  sanitise,
  WEEKS_PER_MONTH,
  type SavingsInputs,
} from "./wwccaSavings";

/**
 * The savings calculator on /associations/wwcca. The arithmetic and every
 * default's source live in components/associations/wwccaSavings.ts; this file only draws them.
 *
 * ── WHAT IT IS AND IS NOT ────────────────────────────────────────────────
 *
 * An estimate from the numbers the VISITOR types. The defaults are sourced,
 * labelled examples or a labelled assumption — never a C Stream measurement
 * of anybody's savings, because there is none. The last line says so:
 * "An estimate from the numbers you enter, not a quote."
 *
 * IF C STREAM COSTS MORE, IT SAYS SO. The saving is `now − with` and goes
 * negative; the "With C Stream" bar grows past the "now" bar and the result
 * line reads "costs you … more". Nothing here clamps at zero (see the
 * formula's header for why).
 *
 * ── WHY IT IS NOT A <figure> ─────────────────────────────────────────────
 *
 * The page's illustrative product panels are <figure>s captioned "Figures
 * are illustrative", and page.test.ts strips them before checking that the
 * prose carries no invented dollar figure or percentage. This is not that:
 * its figures are the visitor's own and the defaults show their sources. It
 * is marked `data-savings-calculator` instead, and the test strips it by
 * that marker and separately asserts every default renders with its source.
 *
 * ── INPUTS ───────────────────────────────────────────────────────────────
 *
 * `type="text" inputMode="decimal"`, the app's convention for numbers (#414):
 * a phone shows the number pad, the field can be emptied, and a comma or a
 * dollar sign typed by habit is stripped rather than refused. State is the
 * raw string; the formula sees `sanitise()` of it, so empty, "abc", negative
 * and enormous values all produce a finite result. Every field is a <label>
 * with the source line in `aria-describedby`.
 *
 * ── THE GRAPH ────────────────────────────────────────────────────────────
 *
 * CSS bars, not a chart library: two rows per period, widths as a
 * percentage of the larger figure, so the pair fits any width and the
 * longer bar is whichever is larger. The bars are `aria-hidden`; the
 * accessible result is the sentence in the live region above them and the
 * figures table, which carry the same numbers as text. The values are
 * printed in the text colour beside the bars, never on the yellow.
 */

type Field = keyof SavingsInputs;

const FIELDS: { key: Field; label: string; unit: string; percent?: boolean }[] = [
  { key: "crewSize", label: "Crew size", unit: "people" },
  {
    key: "officeHoursPerWeek",
    label: "Office hours per week on certified payroll, fringe reports and pay apps",
    unit: "hours",
  },
  { key: "loadedHourlyCost", label: "Loaded hourly cost of that office time", unit: "$ per hour" },
  {
    key: "currentMonthlySpend",
    label: "What you pay now for software, payroll services and accountant time on this work",
    unit: "$ per month",
  },
  { key: "shareRemoved", label: "Share of that office time C Stream removes", unit: "%", percent: true },
];

const KIND_LABEL: Record<(typeof DEFAULTS)[Field]["kind"], string> = {
  sourced: "Source",
  example: "Example",
  assumption: "Assumption",
};

/** The default as the field first shows it: the share as a whole percent. */
function initialText(key: Field): string {
  const value = DEFAULTS[key].value;
  return String(FIELDS.find((f) => f.key === key)?.percent ? Math.round(value * 100) : value);
}

const inputClass =
  "min-h-11 w-full rounded-md border border-line-card bg-canvas px-3 py-2 text-base tabular-nums text-ink placeholder:text-ink-muted focus:border-link focus:outline-none";

export function WwccaSavingsCalculator() {
  const idBase = useId();
  const [text, setText] = useState<Record<Field, string>>(() => ({
    crewSize: initialText("crewSize"),
    officeHoursPerWeek: initialText("officeHoursPerWeek"),
    loadedHourlyCost: initialText("loadedHourlyCost"),
    currentMonthlySpend: initialText("currentMonthlySpend"),
    shareRemoved: initialText("shareRemoved"),
  }));

  const inputs: SavingsInputs = {
    crewSize: sanitise(text.crewSize),
    officeHoursPerWeek: sanitise(text.officeHoursPerWeek),
    loadedHourlyCost: sanitise(text.loadedHourlyCost),
    currentMonthlySpend: sanitise(text.currentMonthlySpend),
    // The field is a whole percent; the formula takes a share of 1.
    shareRemoved: sanitise(text.shareRemoved, 100) / 100,
  };
  const price = cStreamMonthlyPrice();
  const result = calculateSavings(inputs, price);

  const resultSentence = result.costsMore
    ? `With these numbers C Stream costs you ${money(-result.savingMonthly)} more per month, ${money(-result.savingYearly)} more per year.`
    : `With these numbers C Stream saves you ${money(result.savingMonthly)} per month, ${money(result.savingYearly)} per year.`;

  return (
    <section
      data-savings-calculator
      id="savings"
      aria-labelledby={`${idBase}-heading`}
      className="scroll-mt-8 rounded-2xl border border-line-card bg-surface p-6 sm:p-10"
    >
      <h2 id={`${idBase}-heading`} className="text-2xl font-semibold text-ink sm:text-3xl">
        What it would save you
      </h2>
      <p className="mt-4 max-w-3xl text-base leading-relaxed text-ink-body sm:text-lg">
        Your numbers, not ours. Every default says where it came from; change any of them.
      </p>

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-14">
        {/* ---------------------------------------------------- inputs */}
        <form className="flex min-w-0 flex-col gap-6" onSubmit={(e) => e.preventDefault()} noValidate>
          {FIELDS.map((field) => {
            const def = DEFAULTS[field.key];
            const inputId = `${idBase}-${field.key}`;
            const sourceId = `${inputId}-source`;
            return (
              <div key={field.key} className="min-w-0">
                <label htmlFor={inputId} className="block text-sm font-medium leading-snug text-ink-label">
                  {field.label}
                </label>
                <div className="mt-2 flex items-center gap-3">
                  <input
                    id={inputId}
                    name={field.key}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    aria-describedby={sourceId}
                    value={text[field.key]}
                    onChange={(e) => setText((prev) => ({ ...prev, [field.key]: e.target.value }))}
                    className={`${inputClass} max-w-[10rem]`}
                  />
                  <span className="shrink-0 text-sm text-ink-body">{field.unit}</span>
                </div>
                <p id={sourceId} className="mt-1.5 text-xs leading-relaxed text-ink-body">
                  <span className="font-semibold text-ink-label">{KIND_LABEL[def.kind]}:</span> {def.source}
                  {def.href && (
                    <>
                      {" "}
                      <a
                        href={def.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="break-all text-link underline-offset-2 hover:text-link-hover hover:underline"
                      >
                        {def.href.replace(/^https?:\/\//, "")}
                      </a>
                    </>
                  )}
                </p>
              </div>
            );
          })}
          <p className="text-xs leading-relaxed text-ink-muted">
            Each field takes a number up to {INPUT_MAX.toLocaleString("en-US")}; a month is {WEEKS_PER_MONTH}{" "}
            weeks.
          </p>
        </form>

        {/* --------------------------------------------------- results */}
        <div className="min-w-0">
          <p
            role="status"
            aria-live="polite"
            className={`text-lg font-semibold leading-snug sm:text-xl ${result.costsMore ? "text-tag-amber-ink" : "text-ink"}`}
          >
            {resultSentence}
          </p>
          <p className="mt-2 text-sm text-ink-body">
            {formatHours(result.hoursSavedPerMonth)} office hours saved per month, out of{" "}
            {formatHours(result.officeHoursPerMonth)}.
          </p>

          <div aria-hidden="true" className="mt-6 flex flex-col gap-6">
            <BarPair title="Per month" now={result.nowMonthly} withCStream={result.withMonthly} />
            <BarPair title="Per year" now={result.nowYearly} withCStream={result.withYearly} />
          </div>

          <table className="mt-6 w-full text-sm">
            <caption className="sr-only">What you spend now against with C Stream, per month and per year</caption>
            <thead>
              <tr className="text-left text-xs text-ink-muted">
                <th scope="col" className="py-1 font-medium">
                  &nbsp;
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Per month
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Per year
                </th>
              </tr>
            </thead>
            <tbody className="text-ink-body">
              <tr className="border-t border-line-row">
                <th scope="row" className="py-1.5 text-left font-normal">
                  What you spend now
                </th>
                <td className="py-1.5 text-right tabular-nums text-ink">{money(result.nowMonthly)}</td>
                <td className="py-1.5 text-right tabular-nums text-ink">{money(result.nowYearly)}</td>
              </tr>
              <tr className="border-t border-line-row">
                <th scope="row" className="py-1.5 text-left font-normal">
                  With C Stream ({money(price)} a month plus the office time it leaves)
                </th>
                <td className="py-1.5 text-right tabular-nums text-ink">{money(result.withMonthly)}</td>
                <td className="py-1.5 text-right tabular-nums text-ink">{money(result.withYearly)}</td>
              </tr>
              <tr className="border-t border-line-row font-semibold">
                <th scope="row" className="py-1.5 text-left">
                  {result.costsMore ? "Costs more by" : "Saving"}
                </th>
                <td className="py-1.5 text-right tabular-nums text-ink">{money(Math.abs(result.savingMonthly))}</td>
                <td className="py-1.5 text-right tabular-nums text-ink">{money(Math.abs(result.savingYearly))}</td>
              </tr>
            </tbody>
          </table>

          <p className="mt-6 text-sm leading-relaxed text-ink-body">
            An estimate from the numbers you enter, not a quote. Office time is not the only cost of a
            late or wrong certified payroll; this counts only the hours.
          </p>
        </div>
      </div>
    </section>
  );
}

/** Two horizontal bars, each as a share of the larger, so the longer one is
 * whichever figure is larger — including "With C Stream" when it costs more. */
function BarPair({ title, now, withCStream }: { title: string; now: number; withCStream: number }) {
  const max = Math.max(now, withCStream, 1);
  const rows: { label: string; value: number; fill: string }[] = [
    { label: "What you spend now", value: now, fill: "bg-ink-muted" },
    { label: "With C Stream", value: withCStream, fill: "bg-brand" },
  ];
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{title}</p>
      <div className="mt-2 flex flex-col gap-2">
        {rows.map((row) => (
          <div key={row.label} className="min-w-0">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate text-ink-body">{row.label}</span>
              <span className="shrink-0 tabular-nums text-ink">{money(row.value)}</span>
            </div>
            <div className="mt-1 h-3 w-full overflow-hidden rounded-sm bg-canvas">
              <div
                className={`h-full rounded-sm ${row.fill} transition-[width] duration-[var(--speed-fast)]`}
                style={{ width: `${Math.max((row.value / max) * 100, row.value > 0 ? 1 : 0)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
