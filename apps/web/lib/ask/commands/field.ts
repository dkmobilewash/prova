import { prisma } from "@prova/db";
import { createDailyFieldReport } from "@/lib/actions/fieldReports";
import { recordMaterialDelivery } from "@/lib/actions/materialOrders";
import { resolveOpenMaterialOrder } from "../resolve";
import { formDataFrom, throughAction } from "./adapter";
import { findJob } from "./findJob";
import type {
  CommandContext,
  CommandDefinition,
  DirectCommandDefinition,
  CommandInput,
  Exclusion,
  PreviewLine,
  ResolvedPayload,
  Resolution,
} from "../commands";

/**
 * Field records, over Cyrus's actions. Registered here on Diego's
 * instruction in phase 2; the plan had Cyrus writing this file, and it is
 * his to rewrite. NOTHING in lib/actions/fieldReports.ts or
 * materialOrders.ts changed: each command builds the FormData the form
 * would have posted and calls the action, so its guards, its unique
 * constraint and its sentences are the ones the person would meet on the
 * page.
 *
 * "Today" on every card is `ctx.today`, the person's calendar day
 * resolved on the server from their timezone cookie. The model never
 * supplies a date: "yesterday's report" is a page job, not a prompt.
 */

const str = (payload: ResolvedPayload, key: string): string | null =>
  typeof payload[key] === "string" ? (payload[key] as string) : null;

const utcMidnight = (day: string) => new Date(`${day}T00:00:00.000Z`);

// ---------------------------------------------------------- daily report

async function resolveDailyReport(ctx: CommandContext, input: CommandInput): Promise<Resolution> {
  const workPerformed = input.workPerformed ?? "";
  if (!workPerformed && !(input.jobName || input.jobId)) {
    return { kind: "need", missing: "which job and what work was done" };
  }
  const located = await findJob(ctx, input);
  if (located.kind !== "job") return located;
  if (!workPerformed) return { kind: "need", missing: "what work was done today" };
  const { job } = located;

  // The action refuses a second report for the day with its own sentence;
  // checking first means the person gets that sentence instead of a card
  // whose button can only fail.
  const existing = await prisma.dailyFieldReport.findFirst({
    where: { jobId: job.id, reportDate: utcMidnight(ctx.today) },
    select: { id: true },
  });
  if (existing) {
    return {
      kind: "refuse",
      reason: `A daily report for ${job.name} on ${ctx.today} already exists. Edit it on the field reports page rather than filing a second one.`,
      href: "/field-reports",
    };
  }

  const preview: PreviewLine[] = [
    { label: "Job", value: job.name },
    { label: "Date", value: `${ctx.today} (today, on your calendar)` },
    { label: "Work performed", value: workPerformed },
  ];
  if (input.crewPresent) preview.push({ label: "Crew", value: input.crewPresent });
  if (input.weather) preview.push({ label: "Weather", value: input.weather });
  if (input.delays) preview.push({ label: "Delays", value: input.delays });

  return {
    kind: "ready",
    resolved: {
      jobId: job.id,
      jobName: job.name,
      reportDate: ctx.today,
      workPerformed,
      crewPresent: input.crewPresent ?? null,
      weather: input.weather ?? null,
      delays: input.delays ?? null,
    },
    preview,
    warnings: [],
  };
}

async function executeDailyReport(ctx: CommandContext, payload: ResolvedPayload) {
  const jobId = str(payload, "jobId");
  const jobName = str(payload, "jobName");
  const reportDate = str(payload, "reportDate");
  const workPerformed = str(payload, "workPerformed");
  if (!jobId || !jobName || !reportDate || !workPerformed) {
    return { ok: false as const, error: "That card can't be executed. Ask again." };
  }
  const result = await throughAction("Log report", () =>
    createDailyFieldReport(
      jobId,
      formDataFrom({
        reportDate,
        workPerformed,
        crewPresent: str(payload, "crewPresent"),
        weather: str(payload, "weather"),
        delays: str(payload, "delays"),
      }),
    ),
  );
  if (!result.ok) return { ok: false as const, error: result.error };
  const row = await prisma.dailyFieldReport.findFirst({
    where: { jobId, reportDate: utcMidnight(reportDate) },
    select: { id: true },
  });
  return {
    ok: true as const,
    message: `Logged the daily report for ${jobName}, ${reportDate}.`,
    created: {
      label: `Daily report, ${jobName}`,
      href: "/field-reports",
      targetType: "DailyFieldReport",
      targetId: row?.id ?? jobId,
    },
  };
}

