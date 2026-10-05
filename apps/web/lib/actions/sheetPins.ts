"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { prisma } from "@prova/db";
import { actionFail as fail, actionOk as ok, runAction, type ActionResult } from "./shared";
import { parseNumericInput } from "@/lib/numeric-input";
import { can } from "@/lib/permissions";
import { isOurBlobStoreUrl } from "@/lib/blob-urls";
import {
  parseSheetPages,
  pinContentProblem,
  pinPlacementProblem,
  type SheetPinKind,
} from "@/lib/sheet-pins";

/**
 * MARKS ON A DRAWING SHEET.
 *
 * Same capability as the rest of `/drawings` — MANAGE_JOBS — and for the reason
 * `drawings.ts` states at length: a guarded PAGE in front of an open action is
 * not a guard, because a Server Action is its own endpoint and answers whoever
 * posts to it. Every function here re-checks.
 *
 * WHY REMOVING A PIN IS NOT OWNER-ONLY, which is a deliberate departure from
 * the delete rules on the records around it. A drawing set is an evidence
 * record: which revision governed on which date is the thing that gets read
 * back when somebody asks why the crew built what they built. A PIN is not that
 * — it is a working mark a foreman puts on a sheet while standing in the
 * building, and the person who placed it is exactly who notices it is in the
 * wrong spot. Making it owner-only would mean the only people who can fix a
 * misplaced mark are the people who are not there. The two-step confirm in the
 * UI is the protection, not a capability gate.
 *
 * Every refusal is RETURNED, never thrown: production redacts a thrown Server
 * Action message to a digest, so the sentence explaining why nothing happened
 * would never reach the person holding the phone.
 */

const JOBS_ONLY =
  "Job correspondence isn't part of your job function. The account owner sets who sees what, on the Team page.";

/** A page, scoped to the caller's company through its revision and set. The
 * join is the authorisation: a page id alone proves nothing about who owns it. */
async function findPage(pageId: string, companyId: string) {
  return prisma.sheetPage.findFirst({
    where: { id: pageId, revision: { set: { companyId } } },
    select: { id: true, widthPt: true, heightPt: true, revision: { select: { setId: true } } },
  });
}

/** One coordinate off a form. `parseNumericInput` rather than `Number()`
 * because a Server Action is its own endpoint: it answers whoever posts to it,
 * and a bare `Number()` accepts `0x10` and `Infinity` and hands them to a
 * double-precision column. These values are written by a click handler rather
 * than typed, which is exactly why the lax parser would never be caught here. */
function parseCoordinate(raw: FormDataEntryValue | null, label: string): number | string {
  const parsed = parseNumericInput(raw, { label });
  return parsed.ok ? parsed.n : parsed.error;
}

function parsePoint(formData: FormData): { x: number | string; y: number | string } {
  return { x: parseCoordinate(formData.get("x"), "x"), y: parseCoordinate(formData.get("y"), "y") };
}


export async function createSheetPin(pageId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    if (!can(context, "MANAGE_JOBS")) return fail(JOBS_ONLY);

    const page = await findPage(pageId, context.company.id);
    if (!page) return fail("That sheet is not on this account.");

    const kind = String(formData.get("kind") ?? "") as SheetPinKind;
    if (!["PHOTO", "PUNCH", "NOTE"].includes(kind)) return fail("Pick what this pin points at.");

    const { x, y } = parsePoint(formData);
    if (typeof x === "string") return fail(x);
    if (typeof y === "string") return fail(y);
    const placement = pinPlacementProblem(x, y, page);
    if (placement) return fail(placement);

    const mediaId = (formData.get("mediaId") as string | null) || null;
    const punchItemId = (formData.get("punchItemId") as string | null) || null;
    const note = (formData.get("note") as string | null)?.trim() || null;

    const content = pinContentProblem(kind, { mediaId, punchItemId, note });
    if (content) return fail(content);

    // The target must belong to this company too. Without these two checks a
    // pin could reference another account's photo by id, and the pin would
    // render it.
    if (mediaId) {
      const media = await prisma.jobMedia.findFirst({
        where: { id: mediaId, job: { companyId: context.company.id } },
        select: { id: true },
      });
      if (!media) return fail("That photo is not on this account.");
    }
    if (punchItemId) {
      const item = await prisma.punchListItem.findFirst({
        where: { id: punchItemId, job: { companyId: context.company.id } },
        select: { id: true },
      });
      if (!item) return fail("That punch item is not on this account.");
    }

    await prisma.sheetPin.create({
      data: {
        companyId: context.company.id,
        pageId: page.id,
        x,
        y,
        kind,
        mediaId: kind === "PHOTO" ? mediaId : null,
        punchItemId: kind === "PUNCH" ? punchItemId : null,
        note: kind === "NOTE" ? note : null,
        createdByUserId: context.id,
      },
    });
    revalidatePath("/drawings");
    return ok;
  });
}

