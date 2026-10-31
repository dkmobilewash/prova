// A suggested "this period" for one continuation-sheet line, from the job's own
// records. Pure. It is ADVICE ONLY: nothing here reaches a form field, an action
// or the G702. `pay-application.ts` does not import this file, and a test holds
// that, so the certificate cannot change because of a suggestion.
//
// HOURS ARE THE ONLY SOURCE, because they are the only progress the app records.
// Field reports are free text with no quantity, and takeoff tracks no installed
// amounts. Hours measure effort rather than work in place, so the note says what
// it came from and a person decides.

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

/** Only hours through the period-to date count, so hours logged after it cannot
 * inflate this application. Null when there is nothing honest to suggest. */
export function suggestThisPeriod(
  line: { scheduledValue: number; previousBilled: number; materialsStoredToDate: number } & LineProgress,
  periodTo: string,
): PayAppSuggestion | null {
  if (!line.budgeted || !(line.budgeted > 0) || !periodTo) return null;
  const hundredths = line.logged
    .filter((row) => row.day <= periodTo)
    .reduce((sum, row) => sum + Math.round(row.amount * 100), 0);
  if (hundredths <= 0) return null;
  const logged = hundredths / 100;
  const percent = (logged / line.budgeted) * 100;
  const capped = Math.min(percent, 100);
  const worked = thisPeriodForPercentComplete({
    percentComplete: capped,
    scheduledValue: line.scheduledValue,
    previousBilled: line.previousBilled,
    materialsStoredToDate: line.materialsStoredToDate,
  });
  if (!worked.ok) return null;
  const basis =
    `${formatHours(logged)} of ${formatHours(line.budgeted)} budgeted hours through ${periodTo}, ` +
    (percent > 100 ? "over budget, so held at 100%" : `${capped.toFixed(1)}%`);
  const amount = worked.result.thisPeriodBilled;
  if (amount <= 0) return { amount: null, text: `Nothing suggested from hours: ${basis}, and this line is billed that far.` };
  return { amount, text: `Suggested ${money(amount)} from hours: ${basis}.` };
}
