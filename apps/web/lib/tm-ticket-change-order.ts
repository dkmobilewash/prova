// The words a draft change order starts with when it is drafted from a
// signed T&M ticket. Pure: the action reads the rows and hands this plain
// values, so what the draft SAYS is testable without a database — the
// same split as delays-core.ts under draftChangeOrderFromDelay.
//
// WHAT THIS DOES NOT DO: price anything. A ticket's snapshot is hours and
// material descriptions with no rates behind them, and how a change order
// turns those into a sell price (markup, burden, equipment) is an open
// decision — see coordination/decisions/2026-10-30-change-order-markup-and-
// burden.md. Until it is made, the draft carries the evidence as text and
// the person prices it on the change-order form, exactly as a delay draft is
// priced. The frozen snapshot is used rather than today's time entries, so
// the draft says what was SIGNED FOR even if an entry was corrected since.

import { formatHours } from "@/lib/render-hours";

/** The shape `app/api/v1/jobs/[id]/tickets/route.ts` freezes at signing.
 * Read defensively: it is JSON in a column, and an older or hand-edited row
 * may be missing a field. A missing list is an empty list, never a throw —
 * a change order a GC is waiting for has to draft from whatever the ticket
 * holds. */
export interface TmTicketSnapshot {
  labor: Array<{
    workerName: string;
    hours: string;
    payType?: string | null;
    craftLabel?: string | null;
    lineItemDescription?: string | null;
  }>;
  materials: Array<{ description: string; vendorName?: string | null; orderedOn?: string | null }>;
}

export function readTmTicketSnapshot(raw: unknown): TmTicketSnapshot {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v : []) as Array<Record<string, unknown>>;
  const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
  return {
    labor: list(obj.labor).map((row) => ({
      workerName: str(row.workerName) ?? "Worker not recorded",
      hours: str(row.hours) ?? "0",
      payType: str(row.payType),
      craftLabel: str(row.craftLabel),
      lineItemDescription: str(row.lineItemDescription),
    })),
    materials: list(obj.materials).map((row) => ({
      description: str(row.description) ?? "(no description)",
      vendorName: str(row.vendorName),
      orderedOn: str(row.orderedOn),
    })),
  };
}

export interface TmTicketDraftInput {
  /** `workDate` as `YYYY-MM-DD`. */
  day: string;
  workDescription: string;
  snapshot: unknown;
  signerName: string;
  /** Already rendered in the site's zone — the caller owns the clock and
   * the zone, this module owns neither. */
  signedAtText: string;
  /** Whether a drawn signature is on file, or only a typed name. */
  hasDrawnSignature: boolean;
  /** Job photos captured on the work date. The ticket itself holds no
   * photos (JobMedia links to a daily report or a punch item, not a ticket),
   * so the draft points at the day's photos rather than claiming the ticket
   * has some. */
  photoCount: number;
}

const PAY_TYPE_WORDS: Record<string, string> = {
  REGULAR: "regular",
  OVERTIME: "overtime",
  DOUBLE_TIME: "double time",
};

function payTypeWord(payType: string | null | undefined): string | null {
  if (!payType) return null;
  return PAY_TYPE_WORDS[payType] ?? payType.toLowerCase().replace(/_/g, " ");
}

/** The sum of the snapshot's hours, as the ticket recorded them. Decimal
 * strings summed in cents of an hour (hundredths), so 0.1 + 0.2 does not
 * print as 0.30000000000000004 on a document. */
export function snapshotHours(snapshot: TmTicketSnapshot): number {
  const hundredths = snapshot.labor.reduce((sum, row) => {
    const n = Number(row.hours);
    return Number.isFinite(n) ? sum + Math.round(n * 100) : sum;
  }, 0);
  return hundredths / 100;
}

/** Title under 80 characters so the change-order list stays readable; the
 * whole description of the work is in the body. */
export function tmTicketDraftTitle(input: Pick<TmTicketDraftInput, "day" | "workDescription">): string {
  const head = input.workDescription.trim().replace(/\s+/g, " ");
  const room = 80 - `T&M ${input.day}: `.length;
  const short = head.length > room ? `${head.slice(0, room - 1).trimEnd()}…` : head;
  return `T&M ${input.day}: ${short}`;
}

export function tmTicketDraftDescription(input: TmTicketDraftInput): string {
  const snapshot = readTmTicketSnapshot(input.snapshot);
  const hours = snapshotHours(snapshot);
  const lines: string[] = [
    `From the T&M ticket signed on site by ${input.signerName}, ${input.signedAtText}` +
      (input.hasDrawnSignature ? " (drawn signature on file)." : " (typed name; signed before the phone took drawn signatures)."),
    `Work on ${input.day}: ${input.workDescription.trim()}`,
    "",
    `Labor as signed for — ${formatHours(hours)} hours:`,
  ];
  if (snapshot.labor.length === 0) {
    lines.push("  (no time entries were on the ticket)");
  }
  for (const row of snapshot.labor) {
    // Through formatHours, like every hours figure on a screen (hoursRenderCensus):
    // the snapshot stores Decimal strings, and a hand-edited row could carry
    // "8.00" or worse. An unreadable figure prints as written rather than as NaN.
    const hoursText = Number.isFinite(Number(row.hours)) ? formatHours(Number(row.hours)) : row.hours;
    const bits = [`${hoursText} h`, payTypeWord(row.payType), row.craftLabel].filter(Boolean).join(", ");
    lines.push(`  ${row.workerName} — ${bits}${row.lineItemDescription ? ` — on ${row.lineItemDescription}` : ""}`);
  }
  lines.push("", "Materials as signed for:");
  if (snapshot.materials.length === 0) {
    lines.push("  (no material orders were on the ticket)");
  }
  for (const row of snapshot.materials) {
    lines.push(`  ${row.description}${row.vendorName ? ` — ${row.vendorName}` : ""}${row.orderedOn ? ` (ordered ${row.orderedOn})` : ""}`);
  }
  lines.push(
    "",
    input.photoCount > 0
      ? `Photos: ${input.photoCount} job photo${input.photoCount === 1 ? "" : "s"} captured on ${input.day} — see the job's photos for that day.`
      : `Photos: none captured on this job on ${input.day}.`,
    "",
    "Not priced. Add the labor, material and equipment lines on this change order and price them; the hours above are what the GC's representative signed for.",
  );
  return lines.join("\n");
}
