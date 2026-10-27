"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { NOT_ESTIMATE_STAGE } from "@/lib/estimating/draft-lines";
import { parseWallHeightArg, wallHeightQuestions } from "@/lib/bid/guide/wallHeight";
import { boardLayerQuestions, parseBoardLayersArg } from "@/lib/bid/guide/boardLayers";
import { applyBidRecap } from "./bidRecap";
import { usePastPrice as applyPastPrice } from "./bidGuidePastPrice";
import { refreshWallSchedule, updateWallType } from "./wallTypes";
import { actionFail, actionOk, type ActionResult } from "./shared";
import { syncTakeoffItemLines } from "@/lib/estimating/takeoff-item-lines";

/**
 * The server side of the buttons on a job's guide card (`GuideAction.actionId`
 * in `lib/bid/guide/types.ts`).
 *
 * THE GUIDE ONLY NAMES AN ACTION; it carries no figure. Each case below
 * re-reads everything it needs on this side — `applyBidRecap` re-runs the recap
 * maths from the job's own lines and rates, so nothing a browser posts can
 * change what is written (ARCHITECTURE.md: the model narrates, code computes).
 *
 * Gate: MANAGE_ESTIMATING, the one capability the whole Bid surface asks for.
 * `applyBidRecap` additionally asserts VIEW_JOB_COSTS and that the job is this
 * company's and still an estimate; its refusal sentence is passed through as it
 * is. `setWallHeight` and `setBoardLayers` additionally need VIEW_JOB_COSTS,
 * because answering either refreshes the estimate's wall lines (see
 * `setWallHeight` below). Every refusal is RETURNED, never thrown — production redacts a thrown
 * message (CLAUDE.md, Errors).
 *
 * `actionId` is a plain string at this boundary, not `GuideActionId`: a Server
 * Action's arguments come from the network, so an id this build does not know is
 * answered with a sentence rather than trusted to be in the union.
 */
export async function runGuideAction(jobId: string, actionId: string, actionArg?: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) {
    return actionFail(
      "Estimating isn't part of your job function. The account owner sets who sees what, on the Team page.",
    );
  }
  switch (actionId) {
    case "applyRecap": {
      const result = await applyBidRecap(jobId);
      if (!result.ok) return actionFail(result.error);
      // The guide lives in the Bid layout, which `applyBidRecap`'s own
      // revalidation (the CRM job paths) does not reach.
      revalidatePath(`/bid/estimates/${jobId}`, "layout");
      return actionOk;
    }
    case "usePastPrice": {
      // `actionArg` is the suggestion's own `wt:<id>:<token>`; the action
      // re-derives the suggestion server-side and refuses a stale one, so the
      // browser chooses WHICH suggestion, never the figures.
      if (typeof actionArg !== "string" || actionArg.length === 0) {
        return actionFail("That price suggestion is no longer available. Reload the page.");
      }
      const result = await applyPastPrice(jobId, actionArg);
      if (!result.ok) return actionFail(result.error);
      revalidatePath(`/bid/estimates/${jobId}`, "layout");
      return actionOk;
    }
    case "setWallHeight": {
      const result = await setWallHeight(jobId, actionArg);
      if (!result.ok) return result;
      revalidatePath(`/bid/estimates/${jobId}`, "layout");
      revalidatePath("/bid/wall-types");
      return actionOk;
    }
    case "setBoardLayers": {
      const result = await setBoardLayers(jobId, actionArg);
      if (!result.ok) return result;
      revalidatePath(`/bid/estimates/${jobId}`, "layout");
      revalidatePath("/bid/wall-types");
      return actionOk;
    }
    default:
      return actionFail("That action isn't one this screen knows how to run.");
  }
}

const JOB_COSTS_ONLY =
  "A job's costs and pricing aren't part of your job function. The account owner sets who sees what, on the Team page.";
const NO_JOB = "That job isn't on your account any more.";
const BAD_HEIGHT = "That answer isn't one this page can apply. Reload the job and try again.";
const STALE_HEIGHT =
  "Those walls have changed since you saw the question — a height was set, or a run was added or removed. Reload the job to see where it stands.";
const EDIT_IN_LIBRARY = (code: string) =>
  `${code} would be renamed if it were saved from here. Set its height on your wall types page instead, with "Another height".`;

