"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { prisma } from "@prova/db";
import { actionFail as fail, actionOk as ok, runAction, type ActionResult } from "./shared";
import { parseNumericInput } from "@/lib/numeric-input";
import { can } from "@/lib/permissions";
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

export type SheetPageInput = { pageNumber: number; widthPt: number; heightPt: number };

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
 * Record the pages of a revision's PDF, once, from what the browser read.
 *
 * THE DIMENSIONS COME FROM THE CLIENT AND THAT IS NOT A SHORTCUT. pdf.js has
 * already opened this document to display it, so the page count and each
 * page's post-/Rotate size at `scale: 1` are known there for free. Asking the
 * server for them would mean a second PDF parse — and server-side pdfjs needs
 * `@napi-rs/canvas`, which this app deliberately does not carry (see
 * `lib/plan-ingest/planPdf.ts`).
 *
 * What stops a client lying: nothing here trusts the numbers for MONEY. A
 * wrong `widthPt` makes pins on that sheet sit wrong for the person who sent
 * it and nobody else, and `@@unique([revisionId, pageNumber])` plus
 * `skipDuplicates` means the FIRST reader's numbers win and later calls cannot
 * overwrite them. The bound is deliberate: this is a display geometry, not a
 * quantity, and `lib/takeoff-plan.ts` draws the same line for the same reason.
 */
export async function ensureSheetPages(revisionId: string, pages: SheetPageInput[]): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    if (!can(context, "MANAGE_JOBS")) return fail(JOBS_ONLY);
    const revision = await prisma.drawingRevision.findFirst({
      where: { id: revisionId, set: { companyId: context.company.id } },
      select: { id: true },
    });
    if (!revision) return fail("That drawing revision is not on this account.");

    const usable = pages.filter(
      (p) =>
        Number.isInteger(p.pageNumber) &&
        p.pageNumber > 0 &&
        Number.isFinite(p.widthPt) &&
        Number.isFinite(p.heightPt) &&
        p.widthPt > 0 &&
        p.heightPt > 0,
    );
    if (usable.length === 0) return fail("That PDF reported no usable pages.");

    await prisma.sheetPage.createMany({
      data: usable.map((p) => ({
        revisionId: revision.id,
        pageNumber: p.pageNumber,
        widthPt: p.widthPt,
        heightPt: p.heightPt,
      })),
      skipDuplicates: true,
    });
    revalidatePath("/drawings");
    return ok;
  });
}
