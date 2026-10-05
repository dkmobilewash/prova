"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { prisma } from "@prova/db";
import { actionFail as fail, actionOk as ok, runAction, type ActionResult } from "./shared";
import { parseNumericInput } from "@/lib/numeric-input";
import { can } from "@/lib/permissions";
import { put } from "@vercel/blob";
import { rasterisePage, readPageSizes } from "@/lib/sheet-raster";
import { pinContentProblem, pinPlacementProblem, type SheetPinKind } from "@/lib/sheet-pins";

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
 * Record the pages of a revision's PDF, once, by READING IT ON THE SERVER.
 *
 * **IT USED TO TAKE THE DIMENSIONS FROM THE BROWSER AND THAT COULD NOT WORK.**
 * The reasoning was that pdf.js is already open to display the drawing, so the
 * page count and sizes are free there and the server needs no PDF parse. It is
 * also impossible for the files this app holds: `fileUrl` is a LINK to wherever
 * the drawing lives — the field's own help text says "Procore, Box, the GC's
 * portal" — and a browser can only read a cross-origin PDF when the host sends
 * `Access-Control-Allow-Origin`. None of those do. Found on production
 * 2026-10-05, where the server fetched the probe file fine (200, 13,264 bytes)
 * and the browser could not read a byte of it.
 *
 * Reading it here removes the CORS requirement AND the question the old version
 * had to answer about trusting a client's numbers: nothing comes from the
 * client now.
 *
 * `skipDuplicates` behind `@@unique([revisionId, pageNumber])` makes this safe
 * to call repeatedly, so two people opening the same revision cannot double-
 * write and a retry is free.
 */
export async function ensureSheetPages(revisionId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    if (!can(context, "MANAGE_JOBS")) return fail(JOBS_ONLY);
    const revision = await prisma.drawingRevision.findFirst({
      where: { id: revisionId, set: { companyId: context.company.id } },
      select: { id: true, fileUrl: true },
    });
    if (!revision) return fail("That drawing revision is not on this account.");
    if (!revision.fileUrl) return fail("That revision has no drawing attached.");

    const already = await prisma.sheetPage.count({ where: { revisionId: revision.id } });
    if (already > 0) return ok; // already read; nothing to do is success

    // TWO FAILURES, TWO MESSAGES, and that is a correction rather than a
    // nicety. These were one try/catch, so a PARSE failure reported itself as
    // "could not be fetched" — and on 2026-10-05 that sent the investigation
    // at the network for an hour while the real cause (a native module missing
    // from the serverless function) sat in Vercel's runtime log. An error
    // message that names the wrong half is worse than a vague one.
    let bytes: Buffer;
    try {
      const response = await fetch(revision.fileUrl);
      if (!response.ok) {
        return fail(
          "That drawing could not be fetched. The link has to be one this app can open without signing in — a file behind Procore or a GC portal cannot be read from here.",
        );
      }
      bytes = Buffer.from(await response.arrayBuffer());
    } catch {
      return fail(
        "That drawing could not be reached. The link has to be one this app can open without signing in.",
      );
    }

    let pages: { pageNumber: number; widthPt: number; heightPt: number }[];
    try {
      pages = await readPageSizes(bytes);
    } catch (error) {
      // Logged as well as returned: a parse failure is this app's problem, not
      // the user's, and the sentence they see cannot carry what a maintainer
      // needs.
      console.error("[sheets] could not read the PDF", error);
      return fail("That file was fetched but could not be read as a PDF.");
    }
    if (pages.length === 0) return fail("That PDF reported no usable pages.");

    await prisma.sheetPage.createMany({
      data: pages.map((page) => ({
        revisionId: revision.id,
        pageNumber: page.pageNumber,
        widthPt: page.widthPt,
        heightPt: page.heightPt,
      })),
      skipDuplicates: true,
    });
    revalidatePath("/drawings");
    return ok;
  });
}

/**
 * Render a revision's sheets to images, so the PHONE has something to draw on.
 *
 * `apps/mobile` has no PDF renderer and no WebView — `react-native-svg` is its
 * only graphics dependency — so the field half of pinning is an `<Image>` of
 * this raster with an SVG overlay. That choice is what keeps the phone free of
 * a new native module, and it is why this runs on the server at all.
 *
 * ONE PAGE PER CALL, ON PURPOSE. A plan set is tens of sheets at a couple of
 * megabytes each; rendering them in one request is a function timeout waiting
 * to happen, and a partial failure would leave no way to tell which sheets had
 * been done. A page that already has an `imageUrl` is skipped, so calling this
 * repeatedly walks the set forwards and is safe to retry.
 *
 * It returns ok with nothing left to do rather than failing, because "every
 * sheet is already rendered" is success, not an error.
 */
export async function rasteriseNextSheet(revisionId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    if (!can(context, "MANAGE_JOBS")) return fail(JOBS_ONLY);

    const revision = await prisma.drawingRevision.findFirst({
      where: { id: revisionId, set: { companyId: context.company.id } },
      select: { id: true, fileUrl: true },
    });
    if (!revision) return fail("That drawing revision is not on this account.");
    if (!revision.fileUrl) return fail("That revision has no drawing attached.");

    const next = await prisma.sheetPage.findFirst({
      where: { revisionId: revision.id, imageUrl: null },
      orderBy: { pageNumber: "asc" },
      select: { id: true, pageNumber: true },
    });
    if (!next) return ok; // every sheet is rendered; nothing to do is success

    const response = await fetch(revision.fileUrl);
    if (!response.ok) {
      return fail("That drawing could not be fetched, so its sheets could not be rendered.");
    }
    const bytes = Buffer.from(await response.arrayBuffer());

    const raster = await rasterisePage(bytes, next.pageNumber);
    const stored = await put(`sheets/${revision.id}/${next.pageNumber}.png`, raster.png, {
      access: "public",
      addRandomSuffix: true,
      contentType: "image/png",
    });

    await prisma.sheetPage.update({
      where: { id: next.id },
      data: { imageUrl: stored.url, imageWidthPx: raster.widthPx },
    });
    revalidatePath("/drawings");
    return ok;
  });
}
