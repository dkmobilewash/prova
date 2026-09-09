import { prisma } from "@prova/db";
import { commandNamed, isCommandName } from "./commands";

/**
 * What the Ask box has proposed, for the settings page.
 *
 * Every card ever shown is an AskProposal row, append-only and stamped
 * rather than edited (ask.prisma). This module turns those rows into what
 * an owner wants to read: who asked what, what the assistant proposed, and
 * what became of it. Nothing here writes.
 *
 * The outcome shown is DERIVED, per the rule that derived state is never
 * stored: a row with no outcome is "pending" until its expiry passes and
 * "expired" after, and a HANDOFF card that was opened on its page but
 * never settled reads as "opened" — the person got as far as the form,
 * which stays true after the card expires. Storing any of those would let
 * the audit disagree with the row.
 *
 * Two stored outcomes both mean "tapped and nothing was written", and the
 * page says so in one breath: REFUSED is the capability re-check at the
 * tap (the person lost the right between card and tap), FAILED is the
 * action's own refusal or a throw, with its sentence in `note`. A refusal
 * at RESOLVE time — "no invoice on Riverside has a balance owing" — never
 * makes a row at all, since no card was shown.
 */
export type AuditOutcome = "OK" | "REFUSED" | "FAILED" | "CANCELLED" | "PENDING" | "OPENED" | "EXPIRED";

export type AuditRow = {
  id: string;
  when: Date;
  who: string;
  question: string;
  /** The card's title, or the raw command name for one no longer registered. */
  proposed: string;
  mode: string;
  outcome: AuditOutcome;
  note: string | null;
  target: { label: string; href: string } | null;
};

export function auditOutcome(
  row: { outcome: string | null; claimedAt: Date | null; openedAt: Date | null; expiresAt: Date },
  now: Date,
): AuditOutcome {
  if (row.outcome === "OK" || row.outcome === "REFUSED" || row.outcome === "FAILED" || row.outcome === "CANCELLED") {
    return row.outcome;
  }
  if (row.claimedAt) return "OK";
  if (row.openedAt) return "OPENED";
  if (row.expiresAt < now) return "EXPIRED";
  return "PENDING";
}

export const OUTCOME_LABEL: Record<AuditOutcome, string> = {
  OK: "Done",
  REFUSED: "Refused at the tap",
  FAILED: "Not done",
  CANCELLED: "Cancelled",
  PENDING: "Waiting for a tap",
  OPENED: "Form opened, not saved",
  EXPIRED: "Expired untouched",
};

/** Where a created record can be read. Targets that live on a job need
 * the job looked up; the lookups are batched, one query per kind. */
async function targetLinks(
  rows: { targetType: string | null; targetId: string | null }[],
): Promise<Map<string, { label: string; href: string }>> {
  const links = new Map<string, { label: string; href: string }>();
  const ids = (type: string) =>
    rows.filter((r) => r.targetType === type && r.targetId).map((r) => r.targetId as string);

  const invoices = ids("Invoice");
  if (invoices.length) {
    for (const inv of await prisma.invoice.findMany({ where: { id: { in: invoices } }, select: { id: true, number: true, jobId: true } })) {
      links.set(`Invoice:${inv.id}`, { label: `Invoice #${inv.number}`, href: `/jobs/${inv.jobId}` });
    }
  }
  const payments = ids("Payment");
  if (payments.length) {
    for (const p of await prisma.payment.findMany({
      where: { id: { in: payments } },
      select: { id: true, invoice: { select: { number: true, jobId: true } } },
    })) {
      links.set(`Payment:${p.id}`, { label: `Payment on invoice #${p.invoice.number}`, href: `/jobs/${p.invoice.jobId}` });
    }
  }
  const entries = ids("TimeEntry");
  if (entries.length) {
    for (const t of await prisma.timeEntry.findMany({ where: { id: { in: entries } }, select: { id: true, jobId: true } })) {
      links.set(`TimeEntry:${t.id}`, { label: "Time entry", href: `/jobs/${t.jobId}` });
    }
  }
  for (const row of rows) {
    if (!row.targetType || !row.targetId) continue;
    const key = `${row.targetType}:${row.targetId}`;
    if (links.has(key)) continue;
    switch (row.targetType) {
      case "Job":
        links.set(key, { label: "Job", href: `/jobs/${row.targetId}` });
        break;
      case "DailyFieldReport":
        links.set(key, { label: "Field report", href: "/field-reports" });
        break;
      case "EquipmentAssignment":
        links.set(key, { label: "Equipment", href: "/equipment" });
        break;
      case "MaterialOrderDelivery":
        links.set(key, { label: "Delivery", href: "/material-orders" });
        break;
    }
  }
  return links;
}

export const AUDIT_PAGE_SIZE = 100;

export async function listAskProposals(companyId: string, now: Date = new Date()): Promise<AuditRow[]> {
  const rows = await prisma.askProposal.findMany({
    where: { companyId },
    orderBy: { createdAt: "desc" },
    take: AUDIT_PAGE_SIZE,
    select: {
      id: true,
      createdAt: true,
      question: true,
      command: true,
      mode: true,
      outcome: true,
      outcomeNote: true,
      claimedAt: true,
      openedAt: true,
      expiresAt: true,
      targetType: true,
      targetId: true,
      createdByUser: { select: { name: true, email: true } },
    },
  });
  const links = await targetLinks(rows);
  return rows.map((row) => ({
    id: row.id,
    when: row.createdAt,
    who: row.createdByUser?.name ?? row.createdByUser?.email ?? "a removed account",
    question: row.question,
    proposed: isCommandName(row.command) ? commandNamed(row.command).title : row.command,
    mode: row.mode,
    outcome: auditOutcome(row, now),
    note: row.outcomeNote,
    target: row.targetType && row.targetId ? (links.get(`${row.targetType}:${row.targetId}`) ?? null) : null,
  }));
}

/** The last thirty days, counted in code from the rows on the page.
 * `notDone` is a tap that wrote nothing, for either stored reason. */
export function auditSummary(rows: AuditRow[], now: Date): { proposed: number; done: number; notDone: number } {
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const recent = rows.filter((row) => row.when >= since);
  return {
    proposed: recent.length,
    done: recent.filter((row) => row.outcome === "OK").length,
    notDone: recent.filter((row) => row.outcome === "REFUSED" || row.outcome === "FAILED").length,
  };
}