const BAD_LAYERS = "That answer isn't one this page can apply. Reload the job and try again.";
const STALE_LAYERS =
  "Those walls have changed since you saw the question — the layers were set, a per-layer part was changed, or a run was added or removed. Reload the job to see where it stands.";
const EDIT_LAYERS_IN_LIBRARY = (code: string) =>
  `${code} would be renamed if it were saved from here. Set its board layers on your wall types page instead.`;

/** Would `updateWallType`'s own normalising leave every field but the answer as it is? */
function roundTrips(type: { code: string; name: string; notes: string | null }): boolean {
  const notes = type.notes ?? "";
  return type.code === type.code.trim().toUpperCase() && type.name === type.name.trim() && notes === notes.trim();
}

/** The wall-type columns a tap answer re-sends, read the same way by both questions. */
const WALL_TYPE_ROW = {
  id: true,
  code: true,
  name: true,
  sides: true,
  studSpacingIn: true,
  notes: true,
  defaultHeightFt: true,
  thicknessIn: true,
  boardLayers: true,
} as const;

type Decimalish = { toString(): string };

type WallTypeRowForForm = {
  code: string;
  name: string;
  sides: number;
  studSpacingIn: Decimalish;
  notes: string | null;
  defaultHeightFt: Decimalish | null;
  thicknessIn: Decimalish | null;
  boardLayers: number | null;
};

/**
 * ── THE ROW AS IT STANDS, WITH ONE ANSWER CHANGED ──
 *
 * `updateWallType` writes every field its form names, so a tap answer re-sends
 * the whole row. ONE builder for both tap answers, and it sends every column
 * the library's own form sends — the thickness included. The height answer
 * used to build its own form without `thicknessIn`, and `updateWallType` read
 * the missing key as blank: answering "how tall are the W2 walls?" quietly
 * CLEARED W2's thickness, which is what the wall finder matches a drawn group
 * on. (`updateWallType` now also leaves an unsent thickness alone; this is the
 * other half, so neither side relies on the other.)
 */
function wallTypeForm(type: WallTypeRowForForm, answer: { defaultHeightFt?: number; boardLayers?: number }): FormData {
  const asText = (value: Decimalish | number | null): string => (value == null ? "" : value.toString());
  const form = new FormData();
  form.set("code", type.code);
  form.set("name", type.name);
  form.set("sides", String(type.sides));
  form.set("studSpacingIn", type.studSpacingIn.toString());
  form.set("notes", type.notes ?? "");
  form.set("thicknessIn", asText(type.thicknessIn));
  form.set("defaultHeightFt", asText(answer.defaultHeightFt ?? type.defaultHeightFt));
  form.set("boardLayers", asText(answer.boardLayers ?? type.boardLayers));
  return form;
}

/**
 * "How tall are the W2 walls?" — the answer, from a tap (`lib/bid/guide/wallHeight.ts`).
 *
 * NOT EXPORTED, on purpose: it is a case of `runGuideAction`, the screen's one
 * dispatcher, not a second Server Action somebody could call (or Ask could
 * name) without the question in front of them.
 *
 * `arg` is `wh:<WallType id>:<height>:<token>`. Nothing in it is believed: the
 * height must be one of the offered answers, and the QUESTION is re-derived
 * here from this company's rows by the same `wallHeightQuestions` the screen
 * used. If it no longer matches the token — a default height already set, a run
 * given its own height, a run added or removed — it is refused as stale rather
 * than applied to a different set of walls.
 *
 * THE WRITE GOES THROUGH THE EXISTING ACTIONS, never raw prisma:
 *   1. `updateWallType` sets the type's `defaultHeightFt`, re-sending every other
 *      field as it stands (that action writes the whole row), under its own gate
 *      (MANAGE_ESTIMATING, checked again here by the caller) and company scope;
 *   2. `refreshWallSchedule` re-applies the wall types to THIS job's runs, so the
 *      walls that were adding nothing become lines now. The library's own rule
 *      is that a type edit reaches an estimate only through that deliberate
 *      door, pressed on the job — and the confirm the person pressed says so. It
 *      moves quantities and hours only; a price typed on a line stays, and a
 *      line a person deleted stays deleted (`syncWallScheduleLines`).
 *
 * VIEW_JOB_COSTS (the refresh's gate) is checked BEFORE anything is written, so a
 * person who may set heights but not touch an estimate is refused whole rather
 * than left with half an answer. The two writes are separate transactions (each
 * action owns its own); if the second refuses after the first wrote, the height
 * stands and the estimate's "Refresh from wall types" finishes the job.
 */
