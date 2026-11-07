"use server";

import { countItemFor } from "@/lib/takeoff/countItem";
import { storedWindowsOf, windowItemName, WINDOWS_SUGGESTED } from "@/lib/takeoff/windowTags";
import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { actionFail, actionOk, ownerRefusal, type ActionResult, type ActionResultWith } from "./shared";

const SETTINGS_ONLY =
  "The company's settings aren't part of your job function. The account owner sets who sees what, on the Team page.";
/** The same words every takeoff action refuses with — the capability census reads the sentence, not the intent. */
const JOB_COSTS_ONLY =
  "A job's costs and pricing aren't part of your job function. The account owner sets who sees what, on the Team page.";

/** "Count like this": ON for every company unless its owner turns it off — the box ticked means on, stored as `symbolCountOff: false`. */
export async function saveSymbolCountSwitch(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return actionFail(SETTINGS_ONLY);
  const refusal = ownerRefusal(
    context,
    "Only the account owner can turn this on or off — it changes what every estimator sees on the takeoff.",
  );
  if (refusal) return refusal;
  const on = formData.get("symbolCountOn") === "on";
  await prisma.company.update({ where: { id: context.company.id }, data: { symbolCountOff: !on } });
  revalidatePath("/settings");
  return actionOk;
}

/**
 * ── ONE COUNT ACROSS THE SET: a measurement per sheet, one item ──
 *
 * The viewer walks the set in the browser (`searchAcrossSheets`) and sends
 * the kept points per sheet here in page-width units. A count needs no scale,
 * so every sheet saves, whatever its discipline and whether or not anybody
 * has opened it; a sheet with no page row gets one. A sheet with a scale
 * records it, and one without records none. Every measurement carries the
 * same label and the same item, so the job sees one count with a per-sheet
 * breakdown rather than a count per sheet.
 */
export type AcrossSheetsInput = {
  label: string;
  itemId?: string | null;
  sheets: { pageNumber: number; xs: number[]; ys: number[] }[];
};

export type AcrossSheetsResult = {
  saved: { pageNumber: number; count: number; measurementId: string }[];
  total: number;
};

const MAX_SHEETS = 500;
const MAX_POINTS = 5000;

export async function saveSymbolCountAcrossSheets(jobId: string, planId: string, input: AcrossSheetsInput): Promise<ActionResultWith<AcrossSheetsResult>> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  const { company, id: userId } = context;
  const plan = await prisma.takeoffPlan.findFirst({ where: { id: planId, jobId, companyId: company.id }, select: { id: true } });
  if (!plan) return actionFail("That plan is no longer on this job. Reload the page.");
  const label = input.label.trim();
  if (!label) return actionFail("Name what you're counting — that name becomes the line item.");
  if (label.length > 120) return actionFail("That name is too long for the list. Keep it under 120 characters.");
  const sheets = (input.sheets ?? []).filter((s) => Number.isInteger(s.pageNumber) && s.pageNumber >= 1 && s.xs.length > 0 && s.xs.length === s.ys.length);
  if (sheets.length === 0) return actionFail("Nothing to save: no sheet had a match kept.");
  if (sheets.length > MAX_SHEETS) return actionFail(`That is more than ${MAX_SHEETS} sheets at once.`);
  for (const s of sheets) {
    if (s.xs.length > MAX_POINTS) return actionFail(`Sheet ${s.pageNumber} has more than ${MAX_POINTS} matches; drop some before saving.`);
    if (![...s.xs, ...s.ys].every((v) => Number.isFinite(v) && v >= -0.5 && v <= 3)) return actionFail(`Sheet ${s.pageNumber}'s points did not come through. Count again.`);
  }
  const itemId = (input.itemId ?? "").trim();
  if (itemId !== "") {
    const item = await prisma.takeoffItem.findFirst({ where: { id: itemId, jobId, companyId: company.id }, select: { id: true } });
    if (!item) return actionFail("That takeoff item is no longer on this job. Reload the page.");
  }

  const owner = itemId !== "" ? itemId : await countItemFor(company.id, jobId, label);
  const saved: AcrossSheetsResult["saved"] = [];
  for (const s of sheets) {
    const page = await prisma.takeoffPlanPage.upsert({
      where: { planId_pageNumber: { planId: plan.id, pageNumber: s.pageNumber } },
      create: { planId: plan.id, pageNumber: s.pageNumber },
      update: {},
      select: { id: true, calibrations: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true } } },
    });
    const created = await prisma.takeoffMeasurement.create({
      select: { id: true },
      data: { itemId: owner, pageId: page.id, calibrationId: page.calibrations[0]?.id ?? null, kind: "COUNT", xs: s.xs, ys: s.ys, label, createdByUserId: userId },
    });
    saved.push({ pageNumber: s.pageNumber, count: s.xs.length, measurementId: created.id });
  }
  revalidatePath(`/jobs/${jobId}/takeoff`);
  revalidatePath(`/takeoff/${jobId}`);
  return { ok: true, value: { saved, total: saved.reduce((t, s) => t + s.count, 0) } };
}

/**
 * ── A SHEET'S SUGGESTED WINDOWS, CONFIRMED FROM THE REVIEW QUEUE ──
 *
 * `kept` is the windows the estimator did not drop, as indexes into the stored
 * suggestion. Each type's kept windows become one count on the sheet, on that
 * type's count item ("Windows — A"), and the suggestion is marked decided so a
 * re-run never offers it again. Keeping none is a decision too: nothing posts.
 */
