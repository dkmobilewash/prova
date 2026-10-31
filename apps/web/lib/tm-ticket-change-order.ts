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

import type { CostCategory } from "@/lib/cost-category";
import { money } from "@/lib/money";
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
    perDiemAmount?: string | null;
    travelPayAmount?: string | null;
  }>;
  materials: Array<{ description: string; vendorName?: string | null; orderedOn?: string | null }>;
  /** Typed on the ticket at signing. Missing on every older ticket. */
  extras: TicketExtra[];
}

/** Dollars, except MILEAGE, which keeps its miles and rate: a line's cost column
 * holds cents, and a mile rate such as $0.725 has to survive as signed. */
export type TicketExtra =
  | { kind: "PER_DIEM" | "TRAVEL"; amount: string }
  | { kind: "MILEAGE"; miles: string; rate: string | null };

const figure = (raw: unknown): number | null => {
  const text = String(raw ?? "").trim().replace(",", ".");
  if (text === "") return null;
  return /^\d+(\.\d+)?$/.test(text) && Number(text) < 1_000_000 ? Number(text) : NaN;
};

/** What the phone sent, as the snapshot will hold it. Blank or zero is no line.
 * Refused in a sentence, because the phone shows it on the queued ticket. */
export function parseTicketExtras(raw: unknown): { ok: true; extras: TicketExtra[] } | { ok: false; error: string } {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const perDiem = figure(input.perDiem);
  const travel = figure(input.travel);
  const miles = figure(input.miles);
  const rate = figure(input.mileRate);
  if ([perDiem, travel, miles, rate].some((value) => Number.isNaN(value))) {
    return { ok: false, error: "Per diem, travel and mileage must be plain numbers." };
  }
  if (rate && !miles) return { ok: false, error: "Enter the miles for that mileage rate." };
  const extras: TicketExtra[] = [];
  if (perDiem) extras.push({ kind: "PER_DIEM", amount: perDiem.toFixed(2) });
  if (travel) extras.push({ kind: "TRAVEL", amount: travel.toFixed(2) });
  if (miles) extras.push({ kind: "MILEAGE", miles: String(miles), rate: rate ? String(rate) : null });
  return { ok: true, extras };
}

export interface TicketAllowance {
  /** The line as words, for the draft and the proposal. */
  text: string;
  costCategory: CostCategory;
  /** Null when nothing gives a cost, so the line lands unpriced. */
  cost: number | null;
}

/** Priced through the recap under option A. Mileage is EQUIPMENT because it is
 * the cost of running a vehicle; per diem and travel are OTHER. */
const ALLOWANCE_CATEGORY = { PER_DIEM: "OTHER", TRAVEL: "OTHER", MILEAGE: "EQUIPMENT" } as const;

const cents = (values: readonly (string | null | undefined)[]) =>
  values.reduce((sum, value) => {
    const n = Number(value);
    return Number.isFinite(n) ? sum + Math.round(n * 100) : sum;
  }, 0) / 100;

/**
 * Per diem, travel and mileage as lines. A TIME ENTRY ALREADY CARRIES PER DIEM AND
 * TRAVEL, so the same dollars can arrive twice. An amount typed on the ticket is
 * the one the signer's day was settled on, so it is the one priced, and the line
 * says what the entries show instead of adding it. The GC is never billed twice,
 * and a person sees the difference.
 */
