import type { ReviewedFinding } from "./findings";

/**
 * DEADLINES THE SUBCONTRACT IMPOSES — proposed from a finding, confirmed by a
 * person, then read by the alerts system. Pure.
 *
 * A proposal is only a pre-filled form: every field comes from a figure that
 * was verified to be in the finding's own quote (`figuresStatedIn`) or from the
 * quote's words read by code here. Nothing is saved until the person presses
 * Confirm, and they can change every field first.
 */

export type ObligationKind = "NOTICE_WINDOW" | "MONTHLY_DAY" | "DATED";

export type ObligationProposal = {
  kind: ObligationKind;
  label: string;
  windowHours: number | null;
  windowDays: number | null;
  dayOfMonth: number | null;
  recipient: string | null;
  form: string | null;
};

const NOTICE_WORD: Record<string, string> = {
  DELAY_NOTICE: "delay",
  CLAIM_NOTICE: "claim",
  CHANGE_NOTICE: "change",
};

/** "20th day of each month", "by the 25th of every month" → 20 / 25. */
export function dayOfMonthIn(quote: string): number | null {
  const match =
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:calendar\s+)?day\s+of\s+(?:each|every|the|every\s+calendar)\s+month\b/i.exec(quote) ??
    /\bthe\s+(\d{1,2})(?:st|nd|rd|th)\s+(?:of\s+)?(?:each|every)\s+month\b/i.exec(quote);
  if (!match) return null;
  const day = Number(match[1]);
  return day >= 1 && day <= 31 ? day : null;
}

export function proposeObligation(finding: ReviewedFinding): ObligationProposal | null {
  const terms = (finding.terms ?? {}) as Record<string, unknown>;
  const num = (key: string) => (typeof terms[key] === "number" ? (terms[key] as number) : null);
  const str = (key: string) => (typeof terms[key] === "string" ? (terms[key] as string) : null);

  if (finding.category === "NOTICE") {
    const hours = num("noticeHours");
    const days = num("noticeDays");
    if (hours === null && days === null) return null;
    const what = finding.subtype && NOTICE_WORD[finding.subtype] ? `${NOTICE_WORD[finding.subtype]} ` : "";
    const window = hours !== null ? `${hours}-hour` : `${days}-day`;
    return {
      kind: "NOTICE_WINDOW",
      label: `${window} ${what}notice`.replace(/\s+/g, " "),
      windowHours: hours,
      windowDays: hours !== null ? null : days,
      dayOfMonth: null,
      recipient: str("noticeRecipient"),
      form: str("noticeForm"),
    };
  }

  if (finding.subtype === "BILLING_CUTOFF" || finding.category === "BILLING") {
    const day = dayOfMonthIn(finding.quote);
    if (day === null) return null;
    return { kind: "MONTHLY_DAY", label: "Pay application due", windowHours: null, windowDays: null, dayOfMonth: day, recipient: null, form: null };
  }
  return null;
}

/** The next calendar date (UTC, ISO) on `day` of a month, on or after today —
 *  clamped to a short month's last day, so "the 31st" is 30 April. */
export function nextMonthlyDate(day: number, todayIso: string): string {
  const [y, m, d] = todayIso.split("-").map(Number) as [number, number, number];
  const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  let year = y;
  let month = m - 1;
  if (Math.min(day, lastDay(year, month)) < d) {
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  const dd = Math.min(day, lastDay(year, month));
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

/** "48-hour delay notice — in writing, to the Project Manager." */
export function obligationSentence(row: { label: string; recipient: string | null; form: string | null }): string {
  const how = [row.form ? `${row.form}` : null, row.recipient ? `to ${row.recipient}` : null].filter(Boolean).join(", ");
  return how ? `${row.label} — ${how}.` : `${row.label}.`;
}
