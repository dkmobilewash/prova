import { openPlanPdf, type PlanPdf } from "./planPdf";
import { readPlanBytes } from "./planBytes";

/**
 * ── ONE OPEN COPY OF A PLAN SET PER SERVER INSTANCE, SHARED BY EVERY READER ──
 *
 * ELEVEN03 (342 MB) peaked the server at 5.07 GB (2026-11-07, profiled). Every
 * reader fetched the whole file and opened its own pdfjs document:
 *   - the wall-legend and schedule-row stages did it for EVERY PAGE they checked,
 *     four lanes at a time (75 whole-file reads in the first minutes);
 *   - each scale saved started a wall finder after the response, so Confirm on 35
 *     sheets opened 35 copies at once;
 *   - the inventory opened one per slice and never closed it.
 * Each copy is the file's size in ArrayBuffers plus pdfjs's parse of it.
 *
 * Now the first reader of a plan opens it and the rest borrow that document;
 * `close()` returns the loan, and the last loan out starts an idle timer that
 * really closes it. 30 s outlasts the gap between ingest slices (0.4 s) and
 * between pressing one scale and the next, so a run of slices reuses one open.
 *
 * Keyed by company AND plan, so the tenancy check `readPlanBytes` makes is made
 * for every key. A plan id never gets a new file, so nothing has to invalidate.
 * A failed read is not kept: the next reader tries again.
 *
 * pdfjs can serve several pages of one document at once; the per-page methods
 * already release their page (`page.cleanup()`) when done.
 *
 * ponytail: per instance and unbounded by count; a busy instance holding many
 * different plans at once would hold them all. Add an LRU when that shows up.
 */
const IDLE_MS = 30_000;

type Entry = { opening: Promise<PlanPdf>; loans: number; idle: ReturnType<typeof setTimeout> | null };
const open = new Map<string, Entry>();

class ReadRefused extends Error {}

export type SharedPlanPdf = { ok: true; pdf: PlanPdf } | { ok: false; error: string };

export async function openSharedPlanPdf(planId: string, companyId: string): Promise<SharedPlanPdf> {
  const key = `${companyId}:${planId}`;
  let entry = open.get(key);
  if (entry === undefined) {
    const opening = (async () => {
      const read = await readPlanBytes(planId, companyId);
      if (!read.ok) throw new ReadRefused(read.error);
      return openPlanPdf(read.bytes);
    })();
    const fresh: Entry = { opening, loans: 0, idle: null };
    opening.catch(() => {
      if (open.get(key) === fresh) open.delete(key);
    });
    open.set(key, fresh);
    entry = fresh;
  }
  const held = entry;
  if (held.idle !== null) {
    clearTimeout(held.idle);
    held.idle = null;
  }
  held.loans += 1;
  let pdf: PlanPdf;
  try {
    pdf = await held.opening;
  } catch (error) {
    held.loans -= 1;
    if (error instanceof ReadRefused) return { ok: false, error: error.message };
    throw error;
  }
  let returned = false;
  return {
    ok: true,
    pdf: {
      ...pdf,
      // Returns the loan; the document stays open for the next reader.
      close: async () => {
        if (returned) return;
        returned = true;
        held.loans -= 1;
        if (held.loans > 0) return;
        held.idle = setTimeout(() => {
          if (held.loans > 0 || open.get(key) !== held) return;
          open.delete(key);
          pdf.close().catch(() => {});
        }, IDLE_MS);
        held.idle.unref?.();
      },
    },
  };
}

/** How many plans are open, for the test. */
export function openSharedPlanCount(): number {
  return open.size;
}
