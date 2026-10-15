"use server";

import { readSheetTextTile, SHEET_TEXT_PROMPT_VERSION, type TextBox } from "@prova/integrations";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { aiGate } from "@/lib/ai/settings";
import { claimAskAllowance, markAskAllowanceFailure } from "@/lib/ask/allowance";
import { recordAskUsage } from "@/lib/ask/usage";
import { tileBoxToSheetItem } from "@/lib/takeoff/rasterText";
import type { SheetTextItem } from "@/lib/takeoff/findWallsOnSheet";
import type { ActionResultWith } from "./shared";

/**
 * ── READING A SHEET THAT WAS SCANNED RATHER THAN EXPORTED ──
 *
 * A scan is a picture. There is no text layer, so the printed scale, the room
 * names and every dimension string are invisible to this app — which is why a
 * scanned sheet is recognised and set aside rather than taken off.
 *
 * `rasterStrokes.ts` already recovers such a sheet's LINES from the pixels,
 * in code. This is the other half, and it is the half a model is for: deciding
 * that a smudge of ink says `1/4" = 1'-0"` is interpretation. The split is
 * ARCHITECTURE.md's and it does not bend here — the model returns WORDS and
 * where they sit, and every length, area and quantity is still measured from
 * the geometry. A dimension's value is read here; the line it belongs to is
 * measured by code; the scale is their quotient.
 *
 * ONE TILE PER CALL, and the viewer sends them one at a time. A whole ARCH D
 * sheet in a single image is a thumbnail by the time the model sees it, and
 * nobody reads a dimension string at 44 dpi. Tiling also keeps the
 * coordinates usable: the model places text within a small window whose own
 * offset on the page is known exactly. Measured on two scanned fixtures
 * against the vector drawings they are rasters of — every printed string read
 * exactly, and 98% placed within the 30 points the pairing allows.
 */

/** The same sentence and the same capability as every other action on this
 *  sheet — the takeoff tab is guarded by `VIEW_JOB_COSTS`, so an action
 *  reachable from it that answered a weaker one would be a hole in that guard.
 *  `action-capability-guards.test.ts` derives this and fails the build. */
const JOB_COSTS_ONLY =
  "A job's costs and pricing aren't part of your job function. The account owner sets who sees what, on the Team page.";

const fail = (error: string): ActionResultWith<SheetTextRead> => ({ ok: false, error });

export type SheetTextRead = {
  /** The words on this tile, already in PAGE coordinates. */
  items: SheetTextItem[];
  /** What the model ran on, for the panel to show beside the result. */
  model: string;
};

export async function readScannedSheetTile(params: {
  imageBase64: string;
  /** Which tile this is, across and down, counting from zero. */
  tileX: number;
  tileY: number;
  /** The tile's side in points, so the caller and this agree on the grid. */
  tilePt: number;
}): Promise<ActionResultWith<SheetTextRead>> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return fail(JOB_COSTS_ONLY);
  const company = context.company;

  if (!Number.isInteger(params.tileX) || !Number.isInteger(params.tileY) || params.tileX < 0 || params.tileY < 0) {
    return fail("That tile is not on the sheet.");
  }
  if (!(params.tilePt > 0) || !Number.isFinite(params.tilePt)) {
    return fail("That tile has no size.");
  }
  if (params.imageBase64.length > 7_000_000) {
    return fail("That image is too large to send. Read a smaller part of the sheet.");
  }

  // THE SWITCH FIRST, before the image is looked at or anything is claimed.
  // This sends a PICTURE of the customer's drawing, which makes it one of the
  // two features here most worth being able to refuse.
  const gate = await aiGate(company.id, "SHEET_TEXT");
  if (!gate.ok) {
    return fail(`${gate.error} The lines on a scanned sheet are still measured — the writing is what this reads.`);
  }

  // ONE PAGE PER TILE, claimed BEFORE the call: one tile is one image and one
  // request. A refused claim stops here with nothing charged and the model
  // never reached.
  const spend = await claimAskAllowance(company.id, { questions: 0, pages: 1 });
  if (!spend.ok) return fail(spend.error);

  let boxes: TextBox[];
  try {
    boxes = await readSheetTextTile({
      imageBase64: params.imageBase64,
      model: gate.model,
      onUsage: (usage: Parameters<typeof recordAskUsage>[0]["usage"]) =>
        recordAskUsage({
          companyId: company.id,
          userId: context.id,
          model: gate.model,
          usage,
          outcome: "answered",
          feature: "sheet-text",
          // THE CONSTANT, not a copy of it — two spellings of a version is how
          // one of them stops being true.
          promptVersion: SHEET_TEXT_PROMPT_VERSION,
        }),
    });
  } catch {
    await markAskAllowanceFailure(spend.claim);
    // The thrown message is redacted in production, so it is not shown. What
    // an estimator can act on is that the sheet is unread and retryable.
    return fail("That part of the sheet could not be read just now. Try it again in a moment.");
  }

  return {
    ok: true,
    value: {
      items: boxes.map((b) => tileBoxToSheetItem(b, params.tileX, params.tileY, params.tilePt)),
      model: gate.model,
    },
  };
}