export async function deleteSheetPin(pinId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    if (!can(context, "MANAGE_JOBS")) return fail(JOBS_ONLY);
    const pin = await prisma.sheetPin.findFirst({
      where: { id: pinId, page: { revision: { set: { companyId: context.company.id } } } },
      select: { id: true },
    });
    if (!pin) return fail("That pin is not on this account.");
    await prisma.sheetPin.delete({ where: { id: pin.id } });
    revalidatePath("/drawings");
    return ok;
  });
}



/**
 * THE DRAWING ITSELF, UPLOADED INTO OUR OWN STORE.
 *
 * **WHY A FILE AND NOT A LINK, which is the decision this whole function is.**
 * `DrawingRevision.fileUrl` began as a link to wherever the drawing actually
 * lived — Procore, Box, a GC portal — and the form still says so. That is fine
 * for a human clicking through to read it, and it cannot support pinning:
 *
 *   - the BROWSER cannot read a cross-origin PDF without
 *     `Access-Control-Allow-Origin`, which none of those send;
 *   - and the SERVER cannot fetch one that is behind a login either.
 *
 * Both of those were measured on production on 2026-10-05, in that order, each
 * after a fix for the previous one. The answer is the one photos have used all
 * along: the file goes into OUR store, and then everything that needs to read
 * it can.
 *
 * **NOTHING IS RENDERED ON THE SERVER.** The page images arrive already drawn,
 * because the browser doing the uploading HAS THE BYTES IN ITS HAND and has a
 * canvas natively. The server-side rasteriser this replaced needed
 * `@napi-rs/canvas`, which needed `serverExternalPackages`, which stopped
 * Vercel tracing the binary into the function — a runtime failure with every
 * check green. That whole chain is deleted rather than fixed.
 */
export async function uploadDrawingPdf(
  revisionId: string,
  fileUrl: string,
  fileName: string,
  pagesJson: string,
): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    if (!can(context, "MANAGE_JOBS")) return fail(JOBS_ONLY);

    const revision = await prisma.drawingRevision.findFirst({
      where: { id: revisionId, set: { companyId: context.company.id } },
      select: { id: true },
    });
    if (!revision) return fail("That drawing revision is not on this account.");

    // The URL has to be one our own store issued. Without this, the field
    // would accept any URL at all and the "upload" would be a link again --
    // which is the whole thing this feature exists to stop.
    // OUR store, not merely "a Vercel store" -- `lib/blob-urls.ts` exists
    // because that distinction is the provenance hole #195 closed on photos,
    // and the same hole would be open here: without it this field accepts any
    // URL and the "upload" is a link again, which is the thing this feature
    // exists to stop.
    if (!isOurBlobStoreUrl(fileUrl, process.env)) {
      return fail("That file did not come from this app's storage.");
    }

    const pages = parseSheetPages(pagesJson);
    if (pages === null) return fail("That PDF's pages could not be read.");
    if (pages.length === 0) return fail("That PDF has no pages.");

    await prisma.$transaction([
      prisma.drawingRevision.update({
        where: { id: revision.id },
        data: { fileUrl, fileName: fileName || "drawing.pdf" },
      }),
      prisma.sheetPage.createMany({
        data: pages.map((page) => ({
          revisionId: revision.id,
          pageNumber: page.pageNumber,
          widthPt: page.widthPt,
          heightPt: page.heightPt,
        })),
        skipDuplicates: true,
      }),
    ]);
    revalidatePath("/drawings");
    return ok;
  });
}

/** One sheet's picture, drawn by the browser from the PDF it just uploaded. */
export async function storeSheetImage(
  pageId: string,
  imageUrl: string,
  widthPxRaw: string,
): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    if (!can(context, "MANAGE_JOBS")) return fail(JOBS_ONLY);

    const page = await prisma.sheetPage.findFirst({
      where: { id: pageId, revision: { set: { companyId: context.company.id } } },
      select: { id: true, imageUrl: true },
    });
    if (!page) return fail("That sheet is not on this account.");
    if (page.imageUrl) return ok; // already drawn; doing nothing is success

    if (!isOurBlobStoreUrl(imageUrl, process.env)) {
      return fail("That picture did not come from this app's storage.");
    }

    // `parseNumericInput` and not a bare `Number()`, for the reason
    // `numericInputCensus.test.ts` states: a Server Action answers whoever
    // posts to it, and `Number()` accepts `0x10` and `Infinity`. The value
    // comes from a canvas rather than a keyboard, which is exactly why the lax
    // parser would never be noticed here.
    const width = parseNumericInput(widthPxRaw, { label: "The sheet width", integer: true, min: 1 });
    if (!width.ok) return fail(width.error);

    await prisma.sheetPage.update({
      where: { id: page.id },
      data: { imageUrl, imageWidthPx: width.n },
    });
    revalidatePath("/drawings");
    return ok;
  });
}