export const logDailyFieldReportCommand: DirectCommandDefinition = {
  name: "log_daily_field_report",
  description:
    "Files TODAY's daily field report for a job: what work was done, who was on the crew, the weather, any delays. Needs the job's name and the work performed in the person's words; ask for either if missing. Always for today on the person's own calendar — it does NOT file a report for another day (that is done on the field reports page), and it refuses when today's report for that job already exists.",
  capability: "MANAGE_FIELD",
  tier: "T1_DRAFT",
  mode: "DIRECT",
  action: "createDailyFieldReport",
  core: "createDailyFieldReport",
  title: "Log today's daily report",
  verb: "Preparing the report",
  button: "Log report",
  input_schema: {
    type: "object",
    properties: {
      jobName: { type: "string", description: "The job's name or part of it, as the person said it. Required." },
      workPerformed: {
        type: "string",
        description: "What was done today, in the person's own words. Required.",
      },
      crewPresent: {
        type: "string",
        description: "Who or how many were on the crew, as the person said it, e.g. 'crew of 6' or 'Mike, Luis, Dan'. Omit if not said.",
      },
      weather: { type: "string", description: "The weather, as the person said it. Omit if not said." },
      delays: { type: "string", description: "Any delay or hold-up the person mentioned. Omit if none." },
    },
  },
  continuationKeys: ["jobId"],
  resolve: resolveDailyReport,
  execute: executeDailyReport,
};

// ------------------------------------------------------ material delivery

async function resolveDelivery(ctx: CommandContext, input: CommandInput): Promise<Resolution> {
  const located = await findJob(ctx, input);
  if (located.kind !== "job") return located;
  const { job } = located;

  let order: { id: string; number: number; description: string; vendorName: string };
  if (input.orderId) {
    const row = await prisma.materialOrder.findFirst({
      where: { id: input.orderId, companyId: ctx.companyId, jobId: job.id },
      select: { id: true, number: true, description: true, vendor: { select: { name: true } } },
    });
    if (!row) return { kind: "refuse", reason: "That order isn't on this job." };
    order = { id: row.id, number: row.number, description: row.description, vendorName: row.vendor.name };
  } else {
    const found = await resolveOpenMaterialOrder(ctx.companyId, job.id, input.item);
    if (found.kind === "none") {
      return {
        kind: "refuse",
        reason: input.item
          ? `No open material order on ${job.name} matches "${input.item}". Every order on that job is either fully delivered or not there.`
          : `${job.name} has no open material orders — nothing is waiting to be delivered.`,
        href: "/material-orders",
      };
    }
    if (found.kind === "many") {
      return { kind: "clarify", field: "orderId", question: "Which order arrived?", options: found.options };
    }
    order = found.match;
  }

  const completesOrder = (input.completesOrder ?? "").toLowerCase() === "yes";
  const orderLabel = `#${order.number} ${order.description}`;
  const preview: PreviewLine[] = [
    { label: "Job", value: job.name },
    { label: "Order", value: orderLabel },
    { label: "Vendor", value: order.vendorName },
    { label: "Delivered on", value: `${ctx.today} (today, on your calendar)` },
    { label: "Completes the order", value: completesOrder ? "Yes, nothing more is coming" : "No, more may still come" },
  ];
  if (input.notes) preview.push({ label: "Notes", value: input.notes });

  return {
    kind: "ready",
    resolved: {
      jobId: job.id,
      jobName: job.name,
      orderId: order.id,
      orderLabel,
      deliveredOn: ctx.today,
      completesOrder,
      notes: input.notes ?? null,
    },
    preview,
    warnings: [],
  };
}

