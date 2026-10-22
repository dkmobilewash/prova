"use server";

import { prisma } from "@prova/db";
import { WALL_LEGEND_SIGHT_PROMPT_VERSION, type WallLegendRead } from "@prova/integrations";
import { revalidatePath } from "next/cache";
import { aiGate } from "@/lib/ai/settings";
import { claimPlanSheet, markPlanSheetFailure } from "@/lib/ask/planSheetSpend";
import { recordAskUsage } from "@/lib/ask/usage";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { openPlanPdf } from "@/lib/plan-ingest/planPdf";
import { readPlanBytes } from "@/lib/plan-ingest/planBytes";
import { sameCode } from "@/lib/takeoff/legendMerge";
import { storedLegendTypes, storedLegendTypesFromJson } from "@/lib/takeoff/legendProposal";
import { assemblyFromSight } from "@/lib/takeoff/legendSight";
import { pageLines } from "@/lib/takeoff/planTextRead";
import { legendHeightOf, legendHeightsFor, type LegendHeightResult } from "@/lib/takeoff/legendHeights";
import { sightFieldsFor } from "@/lib/takeoff/legendProposal";
import { readWallLegendBySight } from "@/lib/takeoff/readWallLegend";
import { actionFail, isUniqueConstraintError, type ActionResultWith } from "./shared";

/**
 * ── "ADD THESE WALL TYPES TO YOUR LIBRARY" ──
 *
 * Two actions behind the review screen for a set's wall legend.
 *
 * `addWallTypeFromLegend` turns ONE reviewed type into a `WallType` and its
 * quantity components. The parts are rebuilt from the FIELDS the person was
 * shown and may have edited (`assemblyFromSight`), not copied from the stored
 * proposal, so an edit to the stud spacing changes the stud count rule. It
 * writes no price, no catalog entry and no cost category: a wall type is the
 * one place a cost is knowable up front and this is deliberately not where it
 * is decided — Wall types is, by the person, afterwards.
 *
 * `readLegendBySight` is the second read: the browser renders the legend page
 * and one crop per type (the server has no rasteriser), this sends them with
 * the page's words to the model, and the merged reading replaces the words-
 * only one, the drawing winning a disagreement and every disagreement
 * flagged. Metered as one plan sheet, behind the PLAN_TEXT_READ opt-in.
 */

const NO_ESTIMATING = "Adding wall types to the library is part of estimating, which isn't part of your job function.";
const JOB_COSTS_ONLY =
  "A job's costs and pricing aren't part of your job function. The account owner sets who sees what, on the Team page.";
const NO_PROPOSAL = "That legend read is no longer on this job. Reload the page.";

export type LegendTypeEdits = {
  code: string;
  name: string;
  studWidthIn: number | null;
  studSpacingIn: number | null;
  boardThicknessIn: number | null;
  layersPerSide: number | null;
  insulation: string | null;
  hourlyRating: number | null;
  /** The overall thickness the library keys on; defaults from the fields, editable. */
  thicknessIn: number | null;
};

const CODE_MAX = 24;
const NAME_MAX = 80;
const INSULATION_MAX = 80;
const NOTES_MAX = 2000;

function numberIn(value: unknown, label: string, min: number, max: number): number | null | string {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return `${label} isn't a number.`;
  if (n < min || n > max) return `${label} must be between ${min} and ${max}.`;
  return n;
}