export function ticketAllowances(snapshot: TmTicketSnapshot): TicketAllowance[] {
  const out: TicketAllowance[] = [];
  const flat = [
    { kind: "PER_DIEM", word: "Per diem", onEntries: cents(snapshot.labor.map((row) => row.perDiemAmount)) },
    { kind: "TRAVEL", word: "Travel", onEntries: cents(snapshot.labor.map((row) => row.travelPayAmount)) },
  ] as const;
  for (const { kind, word, onEntries } of flat) {
    const typed = snapshot.extras.find((extra) => extra.kind === kind);
    const costCategory = ALLOWANCE_CATEGORY[kind];
    if (typed?.kind === kind) {
      const cost = cents([typed.amount]);
      const also = onEntries > 0 ? `; the time entries show ${money(onEntries)}, not added, so check which is right` : "";
      out.push({ text: `${word} — ${money(cost)} entered on the ticket${also}`, costCategory, cost });
    } else if (onEntries > 0) {
      out.push({ text: `${word} — ${money(onEntries)} from the day's time entries`, costCategory, cost: onEntries });
    }
  }
  for (const extra of snapshot.extras) {
    if (extra.kind !== "MILEAGE") continue;
    const miles = Number(extra.miles);
    const costCategory = ALLOWANCE_CATEGORY.MILEAGE;
    out.push(
      extra.rate
        ? { text: `Mileage — ${miles} mi @ $${extra.rate}`, costCategory, cost: Math.round(miles * Number(extra.rate) * 100) / 100 }
        : { text: `Mileage — ${miles} mi — UNPRICED: no rate on the ticket; enter the cost`, costCategory, cost: null },
    );
  }
  return out;
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
      perDiemAmount: str(row.perDiemAmount),
      travelPayAmount: str(row.travelPayAmount),
    })),
    materials: list(obj.materials).map((row) => ({
      description: str(row.description) ?? "(no description)",
      vendorName: str(row.vendorName),
      orderedOn: str(row.orderedOn),
    })),
    extras: list(obj.extras).flatMap((row): TicketExtra[] => {
      if ((row.kind === "PER_DIEM" || row.kind === "TRAVEL") && str(row.amount)) {
        return [{ kind: row.kind, amount: String(row.amount) }];
      }
      return row.kind === "MILEAGE" && str(row.miles) ? [{ kind: "MILEAGE", miles: String(row.miles), rate: str(row.rate) }] : [];
    }),
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
  /** Photos attached to the ticket itself when this was drafted. The change
   * order shows them through the ticket, so this sentence is for the text that
   * travels on its own, such as the signature document. */
  ticketPhotoCount?: number;
}

const PAY_TYPE_WORDS: Record<string, string> = {
  STRAIGHT: "straight time",
  OVERTIME: "overtime",
  DOUBLE_TIME: "double time",
  SHIFT_DIFFERENTIAL: "shift differential",
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
    const figure = Number(row.hours);
    const perWorker = Number.isFinite(figure) ? formatHours(figure) : row.hours;
    const bits = [`${perWorker} h`, payTypeWord(row.payType), row.craftLabel].filter(Boolean).join(", ");
    lines.push(`  ${row.workerName} — ${bits}${row.lineItemDescription ? ` — on ${row.lineItemDescription}` : ""}`);
  }
  lines.push("", "Materials as signed for:");
  if (snapshot.materials.length === 0) {
    lines.push("  (no material orders were on the ticket)");
  }
  for (const row of snapshot.materials) {
    lines.push(`  ${row.description}${row.vendorName ? ` — ${row.vendorName}` : ""}${row.orderedOn ? ` (ordered ${row.orderedOn})` : ""}`);
  }
  const allowances = ticketAllowances(snapshot);
  if (allowances.length > 0) {
    lines.push("", "Per diem, travel and mileage:", ...allowances.map((row) => `  ${row.text}`));
  }
  const onTicket = input.ticketPhotoCount ?? 0;
  lines.push("");
  if (onTicket > 0) {
    lines.push(`${onTicket} photo${onTicket === 1 ? " was" : "s were"} attached to this ticket when this was drafted.`);
  }
  lines.push(
    input.photoCount > 0
      ? `Photos: ${input.photoCount} job photo${input.photoCount === 1 ? "" : "s"} captured on ${input.day} — see the job's photos for that day.`
      : `Photos: none captured on this job on ${input.day}.`,
    "",
    "The lines below carry the hours and materials above. Labor is priced at the craft's wage, fringes and burden through this job's bid recap where a wage is on file; a line marked UNPRICED needs its rate entered, and every material needs its cost. The hours are what the GC's representative signed for.",
  );
  return lines.join("\n");
}
