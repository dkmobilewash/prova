import { prisma } from "@prova/db";
import { findJob } from "./findJob";
import { throughAction } from "./adapter";
import { STAGE_SPENDS } from "@/lib/plan-ingest/stageCost";
import { allowanceSummary } from "../allowance";
import { parseFeetInches } from "@/lib/feet-inches";
import { OFF_ESTIMATE_ITEMS } from "@/lib/takeoff/estimateHold";
import { sameCode } from "@/lib/takeoff/legendMerge";
import { loadReviewQueue } from "@/lib/takeoff/reviewQueueQuery";
import { sheetSuggestionGroups } from "@/lib/takeoff/reviewQueue";
import type {
  CommandContext,
  CommandDefinition,
  CommandInput,
  DirectCommandDefinition,
  Executed,
  HandoffCommandDefinition,
  ResolvedPayload,
  Resolution,
} from "../commands";

/**
 * Takeoff from Ask: start the whole-set wall finder, and put what was
 * measured on the estimate.
 *
 * RUN TAKEOFF IS DIRECT, and that is Diego's decision of 2026-11-04 rather
 * than an oversight of planIngest.*'s old exclusion ("the model is never the
 * thing that decides three hundred pages are worth reading"). It still is
 * not: the card shows how many floor plans will be read and what that costs
 * against the plan-sheet allowance, and only the person's tap starts it — the
 * same `startPlanIngest(plan, "WALLS")` the Find walls button calls, with its
 * owner switch, its scaled-floor-plan rule and its already-running check. The
 * run is rows the cron drains, so it finishes with the page closed; when it
 * does, the person who asked gets a TAKEOFF_RUN_DONE alert with a link
 * (lib/alerts.ts). Retrying a failed sheet stays on the page.
 *
 * POSTING TO THE ESTIMATE IS A HANDOFF. Which measurements become estimate
 * lines is decided by looking at them on the sheet (postTakeoffMeasurements'
 * exclusion), and the page refuses the same floor twice. So the card counts
 * what is not on the estimate yet and opens the takeoff tab with one sheet's
 * unposted rows ticked; the person reads them and presses Add there.
 */

async function newestPlan(jobId: string, companyId: string) {
  return prisma.takeoffPlan.findFirst({
    where: { jobId, companyId },
    orderBy: { createdAt: "desc" },
    select: { id: true, fileName: true },
  });
}

async function resolveRunTakeoff(ctx: CommandContext, input: CommandInput): Promise<Resolution> {
  const located = await findJob(ctx, input);
  if (located.kind !== "job") return located;
  const { job } = located;
  const status = await prisma.job.findFirst({ where: { id: job.id, companyId: ctx.companyId }, select: { status: true } });
  // The Find walls panel is drawn only while a job is being estimated.
  if (status?.status !== "ESTIMATE") {
    return { kind: "refuse", reason: `${job.name} is past estimating, so there is no takeoff run to start.`, href: `/jobs/${job.id}/takeoff` };
  }
  const plan = await newestPlan(job.id, ctx.companyId);
  if (!plan) return { kind: "refuse", reason: `${job.name} has no drawings uploaded yet.`, href: `/jobs/${job.id}/takeoff` };
  const company = await prisma.company.findUnique({ where: { id: ctx.companyId }, select: { wholeSetTakeoffOn: true } });
  if (!company?.wholeSetTakeoffOn) {
    return { kind: "refuse", reason: "Finding walls across the whole set is off for your company. The account owner can turn it on under Settings.", href: "/settings" };
  }
  // Imported here, not at the top: the walls module and the plan-ingest
  // action carry the whole runner graph, and commands.ts is imported by every
  // Ask test — only a takeoff card should pay for it.
  const { wallsSheetsFor, wallsTaskPages } = await import("@/lib/plan-ingest/walls");
  const pages = wallsTaskPages(await wallsSheetsFor(plan.id, ctx.companyId));
  if (pages.length === 0) {
    return {
      kind: "refuse",
      reason: "There is no floor plan with a scale that still needs its walls found. Set a scale on a floor plan first, or open a sheet to see the walls already found.",
      href: `/jobs/${job.id}/takeoff`,
    };
  }
  const running = await prisma.planIngestJob.findFirst({ where: { planId: plan.id, stage: "WALLS", finishedAt: null }, select: { id: true } });
  const left = (await allowanceSummary(ctx.companyId)).planSheetsLeft;
  const sheets = `${pages.length} floor plan${pages.length === 1 ? "" : "s"}`;
  return {
    kind: "ready",
    resolved: { jobId: job.id, jobName: job.name, planId: plan.id, sheets: pages.length },
    preview: [
      { label: "Job", value: job.name },
      { label: "Drawings", value: plan.fileName ?? "the newest set on the job" },
      { label: "Sheets", value: `${sheets} with a scale, read for walls` },
      {
        label: "Allowance",
        value: STAGE_SPENDS.WALLS
          ? `uses up to ${pages.length} of your ${left} plan sheets left this month`
          : `none — the wall finder is code, not a model call (${left} plan sheets left this month)`,
      },
      { label: "Runs", value: "in the background; an alert with a link arrives when it is done" },
    ],
    warnings: [],
    ...(running ? { existing: { label: "A wall-finding run on this set is already going", href: `/jobs/${job.id}/takeoff` } } : {}),
  };
}