async function executeDelivery(ctx: CommandContext, payload: ResolvedPayload) {
  const orderId = str(payload, "orderId");
  const orderLabel = str(payload, "orderLabel");
  const jobName = str(payload, "jobName");
  const deliveredOn = str(payload, "deliveredOn");
  if (!orderId || !orderLabel || !jobName || !deliveredOn) {
    return { ok: false as const, error: "That card can't be executed. Ask again." };
  }
  const result = await throughAction("Record delivery", () =>
    recordMaterialDelivery(
      orderId,
      formDataFrom({
        deliveredOn,
        completesOrder: payload.completesOrder === true,
        notes: str(payload, "notes"),
      }),
    ),
  );
  if (!result.ok) return { ok: false as const, error: result.error };
  const delivery = await prisma.materialOrderDelivery.findFirst({
    where: { orderId, deliveredOn: utcMidnight(deliveredOn) },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return {
    ok: true as const,
    message: `Recorded the delivery on ${orderLabel} for ${jobName}, ${deliveredOn}${payload.completesOrder === true ? ", and closed the order out" : ""}.`,
    created: {
      label: orderLabel,
      href: "/material-orders",
      targetType: "MaterialOrderDelivery",
      targetId: delivery?.id ?? orderId,
    },
  };
}

export const recordMaterialDeliveryCommand: DirectCommandDefinition = {
  name: "record_material_delivery",
  description:
    "Records that material arrived TODAY against an open order on a job. Needs the job's name; the order is picked from that job's open orders by what the person called the material or the vendor, and the person chooses when several match. Marks the order complete only when the person says everything arrived. Does NOT create orders, does NOT know quantities, and refuses when the job has no open order.",
  capability: "MANAGE_FIELD",
  tier: "T2_MODIFY",
  mode: "DIRECT",
  action: "recordMaterialDelivery",
  core: "recordMaterialDelivery",
  title: "Record the delivery",
  verb: "Finding the order",
  button: "Record delivery",
  input_schema: {
    type: "object",
    properties: {
      jobName: { type: "string", description: "The job's name or part of it, as the person said it. Required." },
      item: {
        type: "string",
        description: "The material or the vendor, as the person named it, e.g. 'the board' or 'ABC Supply'. Omit if they did not say.",
      },
      completesOrder: {
        type: "string",
        enum: ["yes", "no"],
        description: "'yes' only when the person said this completes the order or that everything arrived. Otherwise omit.",
      },
      notes: { type: "string", description: "Anything the person said about the delivery itself, e.g. 'two sheets damaged'. Omit if nothing." },
    },
  },
  continuationKeys: ["jobId", "orderId"],
  resolve: resolveDelivery,
  execute: executeDelivery,
};

export const fieldCommands: CommandDefinition[] = [logDailyFieldReportCommand, recordMaterialDeliveryCommand];

/** The rest of fieldReports.ts and materialOrders.ts, per action, replacing
 * the phase-1 module wildcards. */
export const fieldExclusions: Exclusion[] = [
  { action: "updateDailyFieldReport", reason: "Editing a filed report is done on the field reports page, where the report being changed is visible." },
  { action: "deleteDailyFieldReport", reason: "Deletes are never commands (T5); a daily report is what a delay claim is argued from." },
  { action: "createMaterialOrder", reason: "A counter-numbered order with a vendor, a promised date and a reference the person types; a later phase once the vendor resolver exists." },
  { action: "updateMaterialOrder", reason: "Editing an order is done on the material orders page, where the order being changed is visible." },
  { action: "deleteMaterialDelivery", reason: "Deletes are never commands (T5); this is also how a wrongly closed order is reopened, on the page." },
  { action: "deleteMaterialOrder", reason: "Deletes are never commands (T5); owner-only on the page." },
];