/**
 * What Undo needs to take a window confirm back (Chrome on Baker: "Confirm 9" could
 * not be undone): the counts it wrote, and the count items it made for them.
 */
export type WindowsUndo = { measurements: string[]; items: string[] };

export async function confirmWindows(jobId: string, planId: string, pageNumber: number, kept: readonly number[]): Promise<ActionResultWith<{ undo: WindowsUndo }>> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  const { company, id: userId } = context;
  const plan = await prisma.takeoffPlan.findFirst({ where: { id: planId, jobId, companyId: company.id }, select: { id: true } });
  if (!plan) return actionFail("That plan is no longer on this job. Reload the page.");
  const where = { planId_pageNumber_kind: { planId: plan.id, pageNumber, kind: WINDOWS_SUGGESTED } };
  const read = await prisma.takeoffPlanTextRead.findUnique({ where, select: { value: true } });
  const stored = storedWindowsOf(read?.value);
  if (stored === null) return actionFail("Those windows are no longer suggested on this sheet. Reload the page.");
  if (stored.decided) return { ok: true, value: { undo: { measurements: [], items: [] } } };
  if (!kept.every((i) => Number.isInteger(i) && stored.windows[i] !== undefined)) return actionFail("Those windows did not come through. Reload the page.");
  // ponytail: decided is claimed before the counts are written, so a double submit posts once; a failure after it needs the counts redone by hand.
  await prisma.takeoffPlanTextRead.update({ where, data: { value: { ...stored, decided: true } } });
  const page = await prisma.takeoffPlanPage.upsert({
    where: { planId_pageNumber: { planId: plan.id, pageNumber } },
    create: { planId: plan.id, pageNumber },
    update: {},
    select: { id: true, calibrations: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true } } },
  });
  const itemsBefore = new Set((await prisma.takeoffItem.findMany({ where: { jobId, companyId: company.id }, select: { id: true } })).map((i) => i.id));
  const undo: WindowsUndo = { measurements: [], items: [] };
  const byTag = new Map<string, { xs: number[]; ys: number[] }>();
  for (const i of new Set(kept)) {
    const w = stored.windows[i]!;
    const at = byTag.get(w.tag) ?? { xs: [], ys: [] };
    at.xs.push((w.x1 + w.x2) / 2);
    at.ys.push((w.y1 + w.y2) / 2);
    byTag.set(w.tag, at);
  }
  for (const [tag, at] of byTag) {
    const label = windowItemName(tag);
    const itemId = await countItemFor(company.id, jobId, label);
    const made = await prisma.takeoffMeasurement.create({
      data: { itemId, pageId: page.id, calibrationId: page.calibrations[0]?.id ?? null, kind: "COUNT", xs: at.xs, ys: at.ys, label, createdByUserId: userId },
      select: { id: true },
    });
    undo.measurements.push(made.id);
    if (itemId !== null && !itemsBefore.has(itemId) && !undo.items.includes(itemId)) undo.items.push(itemId);
  }
  revalidatePath(`/jobs/${jobId}/takeoff`);
  revalidatePath(`/takeoff/${jobId}`);
  return { ok: true, value: { undo } };
}

/**
 * ── UNDO FOR A WINDOW CONFIRM ──
 *
 * The counts it wrote go, a count item it made goes when it is left with no count
 * and no live estimate line, and the sheet's windows are offered again. The undo
 * is a claim from the browser, so only counts on this job's sheet and items of
 * this job are touched.
 */
export async function undoConfirmWindows(jobId: string, planId: string, pageNumber: number, undo: WindowsUndo): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  const { company } = context;
  const plan = await prisma.takeoffPlan.findFirst({ where: { id: planId, jobId, companyId: company.id }, select: { id: true } });
  if (!plan) return actionFail("That plan is no longer on this job. Reload the page.");
  const ids = (Array.isArray(undo?.measurements) ? undo.measurements : []).filter((id): id is string => typeof id === "string");
  const items = (Array.isArray(undo?.items) ? undo.items : []).filter((id): id is string => typeof id === "string");
  const where = { planId_pageNumber_kind: { planId: plan.id, pageNumber, kind: WINDOWS_SUGGESTED } };
  await prisma.$transaction(async (tx) => {
    await tx.takeoffMeasurement.deleteMany({ where: { id: { in: ids }, kind: "COUNT", page: { planId: plan.id, pageNumber } } });
    for (const id of items) {
      const item = await tx.takeoffItem.findFirst({ where: { id, jobId, companyId: company.id, type: "COUNT" }, select: { id: true } });
      if (item === null) continue;
      const counts = await tx.takeoffMeasurement.count({ where: { itemId: id } });
      const lines = await tx.jobLineItem.count({ where: { takeoffItemId: id, isDeleted: false } });
      if (counts === 0 && lines === 0) await tx.takeoffItem.delete({ where: { id } });
    }
    const read = await tx.takeoffPlanTextRead.findUnique({ where, select: { value: true } });
    const stored = storedWindowsOf(read?.value);
    if (stored !== null && stored.decided) await tx.takeoffPlanTextRead.update({ where, data: { value: { ...stored, decided: false } } });
  });
  revalidatePath(`/jobs/${jobId}/takeoff`);
  revalidatePath(`/takeoff/${jobId}`);
  return actionOk;
}