async function setWallHeight(jobId: string, actionArg: string | undefined): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  const companyId = context.company.id;

  const parsed = parseWallHeightArg(actionArg);
  if (!parsed || typeof jobId !== "string" || jobId.length === 0) return actionFail(BAD_HEIGHT);

  const job = await prisma.job.findFirst({ where: { id: jobId, companyId }, select: { id: true, status: true } });
  if (!job) return actionFail(NO_JOB);
  if (job.status !== "ESTIMATE") return actionFail(NOT_ESTIMATE_STAGE);

  const [type, runs] = await Promise.all([
    prisma.wallType.findFirst({
      where: { id: parsed.wallTypeId, companyId },
      select: { ...WALL_TYPE_ROW, _count: { select: { components: true } } },
    }),
    prisma.wallRun.findMany({
      where: { jobId, companyId, wallTypeId: parsed.wallTypeId },
      select: { id: true, wallTypeId: true, lengthFt: true, heightFt: true },
    }),
  ]);
  if (!type) return actionFail(STALE_HEIGHT);

  const question = wallHeightQuestions(
    runs.map((run) => ({
      id: run.id,
      wallTypeId: run.wallTypeId,
      lengthFt: Number(run.lengthFt),
      heightFt: run.heightFt == null ? null : Number(run.heightFt),
    })),
    [
      {
        id: type.id,
        code: type.code,
        defaultHeightFt: type.defaultHeightFt == null ? null : Number(type.defaultHeightFt),
        componentCount: type._count.components,
      },
    ],
  ).find((q) => q.wallTypeId === type.id);
  if (!question || question.token !== parsed.token) return actionFail(STALE_HEIGHT);

  // `updateWallType` normalises what it is given — the tag upper-cased, the
  // name and notes trimmed. A row written by another path (a partition schedule
  // keeps the architect's "W2a") would be quietly RENAMED by a tap meant to set
  // a height, and a rename can collide with another tag. So a row that would not
  // survive the round trip unchanged is refused, and the person sets the height
  // in the library, where the whole row is in front of them. Found by the
  // dbtest, whose first tag was lower-case.
  if (!roundTrips(type)) return actionFail(EDIT_IN_LIBRARY(type.code));

  // The row as it stands, with the one answer changed: `updateWallType` writes
  // every field it is given, so every field is given (`wallTypeForm`).
  const updated = await updateWallType(type.id, wallTypeForm(type, { defaultHeightFt: parsed.heightFt }));
  if (!updated.ok) return updated;

  const refreshed = await refreshWallSchedule(jobId);
  if (!refreshed.ok) return actionFail(refreshed.error);
  await resyncTakeoffItemLines(companyId, jobId, type.id);
  return actionOk;
}

/**
 * "How many layers of board are on the W2 walls?" — the answer, from a tap
 * (`lib/bid/guide/boardLayers.ts`). The same shape as `setWallHeight` above,
 * deliberately, and NOT EXPORTED for the same reason.
 *
 * `arg` is `bl:<WallType id>:<layers>:<token>`. The count must be one of the
 * offered answers, and the QUESTION is re-derived here from this company's
 * rows by the same `boardLayerQuestions` the screen used: if the type was
 * answered since, lost its last per-layer part, or this job's runs or takeoff
 * items of it changed, there is no matching question and the tap is refused as
 * stale rather than applied to a different wall.
 *
 * The write is `updateWallType` (the row as it stands, `boardLayers` changed)
 * then `refreshWallSchedule` for this job, under VIEW_JOB_COSTS checked before
 * anything is written — exactly the height answer's pair — and then
 * `resyncTakeoffItemLines`, so traced walls of the type move with its runs.
 */