async function executeRunTakeoff(_ctx: CommandContext, resolved: ResolvedPayload): Promise<Executed> {
  const jobId = String(resolved.jobId);
  // IngestView.jobId is the RUN's id (PlanIngestJob), not the construction job.
  const { startPlanIngest } = await import("@/lib/actions/planIngest");
  let runId = "";
  const result = await throughAction("start the takeoff run", async () => {
    const out = await startPlanIngest(String(resolved.planId), "WALLS");
    if (!out.ok) return out;
    runId = out.value.jobId;
    return { ok: true };
  });
  if (!result.ok) return result;
  return {
    ok: true,
    message: `Started — finding walls on ${String(resolved.sheets)} sheets of ${String(resolved.jobName)}. I'll put an alert on your bell with a link when it's done.`,
    created: { label: `Takeoff run, ${String(resolved.jobName)}`, href: `/jobs/${jobId}/takeoff`, targetType: "PlanIngestJob", targetId: runId },
    revalidate: [`/jobs/${jobId}/takeoff`],
  };
}

export const runTakeoffCommand: DirectCommandDefinition = {
  name: "run_takeoff",
  description:
    "Runs takeoff on a job's drawings: starts the wall finder over every floor plan with a scale on the job's newest drawing set, in the background, e.g. 'run takeoff on Washington Village'. The card shows how many sheets will be read and the plan-sheet allowance; the person's tap starts it, and an alert with a link arrives when it finishes. Needs the job. Does not set scales, upload drawings, read scanned sheets, retry failed sheets, keep or drop walls, or put anything on the estimate (that is post_takeoff_to_estimate).",
  capability: "VIEW_JOB_COSTS",
  tier: "T1_DRAFT",
  mode: "DIRECT",
  action: "startPlanIngest",
  core: "startPlanIngest",
  title: "Run takeoff",
  verb: "Checking the drawings",
  button: "Start the run",
  input_schema: {
    type: "object",
    properties: { jobName: { type: "string", description: "The job whose drawings to run, as the person named it." } },
  },
  continuationKeys: ["jobId"],
  resolve: resolveRunTakeoff,
  execute: executeRunTakeoff,
};

async function resolvePostTakeoff(ctx: CommandContext, input: CommandInput): Promise<Resolution> {
  const located = await findJob(ctx, input);
  if (located.kind !== "job") return located;
  const { job } = located;
  const plan = await newestPlan(job.id, ctx.companyId);
  if (!plan) return { kind: "refuse", reason: `${job.name} has no drawings uploaded yet.`, href: `/jobs/${job.id}/takeoff` };
  const unposted = await prisma.takeoffMeasurement.findMany({
    where: { postedAt: null, page: { planId: plan.id } },
    select: { id: true, page: { select: { id: true, pageNumber: true, label: true } } },
    orderBy: [{ page: { pageNumber: "asc" } }, { createdAt: "asc" }],
  });
  if (unposted.length === 0) {
    return { kind: "refuse", reason: `Everything measured on ${job.name} is already on the estimate. Run takeoff or measure a sheet first.`, href: `/jobs/${job.id}/takeoff` };
  }
  const bySheet = new Map<string, { pageNumber: number; label: string | null; ids: string[] }>();
  for (const row of unposted) {
    const entry = bySheet.get(row.page.id) ?? { pageNumber: row.page.pageNumber, label: row.page.label, ids: [] };
    entry.ids.push(row.id);
    bySheet.set(row.page.id, entry);
  }
  // A sheet the person named ("A101", "sheet 4"), or the first with work.
  const said = (input.sheet ?? "").toLowerCase().replace(/^sheet\s+/, "").trim();
  const sheets = [...bySheet.entries()];
  const named = said ? sheets.find(([, s]) => s.label?.toLowerCase() === said || String(s.pageNumber) === said) : undefined;
  if (said && !named) return { kind: "need", missing: `which sheet — none with unposted measurements is "${input.sheet}"` };
  const [pageId, sheet] = named ?? sheets[0];
  const name = `sheet ${sheet.pageNumber}${sheet.label ? ` — ${sheet.label}` : ""}`;
  return {
    kind: "ready",
    resolved: { jobId: job.id, jobName: job.name, pageId, measurementIds: sheet.ids },
    preview: [
      { label: "Job", value: job.name },
      { label: "Not on the estimate yet", value: `${unposted.length} measurement${unposted.length === 1 ? "" : "s"} on ${bySheet.size} sheet${bySheet.size === 1 ? "" : "s"}` },
      { label: "Opens", value: `${name}, with its ${sheet.ids.length} ticked — untick any before you add them` },
      { label: "Priced", value: "by the wall type you pick on the page, never on this card" },
    ],
    warnings: bySheet.size > 1 ? ["Each sheet is added on its own, so the same floor is never put on the estimate twice."] : [],
  };
}