export async function addWallTypeFromLegend(
  jobId: string,
  proposalId: string,
  edits: LegendTypeEdits,
): Promise<ActionResultWith<{ code: string; componentCount: number; height: LegendHeightResult }>> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return actionFail(NO_ESTIMATING) as ActionResultWith<never>;
  const companyId = context.company.id;

  const proposal = await prisma.planLegendProposal.findFirst({
    where: { id: proposalId, plan: { job: { id: jobId, companyId } } },
    select: { id: true, planId: true, pageNumber: true, sheetTitle: true, merged: true, sightRead: true, status: true },
  });
  if (proposal === null) return actionFail(NO_PROPOSAL) as ActionResultWith<never>;

  // ── THE FIELDS ARE CLAIMS; CHECK EVERY ONE ──
  const code = String(edits.code ?? "").trim().toUpperCase();
  if (code === "" || code.length > CODE_MAX) return actionFail(`The code has to be 1 to ${CODE_MAX} characters.`) as ActionResultWith<never>;
  const original = storedLegendTypesFromJson(proposal.merged).find((t) => sameCode(t.code, edits.code)) ?? null;
  if (original === null) return actionFail(`${code} isn't one of the types this legend read defines.`) as ActionResultWith<never>;
  const name = String(edits.name ?? "").trim().slice(0, NAME_MAX) || original.name || `Wall type ${code}`;
  const checked = {
    studWidthIn: numberIn(edits.studWidthIn, "Stud width", 0.5, 24),
    studSpacingIn: numberIn(edits.studSpacingIn, "Stud spacing", 4, 48),
    boardThicknessIn: numberIn(edits.boardThicknessIn, "Board thickness", 0.25, 2),
    layersPerSide: numberIn(edits.layersPerSide, "Layers per side", 0, 4),
    hourlyRating: numberIn(edits.hourlyRating, "Fire rating", 0, 4),
    thicknessIn: numberIn(edits.thicknessIn, "Wall thickness", 0.5, 48),
  };
  for (const value of Object.values(checked)) {
    if (typeof value === "string") return actionFail(value) as ActionResultWith<never>;
  }
  const fields = checked as { [K in keyof typeof checked]: number | null };
  const insulation = edits.insulation === null ? null : String(edits.insulation).trim().slice(0, INSULATION_MAX) || null;

  // The parts, from what the person agreed to rather than from the stored read —
  // and the material from the SIGHT read, which the merged view drops.
  const sight = sightFieldsFor(proposal.sightRead, code);
  const where = proposal.sheetTitle ? `${proposal.sheetTitle} (page ${proposal.pageNumber})` : `page ${proposal.pageNumber}`;
  const assembly = assemblyFromSight(
    {
      code,
      name,
      studWidthIn: fields.studWidthIn,
      // THE MATERIAL COMES FROM THE SIGHT READ, not from a null that reads as
      // metal: C8A and C8B on Baker are insulated concrete forms, and this
      // used to write "8in metal stud + track" on them. `assemblyFromSight`
      // gives a concrete or masonry wall board and insulation only, and says
      // so in a flag.
      studMaterial: sight.studMaterial,
      studGauge: original.assembly.read.studGauge,
      studSpacingIn: fields.studSpacingIn,
      boardThicknessIn: fields.boardThicknessIn,
      layersSideA: fields.layersPerSide,
      layersSideB: fields.layersPerSide,
      boardIsTypeX: original.assembly.read.boardIsTypeX,
      insulation,
      hourlyRating: fields.hourlyRating,
      heightNote: null,
      notes: [],
      fromDrawing: [],
      fromSheetNote: [],
      optional: [],
      notAPartition: null,
      confidence: "HIGH",
    },
    where,
  );
  const thicknessIn =
    fields.thicknessIn ??
    (fields.studWidthIn === null ? null : fields.studWidthIn + 2 * (fields.layersPerSide ?? 1) * (fields.boardThicknessIn ?? 0));

  // ── THE HEIGHT, FROM THE SET — the chain and its confidence go in the notes ──
  //
  // A legend says where a wall STOPS; the feet are on a section forty pages
  // away. `setHeightFacts` walks the set for them and `resolveHeight` names
  // the one it used. Nothing is guessed: a type whose words resolve to no
  // printed figure gets NO default height and a note saying why, and a
  // height that rests on a sheet-wide note alone is written LOW so the
  // estimator checks it before a run is priced at it. A set that cannot be
  // read leaves the height blank rather than failing the add.
  const height =
    (await legendHeightsFor({ planId: proposal.planId, companyId, legendPage: proposal.pageNumber, types: [{ code, lines: original.lines, heightNote: sight.heightNote }] })).get(code.toUpperCase()) ??
    legendHeightOf({ code, lines: original.lines, heightNote: sight.heightNote }, null, "no reading");
  const notes = [
    `Read off ${where} of the plan set. Check against the drawing before pricing.`,
    height.sentence,
    ...original.lines,
  ]
    .join("\n")
    .slice(0, NOTES_MAX);
  const sortFrom = await prisma.wallType.count({ where: { companyId } });
  try {
    await prisma.$transaction(async (tx) => {
      await tx.wallType.create({
        data: {
          companyId,
          code,
          name,
          thicknessIn: thicknessIn === null ? null : thicknessIn.toFixed(2),
          defaultHeightFt: height.heightFt === null ? null : height.heightFt.toFixed(2),
          sides: 2,
          studSpacingIn: (fields.studSpacingIn ?? 16).toFixed(2),
          sortOrder: sortFrom,
          notes,
          components: {
            create: assembly.components.map((c, index) => ({
              description: c.description,
              unit: c.unit,
              basis: c.basis,
              factor: c.factor.toFixed(4),
              wastePercent: c.wastePercent.toFixed(2),
              roundUp: c.roundUp,
              sortOrder: index,
            })),
          },
        },
      });
      if (proposal.status === "PROPOSED") {
        await tx.planLegendProposal.update({
          where: { id: proposal.id },
          data: { status: "ACCEPTED", acceptedByUserId: context.id, acceptedAt: new Date() },
        });
      }
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return actionFail(`${code} is already in your library, so it was left alone — a tag means different things on different jobs.`) as ActionResultWith<never>;
    }
    throw err;
  }
  revalidatePath("/wall-types");
  revalidatePath(`/jobs/${jobId}/takeoff/legend`);
  revalidatePath(`/jobs/${jobId}/takeoff`);
  return { ok: true, value: { code, componentCount: assembly.components.length, height } };
}


