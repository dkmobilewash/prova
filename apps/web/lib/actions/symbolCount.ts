"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { actionFail, actionOk, ownerRefusal, type ActionResult, type ActionResultWith } from "./shared";
import { applyPrintedScales } from "./takeoff";

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
 * the kept points per sheet here in page-width units. A COUNT measurement
 * needs a page row and a calibration to point at, and a sheet nobody has
 * opened has neither — so the sheets that lack one get the scale they PRINT,
 * through `applyPrintedScales`, exactly as the whole-set takeoff does; a
 * sheet that prints none is counted on screen and reported as not saved,
 * never given a scale this code made up. Every measurement carries the
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
  skipped: { pageNumber: number; count: number; why: string }[];
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

  // Sheets without a calibration get the scale they print, where they print one.
  const have = new Set(
    (await prisma.takeoffPlanPage.findMany({ where: { planId: plan.id, pageNumber: { in: sheets.map((s) => s.pageNumber) }, calibrations: { some: {} } }, select: { pageNumber: true } })).map((p) => p.pageNumber),
  );
  const missing = sheets.map((s) => s.pageNumber).filter((n) => !have.has(n));
  const skippedWhy = new Map<number, string>();
  if (missing.length > 0) {
    const applied = await applyPrintedScales(jobId, plan.id, missing);
    if (!applied.ok) return actionFail(applied.error);
    for (const s of applied.value.skipped) skippedWhy.set(s.pageNumber, s.why);
  }

  const pages = await prisma.takeoffPlanPage.findMany({
    where: { planId: plan.id, pageNumber: { in: sheets.map((s) => s.pageNumber) } },
    include: { calibrations: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  const saved: AcrossSheetsResult["saved"] = [];
  const skipped: AcrossSheetsResult["skipped"] = [];
  for (const s of sheets) {
    const page = pages.find((p) => p.pageNumber === s.pageNumber);
    const calibration = page?.calibrations[0];
    if (!page || !calibration) {
      skipped.push({ pageNumber: s.pageNumber, count: s.xs.length, why: skippedWhy.get(s.pageNumber) ?? "this sheet has no scale — set one on it and count again" });
      continue;
    }
    const created = await prisma.takeoffMeasurement.create({
      select: { id: true },
      data: { itemId: itemId === "" ? null : itemId, pageId: page.id, calibrationId: calibration.id, kind: "COUNT", xs: s.xs, ys: s.ys, label, createdByUserId: userId },
    });
    saved.push({ pageNumber: s.pageNumber, count: s.xs.length, measurementId: created.id });
  }
  revalidatePath(`/jobs/${jobId}/takeoff`);
  revalidatePath(`/takeoff/${jobId}`);
  return { ok: true, value: { saved, skipped, total: saved.reduce((t, s) => t + s.count, 0) } };
}
