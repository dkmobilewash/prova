import { prisma } from "@prova/db";
import { readPlanBytes } from "./planBytes";
import { hasTextLayer, openPlanPdf, titleBlockText, type PlanPdf } from "./planPdf";
import type { StageCtx, StageWork } from "./stages";

/**
 * `PAGE_INVENTORY` — WHAT EACH PAGE OF THE SET SAYS. No model call, ever.
 *
 * `plan-ingest.prisma` has described this stage as "it exists, and does it have
 * selectable text" since it was written, and it shipped doing nothing because the
 * server was believed unable to open a plan PDF at all. That belief was wrong
 * (see `planPdf.ts`), so this is the stage catching up with its own description
 * rather than a new one invented beside it.
 *
 * WHY THE PDF WORK BELONGS HERE AND NOT IN `TITLE_BLOCK`, which is where a first
 * draft put it. A stage that both parses a 15MB PDF and calls a model is paced by
 * the model: about two and a half seconds a page, so a 5-second Server Action
 * slice fits ONE OR TWO pages and re-fetches the whole file for each pair. Over a
 * 300-page set that is 150-odd fetches — two to four gigabytes of egress for one
 * ingestion. Making no model call, this stage runs at the full budget instead:
 * text extraction is a fraction of a second a page, so one fetch serves ten to
 * twenty pages on a browser slice and around a hundred on a cron tick. The
 * expensive stage then reads ROWS, which is also what makes its retries cheap.
 *
 * WHAT IT WRITES IS EVIDENCE, NOT AN ANSWER. `PlanSheetText` holds the words off
 * the title block so that `TITLE_BLOCK`'s `proposedReason` can be checked against
 * them, and so a reviewer can see what a proposal was made from. Nothing here
 * proposes anything.
 */

/** Everything this stage touches that is not pure, injected so the stage can be
 *  tested with no network, no database and no PDF. */
export type PageInventoryDeps = {
  /** The plan's bytes, or a sentence saying why not. */
  readPlanBytes: (planId: string, companyId: string) => Promise<ReadPlanBytes>;
  /** Open a document for reading. */
  openPdf: (bytes: Buffer) => Promise<PlanPdf>;
  /** Record what one page says. Idempotent — see `PlanSheetText`'s header. */
  saveSheetText: (row: SheetTextRow) => Promise<void>;
};

export type ReadPlanBytes = { ok: true; bytes: Buffer } | { ok: false; error: string };

export type SheetTextRow = {
  planId: string;
  pageNumber: number;
  hasTextLayer: boolean;
  titleBlockText: string | null;
  wholePageFallback: boolean;
  widthPt: number;
  heightPt: number;
  rotation: number;
};

/**
 * A page that is not in the file.
 *
 * The page count a run is created with comes from the browser and is bounded but
 * not verified (`startPlanIngest`), so a job can legitimately hold tasks for pages
 * the document does not have. That is a fact about the run, not a transient fault:
 * retrying cannot make page 400 of a 320-page set exist. It is reported as a
 * failure because there is nothing to record about it, and the sentence says the
 * set is shorter rather than implying something broke.
 */
function pastTheEnd(pageNumber: number, pageCount: number): string {
  return (
    `This set has ${pageCount} ${pageCount === 1 ? "sheet" : "sheets"}, so there is no sheet ${pageNumber} to read. ` +
    `Nothing about it was saved.`
  );
}

/**
 * The stage, bound to one run.
 *
 * THE DOCUMENT IS OPENED ONCE PER INVOCATION and held in this closure, which is
 * the whole economic point of the stage. `claimPorts` takes `work` as an injected
 * value and both call sites build it per invocation, so the cache's lifetime is
 * exactly one Server Action slice or one cron tick — long enough to amortise the
 * fetch over many pages, short enough that nothing has to invalidate it.
 *
 * It is not explicitly destroyed, and that is deliberate rather than overlooked.
 * The legacy pdfjs build spawns no worker in Node, so an open document is ordinary
 * heap; when the invocation ends this closure becomes unreachable and it is
 * collected with it. Adding a disposer would mean threading a teardown through
 * `runIngest`, which exists to know nothing about what a stage does. If a
 * long-lived container ever shows this holding memory, the fix is that disposer —
 * not a re-open per page, which is the cost this design exists to avoid.
 */
export function pageInventoryWork(ctx: StageCtx, deps: PageInventoryDeps = realDeps): StageWork {
  let opened: Promise<ReadPlanBytes | { ok: true; pdf: PlanPdf }> | null = null;

  async function document(): Promise<{ ok: true; pdf: PlanPdf } | { ok: false; error: string }> {
    if (!opened) {
      opened = (async () => {
        const read = await deps.readPlanBytes(ctx.planId, ctx.companyId);
        if (!read.ok) return read;
        return { ok: true as const, pdf: await deps.openPdf(read.bytes) };
      })();
    }
    const result = await opened;
    if (!result.ok) {
      // A failed open is NOT cached as a permanent verdict: the next slice builds a
      // new closure and tries again, which is what makes a blob store hiccup cost a
      // retry rather than the run.
      opened = null;
      return result;
    }
    return result as { ok: true; pdf: PlanPdf };
  }

  return async (task) => {
    const doc = await document();
    if (!doc.ok) return { ok: false, error: doc.error };

    if (task.pageNumber < 1 || task.pageNumber > doc.pdf.pageCount) {
      return { ok: false, error: pastTheEnd(task.pageNumber, doc.pdf.pageCount) };
    }

    const page = await doc.pdf.pageText(task.pageNumber);
    const readable = hasTextLayer(page);
    const block = readable ? titleBlockText(page) : null;

    await deps.saveSheetText({
      planId: ctx.planId,
      pageNumber: task.pageNumber,
      hasTextLayer: readable,
      // Null rather than an empty string when there is nothing to read, so
      // "scanned" and "read but blank" stay distinguishable downstream.
      titleBlockText: block?.text.trim() ? block.text : null,
      wholePageFallback: block?.source === "whole-page",
      widthPt: page.widthPt,
      heightPt: page.heightPt,
      rotation: page.rotation,
    });

    // SUCCESS EVEN WITH NO TEXT LAYER. A scanned sheet is a fact this stage has
    // just recorded, not a failure of it — see `PlanSheetText.hasTextLayer`. A
    // refusal here would spend three attempts and leave a Retry button that can
    // never succeed, on every scanned page of the set.
    return { ok: true };
  };
}

/** The real ports. Kept at the bottom so the stage above reads as logic. */
const realDeps: PageInventoryDeps = {
  // Shared with `startPlanIngest`, which counts the set's pages from the same
  // bytes — see `planBytes.ts` for why neither goes through the viewer's route.
  readPlanBytes,

  openPdf: openPlanPdf,

  saveSheetText: async (row) => {
    const { planId, pageNumber, ...rest } = row;
    await prisma.planSheetText.upsert({
      where: { planId_pageNumber: { planId, pageNumber } },
      create: { planId, pageNumber, ...rest },
      update: rest,
    });
  },
};
