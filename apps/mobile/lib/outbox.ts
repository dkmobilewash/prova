import { cacheGet } from "./offline-cache";
import { cacheKeys } from "./cache-keys";
import { t } from "./i18n";
import { backoffFor, MAX_ATTEMPTS, type PendingOp, type QueuedOp, type RefusedOp } from "./sync-queue";
import type { Job } from "./types";

/**
 * What a queued write IS, said the way the person who made it would say
 * it — and what is happening to it.
 *
 * "Pending sync: 3" was the whole of it before: a number, on whichever
 * screen you happened to be standing on, with no way to ask WHICH three,
 * how old they are, or why one of them is not moving. A foreman who logs
 * eight hours in a basement and drives home has no way to find out
 * whether the office has it. That is the gap this file fills.
 *
 * Every op type must appear here — `outbox.test.ts` walks the union and
 * fails on one that is missing, so a new kind of queued write cannot show
 * up in somebody's outbox as a blank line.
 */

export type OutboxItem = {
  opId: string;
  /** "8 hours" — what was done. */
  title: string;
  /** "ZZQB-TEST · Fri 19 Sep" — where and when. */
  detail: string;
  queuedAt?: string;
  attempts: number;
  lastError?: string;
  nextTryAt?: string;
};

/** The job names this phone knows, for turning a jobId into something a
 * person recognises. Read from the same cache the Jobs tab writes, so it
 * works with no signal — which is the only time this screen matters. */
export async function jobNames(): Promise<Record<string, string>> {
  const cached = await cacheGet<Job[]>(cacheKeys.jobs());
  const names: Record<string, string> = {};
  for (const job of cached?.rows ?? []) names[job.id] = job.name;
  return names;
}

function day(iso: string | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

/**
 * Deliberately exhaustive: the `never` below is a compile error the day
 * somebody adds an op type and forgets this file.
 *
 * WHAT IS TRANSLATED HERE AND WHAT IS NOT. The words this file supplies —
 * "Daily report", "Punch item", "Photo" — are `outbox.op.*` keys, because
 * a Spanish phone whose outbox is half English is the exact half-screen
 * this layer exists to prevent. What comes off the op is NOT: the topic,
 * the description, the caption, the signer's name, the job name, the pay
 * type (an API enum) and the day (already rendered in the phone's own
 * locale) are somebody's own words or the server's, and translating them
 * would put a sentence in the outbox that is on no record anywhere.
 */
export function describeOp(op: PendingOp, names: Record<string, string> = {}): { title: string; detail: string } {
  const job = (id: string) => names[id] ?? t("outbox.op.thisJob");
  switch (op.type) {
    case "field-report:create":
      return { title: t("outbox.op.dailyReport"), detail: `${job(op.jobId)} · ${day(op.reportDate)}` };
    case "field-report:update":
      return { title: t("outbox.op.dailyReportChange"), detail: day(op.clientUpdatedAt) };
    case "time:create":
      return {
        title: t("outbox.op.hours", { hours: op.hours }),
        detail: `${job(op.jobId)} · ${day(op.date)}${op.payType && op.payType !== "REGULAR" ? ` · ${op.payType.toLowerCase()}` : ""}`,
      };
    case "material:create":
      return { title: op.description, detail: t("outbox.op.materialOrder", { job: job(op.jobId) }) };
    case "toolbox-talk:create":
      return { title: op.topic, detail: t("outbox.op.toolboxTalk", { job: job(op.jobId), date: day(op.heldOn) }) };
    case "incident:create":
      return { title: t("outbox.op.incident", { name: op.employeeName }), detail: `${job(op.jobId)} · ${day(op.occurredAt)}` };
    case "punch-list:create":
      return {
        title: op.description,
        detail: `${t("outbox.op.punchItem", { job: job(op.jobId) })}${op.area ? ` · ${op.area}` : ""}`,
      };
    case "punch-list:status":
      return {
        title: op.status === "READY_FOR_REVIEW" ? t("outbox.op.punchReady") : t("outbox.op.punchReopened"),
        detail: job(op.jobId),
      };
    case "ticket:create":
      return { title: op.workDescription, detail: t("outbox.op.tmTicket", { job: job(op.jobId), date: day(op.workDate) }) };
    case "media:create":
      return { title: op.caption?.trim() || t("outbox.op.photo"), detail: `${job(op.jobId)} · ${day(op.capturedAt)}` };
    case "delay:create":
      return { title: t("outbox.op.delay"), detail: `${job(op.jobId)} · ${day(op.date)}` };
    case "signoff:create":
      return { title: t("outbox.op.signoff", { name: op.signerName }), detail: `${job(op.jobId)} · ${day(op.date)}` };
    default: {
      const exhaustive: never = op;
      return exhaustive;
    }
  }
}

export function toOutboxItem(op: QueuedOp, names: Record<string, string>): OutboxItem {
  const { title, detail } = describeOp(op, names);
  return {
    opId: op.opId,
    title,
    detail,
    queuedAt: op.queuedAt,
    attempts: op.attempts ?? 0,
    lastError: op.lastError,
    nextTryAt: op.nextTryAt,
  };
}

export function describeRefused(refused: RefusedOp, names: Record<string, string>): { title: string; detail: string } {
  return describeOp(refused.op, names);
}

/**
 * What this write is doing right now, in a sentence.
 *
 * "Waiting" is the honest default and covers the ordinary case — no
 * signal, nothing wrong. A write the server has actually answered and
 * refused says so, with the server's own words, because "failed" tells a
 * foreman nothing he can act on.
 *
 * The keys it spends — `outbox.waitingForSignal`, `outbox.tried.one`,
 * `outbox.tried.many`, `outbox.when.seconds`, `outbox.when.next` — were
 * written FOR this function and then never called: five entries sitting in
 * both dictionaries beside the English literals they were meant to
 * replace. They are called now, and the wording is theirs rather than the
 * literals', which is why the quotes around the server's words are
 * typographic here.
 */
export function statusOf(item: OutboxItem, now: Date = new Date()): string {
  if (item.attempts === 0) return t("outbox.waitingForSignal");
  const remaining = item.nextTryAt ? Date.parse(item.nextTryAt) - now.getTime() : 0;
  const when =
    remaining > 0
      ? t("outbox.when.seconds", { seconds: Math.max(1, Math.round(remaining / 1000)) })
      : t("outbox.when.next");
  // A refusal with no message at all: the old fallback was the word "no",
  // which reads as the server ANSWERING "no" rather than as nothing having
  // come back. Saying so is the whole point of quoting it.
  const error = item.lastError ?? t("outbox.noReason");
  return item.attempts === 1
    ? t("outbox.tried.one", { error, when })
    : t("outbox.tried.many", { count: item.attempts, error, when });
}

/** How close a write is to being set aside, for the line that warns before
 * it happens rather than after. */
export function triesLeft(item: OutboxItem): number {
  return Math.max(0, MAX_ATTEMPTS - item.attempts);
}

/** The longest any queued write will wait before the next try, used by the
 * drain timer so it wakes up when something is actually due. */
export function soonestDue(items: OutboxItem[], now: Date = new Date()): number | null {
  if (items.length === 0) return null;
  const waits = items.map((item) =>
    item.nextTryAt ? Math.max(0, Date.parse(item.nextTryAt) - now.getTime()) : 0,
  );
  return Math.min(...waits, backoffFor(1));
}
