import { prisma, type TakeoffEventKind } from "@prova/db";

/**
 * ── TAKEOFF EVENTS: WHAT HAPPENED ON A REAL JOB, ONE ROW PER ACT ──
 *
 * Written beside the review queue's accept, Accept all, pick, height edit, skip
 * and undo, Set type and Clear type (CHANGE), the auto-post rule, and the signing
 * link (SEND), so automation is measured on pilots' jobs and not only on our walks.
 *
 * NEVER FAILS THE ACT IT RECORDS. A person's accept matters more than our count of
 * it: a write that throws is logged and dropped.
 *
 * COMPANY-SCOPED, NO PLAN CONTENT. Every row carries the company the action already
 * resolved from the session; `target` is a hash of run coordinates
 * (`eventTarget.ts`) and `source` a `PostSource` code, never a tag, a type code or
 * any text off the drawing.
 */
export type TakeoffEventRow = {
  companyId: string;
  jobId: string;
  kind: TakeoffEventKind;
  planId?: string | null;
  pageNumber?: number | null;
  target?: string | null;
  source?: string | null;
  batch?: string | null;
  userId?: string | null;
};

/** The source codes an event may carry: `PostSource` and "none". Anything else is stored as null. */
export const EVENT_SOURCES = ["tag", "tag-variant", "carried", "sibling", "note", "thickness", "none"] as const;
export function eventSource(raw: unknown): string | null {
  return typeof raw === "string" && (EVENT_SOURCES as readonly string[]).includes(raw) ? raw : null;
}

export async function recordTakeoffEvents(rows: TakeoffEventRow[]): Promise<void> {
  if (rows.length === 0) return;
  try {
    await prisma.takeoffEvent.createMany({
      data: rows.map((r) => ({
        companyId: r.companyId,
        jobId: r.jobId,
        kind: r.kind,
        planId: r.planId ?? null,
        pageNumber: r.pageNumber ?? null,
        target: r.target ?? null,
        source: r.source === undefined ? null : eventSource(r.source),
        batch: r.batch ?? null,
        userId: r.userId ?? null,
      })),
    });
  } catch (error) {
    console.error("[takeoff-events] not recorded", { kinds: rows.map((r) => r.kind), error: String(error) });
  }
}