export const postTakeoffToEstimateCommand: HandoffCommandDefinition = {
  name: "post_takeoff_to_estimate",
  description:
    "Builds or updates a job's estimate from its takeoff: counts the measurements not yet on the estimate and opens the takeoff tab on a sheet with them ticked, e.g. 'update the Washington Village estimate from the takeoff' or 'put sheet A101 on the estimate'. The person reads them and presses Add to estimate there, one sheet at a time. Needs the job; a sheet only if they named one. Does not measure, run the wall finder (that is run_takeoff), choose wall types or prices, or add anything itself.",
  capability: "VIEW_JOB_COSTS",
  tier: "T1_DRAFT",
  mode: "HANDOFF",
  action: "postTakeoffMeasurements",
  handoffHref: (proposalId, resolved) => `/jobs/${String(resolved.jobId)}/takeoff?draft=${proposalId}`,
  title: "Update the estimate from takeoff",
  verb: "Counting what is measured",
  button: "Open the takeoff",
  input_schema: {
    type: "object",
    properties: {
      jobName: { type: "string", description: "The job, as the person named it." },
      sheet: { type: "string", description: "A sheet only if the person named one, e.g. A101 or 4. Omit otherwise." },
    },
  },
  continuationKeys: ["jobId"],
  resolve: resolvePostTakeoff,
};

/**
 * "Set S6B walls to 15 feet": the queue's T, for every item of one wall type
 * on the job at once. DIRECT over `setWallGroupHeight`, the action T calls,
 * once per item (a type split by level is one item per level), so its range
 * check, its sides rule and its estimate-line sync are the same. The card
 * shows each item's height now and the linear feet it carries.
 */
export function spokenFeet(raw: string | undefined): number | null {
  const text = (raw ?? "")
    .toLowerCase()
    .replace(/\s*(feet|foot|ft)\.?/g, "'")
    .replace(/\s*(inches|inch|in)\.?/g, '"')
    .replace(/'\s*and\s*/g, "' ")
    .trim();
  const parsed = parseFeetInches(text, { label: "Height" });
  return parsed.ok && parsed.n > 0 && parsed.n < 100 ? parsed.n : null;
}

const feetWords = (n: number) => `${Math.round(n * 100) / 100} ft`;

async function resolveSetWallHeight(ctx: CommandContext, input: CommandInput): Promise<Resolution> {
  const code = (input.wallType ?? "").trim().toUpperCase();
  if (!code) return { kind: "need", missing: "which wall type, e.g. S6B" };
  const heightFt = spokenFeet(input.height);
  if (input.height && heightFt === null) return { kind: "need", missing: `the height in feet — "${input.height}" isn't one between 0 and 100` };
  if (heightFt === null) return { kind: "need", missing: "the height in feet" };
  const located = await findJob(ctx, input);
  if (located.kind !== "job") return located;
  const { job } = located;
  const status = await prisma.job.findFirst({ where: { id: job.id, companyId: ctx.companyId }, select: { status: true } });
  if (status?.status !== "ESTIMATE") {
    return { kind: "refuse", reason: `${job.name} is past estimating; a height there changes by change order.`, href: `/jobs/${job.id}` };
  }
  const items = await prisma.takeoffItem.findMany({
    where: { jobId: job.id, job: { companyId: ctx.companyId }, wallTypeId: { not: null }, name: { notIn: [...OFF_ESTIMATE_ITEMS] } },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true, heightFt: true, wallType: { select: { code: true } }, _count: { select: { measurements: true } } },
  });
  const ofType = items.filter((item) => item.wallType !== null && sameCode(item.wallType.code, code));
  if (ofType.length === 0) {
    const typed = [...new Set(items.map((item) => item.wallType?.code).filter(Boolean))];
    return {
      kind: "refuse",
      reason: `No walls on ${job.name}'s takeoff are typed ${code}.${typed.length ? ` Typed so far: ${typed.join(", ")}.` : ""} Type them in the review queue first.`,
      href: `/takeoff/${job.id}?open=review`,
    };
  }
  return {
    kind: "ready",
    resolved: { jobId: job.id, jobName: job.name, code, heightFt, itemIds: ofType.map((item) => item.id) },
    preview: [
      { label: "Job", value: job.name },
      { label: "Wall type", value: code },
      ...ofType.map((item) => ({
        label: item.name,
        value: `${item.heightFt === null ? "no height" : feetWords(Number(item.heightFt))} → ${feetWords(heightFt)} (${item._count.measurements} wall${item._count.measurements === 1 ? "" : "s"})`,
      })),
      { label: "Estimate", value: "its lines are updated at the new height" },
    ],
    warnings: heightFt > 30 ? [`${feetWords(heightFt)} is tall for a wall. Check it against the sections.`] : [],
  };
}