async function setBoardLayers(jobId: string, actionArg: string | undefined): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  const companyId = context.company.id;

  const parsed = parseBoardLayersArg(actionArg);
  if (!parsed || typeof jobId !== "string" || jobId.length === 0) return actionFail(BAD_LAYERS);

  const job = await prisma.job.findFirst({ where: { id: jobId, companyId }, select: { id: true, status: true } });
  if (!job) return actionFail(NO_JOB);
  if (job.status !== "ESTIMATE") return actionFail(NOT_ESTIMATE_STAGE);

  const [type, runs, items] = await Promise.all([
    prisma.wallType.findFirst({
      where: { id: parsed.wallTypeId, companyId },
      select: { ...WALL_TYPE_ROW, components: { select: { perLayer: true } } },
    }),
    prisma.wallRun.findMany({
      where: { jobId, companyId, wallTypeId: parsed.wallTypeId },
      select: { id: true, wallTypeId: true, lengthFt: true },
    }),
    // The takeoff items priced through this type: the question counts them,
    // so the token covers them (`boardLayerQuestions`).
    prisma.takeoffItem.findMany({
      where: { jobId, companyId, wallTypeId: parsed.wallTypeId },
      select: { id: true },
    }),
  ]);
  if (!type) return actionFail(STALE_LAYERS);

  const question = boardLayerQuestions(
    runs.map((run) => ({ id: run.id, wallTypeId: run.wallTypeId, lengthFt: Number(run.lengthFt) })),
    // Only the ids reach the token; the traced length is the screen's words,
    // and a re-trace is the same walls, so it is not re-read here.
    items.map((item) => ({ id: item.id, wallTypeId: type.id, lengthFt: 0 })),
    [
      {
        id: type.id,
        code: type.code,
        sides: type.sides,
        boardLayers: type.boardLayers,
        perLayerCount: type.components.filter((component) => component.perLayer).length,
      },
    ],
  ).find((q) => q.wallTypeId === type.id);
  if (!question || question.token !== parsed.token) return actionFail(STALE_LAYERS);

  // See `setWallHeight`: a row `updateWallType` would rename is refused.
  if (!roundTrips(type)) return actionFail(EDIT_LAYERS_IN_LIBRARY(type.code));

  const updated = await updateWallType(type.id, wallTypeForm(type, { boardLayers: parsed.layers }));
  if (!updated.ok) return updated;

  const refreshed = await refreshWallSchedule(jobId);
  if (!refreshed.ok) return actionFail(refreshed.error);
  await resyncTakeoffItemLines(companyId, jobId, type.id);
  return actionOk;
}

/**
 * ── THE TRACED WALLS MOVE IN THE SAME PRESS AS THE RUNS ──
 *
 * A wall type prices two kinds of estimate line: the wall schedule's (runs,
 * `syncWallScheduleLines`, which `refreshWallSchedule` re-runs) and the
 * takeoff's (traced items, `syncTakeoffItemLines`). The tap answers used to
 * re-run only the first. So "2 layers each side" doubled the RUN lines' board
 * and left the ITEM lines of the same type at one layer — and the next press
 * of "Send takeoff to estimate", for any reason, doubled them silently.
 *
 * So after either answer this re-runs the takeoff's own sync —
 * `syncTakeoffItemLines`, the function `sendTakeoffItemsToEstimate` calls, in
 * a transaction the same way — under the checks the caller has already passed
 * (VIEW_JOB_COSTS, this company's job, still an ESTIMATE).
 *
 * ONLY FOR THIS TYPE'S ITEMS THAT ARE ALREADY ON THE ESTIMATE, through the
 * sync's `onlyItemIds`. The job-wide form is "Send takeoff to estimate", and
 * it CREATES lines for every item with an assembly. Run from here it put a
 * DIFFERENT type's traced wall — one nobody had sent — onto the bid, in a
 * press that was about W1's board (`bidGuideBoardLayersItems.dbtest.ts`
 * caught it). An item of this type that is not on the estimate yet has
 * nothing the answer could leave stale: the next Send prices it from the type
 * as it now stands.
 *
 * For the height answer this changes no item quantity — an item carries its
 * own height and never reads the type's default (`itemGeometry`) — and is run
 * anyway so the two answers leave a job's estimate in the same state: the
 * type's lines, run and traced, re-derived from the type as it now stands.
 */
async function resyncTakeoffItemLines(companyId: string, jobId: string, wallTypeId: string): Promise<void> {
  const sent = await prisma.takeoffItem.findMany({
    where: { jobId, companyId, wallTypeId, lineItems: { some: { isDeleted: false } } },
    select: { id: true },
  });
  if (sent.length === 0) return;
  const onlyItemIds = sent.map((item) => item.id);
  await prisma.$transaction((tx) => syncTakeoffItemLines(tx, companyId, jobId, onlyItemIds));
  revalidatePath(`/jobs/${jobId}/estimate`);
  revalidatePath(`/jobs/${jobId}/takeoff`);
  revalidatePath(`/takeoff/${jobId}`);
}