const PAGE_IMAGE_MAX = 3_500_000;
const CROP_IMAGE_MAX = 1_500_000;
const CROPS_MAX = 40;

export async function readLegendBySight(
  jobId: string,
  proposalId: string,
  page: { imageBase64: string; mediaType: "image/png" | "image/jpeg" },
  crops: { code: string; imageBase64: string; mediaType: "image/png" | "image/jpeg" }[],
): Promise<ActionResultWith<{ typeCount: number }>> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY) as ActionResultWith<never>;
  const companyId = context.company.id;
  if (page.imageBase64.length > PAGE_IMAGE_MAX || crops.length > CROPS_MAX || crops.some((c) => c.imageBase64.length > CROP_IMAGE_MAX)) {
    return actionFail("Those images are too large to send. Reload the page and try again.") as ActionResultWith<never>;
  }
  const proposal = await prisma.planLegendProposal.findFirst({
    where: { id: proposalId, plan: { job: { id: jobId, companyId } } },
    select: { id: true, planId: true, pageNumber: true, sheetTitle: true, textRead: true },
  });
  if (proposal === null) return actionFail(NO_PROPOSAL) as ActionResultWith<never>;

  // The page's words, for the model to read beside the pictures.
  const bytes = await readPlanBytes(proposal.planId, companyId);
  if (!bytes.ok) return actionFail(bytes.error) as ActionResultWith<never>;
  const pdf = await openPlanPdf(bytes.bytes);
  let lines: string[];
  try {
    lines = await pageLines(pdf, proposal.pageNumber);
  } finally {
    await pdf.close();
  }

  const gate = await aiGate(companyId, "PLAN_TEXT_READ");
  if (!gate.ok) return actionFail(gate.error) as ActionResultWith<never>;
  const claimed = await claimPlanSheet(companyId, gate.settings.planSheetsPerMonth);
  if (!claimed.ok) return actionFail(claimed.error) as ActionResultWith<never>;
  const text = proposal.textRead as unknown as WallLegendRead;
  const where = proposal.sheetTitle ? `${proposal.sheetTitle} (page ${proposal.pageNumber})` : `page ${proposal.pageNumber}`;
  const read = await readWallLegendBySight({
    companyId,
    text,
    page,
    crops,
    lines,
    pageNumber: proposal.pageNumber,
    sheetTitle: proposal.sheetTitle,
    where,
    onUsage: (usage) =>
      recordAskUsage({
        companyId,
        userId: context.id,
        feature: "plan-text-read",
        model: gate.model,
        outcome: "proposal",
        jobId,
        promptVersion: WALL_LEGEND_SIGHT_PROMPT_VERSION,
        usage,
      }),
  });
  if (!read.ok) {
    await markPlanSheetFailure(claimed.claim);
    return actionFail(read.error) as ActionResultWith<never>;
  }
  const merged = storedLegendTypes(text, read.sight, where);
  await prisma.planLegendProposal.update({
    where: { id: proposal.id },
    data: {
      sightRead: JSON.parse(JSON.stringify(read.sight)),
      merged: JSON.parse(JSON.stringify(merged)),
      promptVersion: WALL_LEGEND_SIGHT_PROMPT_VERSION,
      reason: read.reason,
      confidence: read.confidence,
    },
  });
  revalidatePath(`/jobs/${jobId}/takeoff/legend`);
  return { ok: true, value: { typeCount: merged.length } };
}