async function executeSetWallHeight(_ctx: CommandContext, resolved: ResolvedPayload): Promise<Executed> {
  const jobId = String(resolved.jobId);
  const heightFt = Number(resolved.heightFt);
  const ids = Array.isArray(resolved.itemIds) ? resolved.itemIds.map(String) : [];
  const { setWallGroupHeight } = await import("@/lib/actions/takeoffItems");
  for (const id of ids) {
    const result = await throughAction("set the height", () => setWallGroupHeight(jobId, id, heightFt));
    if (!result.ok) return result;
  }
  return {
    ok: true,
    message: `${String(resolved.code)} walls on ${String(resolved.jobName)} are ${feetWords(heightFt)} now, and the estimate follows.`,
    created: { label: `${String(resolved.code)} walls, ${String(resolved.jobName)}`, href: `/takeoff/${jobId}`, targetType: "TakeoffItem", targetId: ids[0] ?? "" },
    revalidate: [`/jobs/${jobId}/takeoff`, `/takeoff/${jobId}`],
  };
}

export const setWallHeightCommand: DirectCommandDefinition = {
  name: "set_wall_height",
  description:
    "Sets the height of every wall of one wall type on a job's takeoff, e.g. 'set S6B walls to 15 feet' or 'make the W2 walls on Baker 12 feet'. The same as pressing T in the review queue for each group of that type; the estimate lines follow. Needs the wall type code, the height as the person said it, and the job. Does not type walls, change a type's library default, set one wall, or measure.",
  capability: "VIEW_JOB_COSTS",
  tier: "T2_MODIFY",
  mode: "DIRECT",
  action: "setWallGroupHeight",
  core: "setWallGroupHeight",
  title: "Set wall height",
  verb: "Finding the walls",
  button: "Set the height",
  input_schema: {
    type: "object",
    properties: {
      jobName: { type: "string", description: "The job, as the person named it." },
      wallType: { type: "string", description: "The wall type code, e.g. S6B or W1." },
      height: { type: "string", description: "The height as the person said it, e.g. 15 feet, 15' 6\", 12." },
    },
  },
  continuationKeys: ["jobId"],
  resolve: resolveSetWallHeight,
  execute: executeSetWallHeight,
};

/**
 * "Accept all suggestions on A101": the queue's Accept all on this sheet, from
 * Ask. DIRECT over `confirmSheetSuggestions` (#1020) with the groups
 * `sheetSuggestionGroups` builds — the same function the queue's button calls,
 * so both take every group whose type the drawing gave, at the height Enter
 * would pre-fill. The card lists each group (type, height, feet) before
 * anything is written; library guesses by thickness stay in the queue.
 *
 * NO UNDO FROM HERE, and the card says so: the queue's Undo holds the
 * before-snapshot in the page that pressed it. A group typed wrong is retyped
 * in the queue.
 */
