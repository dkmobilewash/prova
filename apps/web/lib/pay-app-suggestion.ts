// A suggested "this period" for one continuation-sheet line, from the job's own
// records. Pure. It is ADVICE ONLY: nothing here reaches a form field, an action
// or the G702. `pay-application.ts` does not import this file, and a test holds
// that, so the certificate cannot change because of a suggestion.
//
// TWO SOURCES, shown side by side: installed quantities from field reports, and
// hours against budget. Hours measure effort rather than work in place, so each
// note says what it came from and a person decides.

import { money } from "@/lib/money";
import { thisPeriodForPercentComplete } from "@/lib/pay-application";
import { formatHours } from "@/lib/render-hours";

export interface LineProgress {
  /** Estimated hours for the line. Null when nobody estimated any. */
  budgeted: number | null;
  /** Hours logged to this line, per calendar day. */
  logged: readonly { day: string; amount: number }[];
}

export interface PayAppSuggestion {
  /** Null when the line has already been billed to or past the hours. */
  amount: number | null;
  text: string;
}

type BilledLine = { scheduledValue: number; previousBilled: number; materialsStoredToDate: number };

/** A line that can take a quantity, and what field reports say went in. */
export interface InstalledProgress {
  quantity: number;
  unit: string;
  logged: readonly { day: string; amount: number }[];
}

const throughDay = (logged: LineProgress["logged"], periodTo: string) =>
  logged.filter((row) => row.day <= periodTo).reduce((sum, row) => sum + Math.round(row.amount * 100), 0) / 100;

/** One source's percent as a note. Held at 100%, and it never goes below what
 * is already billed. Shares the percent box's calculation. */
function noteFrom(
  line: BilledLine,
  source: string,
  percent: number,
  basis: string,
  overWords: string,
): PayAppSuggestion | null {
  const capped = Math.min(percent, 100);
  const worked = thisPeriodForPercentComplete({
    percentComplete: capped,
    scheduledValue: line.scheduledValue,
    previousBilled: line.previousBilled,
    materialsStoredToDate: line.materialsStoredToDate,
  });
  if (!worked.ok) return null;
  const words = `${basis}, ${percent > 100 ? `${overWords}, so held at 100%` : `${capped.toFixed(1)}%`}`;
  const amount = worked.result.thisPeriodBilled;
  if (amount <= 0) return { amount: null, text: `Nothing suggested from ${source}: ${words}, and this line is billed that far.` };
  return { amount, text: `Suggested ${money(amount)} from ${source}: ${words}.` };
}

/** Only hours through the period-to date count, so hours logged after it cannot
 * inflate this application. Null when there is nothing honest to suggest. */
export function suggestThisPeriod(line: BilledLine & LineProgress, periodTo: string): PayAppSuggestion | null {
  if (!line.budgeted || !(line.budgeted > 0) || !periodTo) return null;
  const logged = throughDay(line.logged, periodTo);
  if (logged <= 0) return null;
  const basis = `${formatHours(logged)} of ${formatHours(line.budgeted)} budgeted hours through ${periodTo}`;
  return noteFrom(line, "hours", (logged / line.budgeted) * 100, basis, "over budget");
}

/** The same from what field reports recorded as installed. This measures work in
 * place, which hours do not, so the two are shown side by side and a person
 * weighs them. */
export function suggestFromInstalled(line: BilledLine, progress: InstalledProgress | undefined, periodTo: string): PayAppSuggestion | null {
  if (!progress || !(progress.quantity > 0) || !periodTo) return null;
  const installed = throughDay(progress.logged, periodTo);
  if (installed <= 0) return null;
  const plain = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  const basis = `${plain(installed)} of ${plain(progress.quantity)} ${progress.unit} through ${periodTo}`;
  return noteFrom(line, "installed qty", (installed / progress.quantity) * 100, basis, "over the line's quantity");
}