async function resolveAcceptSheet(ctx: CommandContext, input: CommandInput): Promise<Resolution> {
  const said = (input.sheet ?? "").replace(/^sheet\s+/i, "").trim();
  if (!said) return { kind: "need", missing: "which sheet, e.g. A101" };
  const located = await findJob(ctx, input);
  if (located.kind !== "job") return located;
  const { job } = located;
  const queue = await loadReviewQueue(ctx.companyId, job.id);
  const types = queue.items.filter((item) => item.kind === "type");
  const onSheet = types.filter((item) => item.sheet.toLowerCase() === said.toLowerCase() || String(item.pageNumber) === said);
  if (queue.planId === null || onSheet.length === 0) {
    return { kind: "refuse", reason: `Nothing on sheet ${said} of ${job.name} is waiting for a type.`, href: `/takeoff/${job.id}?open=review` };
  }
  const pageNumber = onSheet[0].pageNumber;
  const groups = sheetSuggestionGroups(queue.items, pageNumber, queue.heights, queue.planId);
  const sheet = onSheet[0].sheet;
  if (groups.length === 0) {
    return {
      kind: "refuse",
      reason: `None of the ${onSheet.length} groups on ${sheet} has a type the drawing gives (a printed tag or the legend), so there is nothing to accept all at once. Pick each one in the review queue.`,
      href: `/takeoff/${job.id}?open=review`,
    };
  }
  const feet = groups.reduce((n, g) => n + (g.feet ?? 0), 0);
  const left = onSheet.length - groups.length;
  return {
    kind: "ready",
    resolved: { jobId: job.id, jobName: job.name, sheet, groups: groups.map((g) => g.group) },
    preview: [
      { label: "Job", value: job.name },
      { label: "Sheet", value: `${sheet}: ${groups.length} group${groups.length === 1 ? "" : "s"}, ${Math.round(feet).toLocaleString()} ft` },
      ...groups.map((g, i) => ({
        label: `Group ${i + 1}`,
        value: `${g.group.code}${g.group.heightFt === null ? ", no height yet" : ` at ${Math.round(g.group.heightFt * 100) / 100} ft`}${g.feet === null ? "" : ` · ${Math.round(g.feet)} ft`}`,
      })),
      ...(left > 0 ? [{ label: "Left in the queue", value: `${left} group${left === 1 ? "" : "s"} the drawing does not name` }] : []),
    ],
    warnings: ["These are the drawing's suggestions. There is no Undo from here; a group typed wrong is retyped in the review queue."],
  };
}

async function executeAcceptSheet(_ctx: CommandContext, resolved: ResolvedPayload): Promise<Executed> {
  const jobId = String(resolved.jobId);
  const { confirmSheetSuggestions } = await import("@/lib/actions/wallGroupType");
  let summary = "";
  const result = await throughAction("accept the suggestions", async () => {
    const out = await confirmSheetSuggestions(jobId, resolved.groups as Parameters<typeof confirmSheetSuggestions>[1]);
    if (!out.ok) return out;
    const { accepted, failed } = out.value;
    summary = `Accepted ${accepted} group${accepted === 1 ? "" : "s"} on ${String(resolved.sheet)}${failed.length > 0 ? `; not accepted: ${failed.join("; ")}` : ""}.`;
    return { ok: true };
  });
  if (!result.ok) return result;
  return {
    ok: true,
    message: `${summary} Their estimate lines are written.`,
    created: { label: `Sheet ${String(resolved.sheet)}, ${String(resolved.jobName)}`, href: `/takeoff/${jobId}?open=review`, targetType: "Job", targetId: jobId },
    revalidate: [`/jobs/${jobId}/takeoff`, `/takeoff/${jobId}`],
  };
}

export const acceptSheetSuggestionsCommand: DirectCommandDefinition = {
  name: "accept_sheet_suggestions",
  description:
    "Accepts every wall-type suggestion the drawing gives on one sheet of a job's takeoff (a printed tag or the legend), each at the height the review queue would pre-fill, e.g. 'accept all suggestions on A101' or 'take the suggested types on sheet A101 for Baker'. The same as the review queue's Accept all suggestions on this sheet; estimate lines follow. Needs the sheet and the job. Does not accept guesses by thickness, set heights by themselves (that is set_wall_height), keep or drop walls, or price anything.",
  capability: "VIEW_JOB_COSTS",
  tier: "T2_MODIFY",
  mode: "DIRECT",
  action: "confirmSheetSuggestions",
  core: "confirmSheetSuggestions",
  title: "Accept the sheet's suggestions",
  verb: "Reading the review queue",
  button: "Accept them",
  input_schema: {
    type: "object",
    properties: {
      jobName: { type: "string", description: "The job, as the person named it." },
      sheet: { type: "string", description: "The sheet, e.g. A101." },
    },
  },
  continuationKeys: ["jobId"],
  resolve: resolveAcceptSheet,
  execute: executeAcceptSheet,
};

export const takeoffCommands: CommandDefinition[] = [runTakeoffCommand, postTakeoffToEstimateCommand, setWallHeightCommand, acceptSheetSuggestionsCommand];
