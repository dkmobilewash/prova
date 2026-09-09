import { prisma } from "@prova/db";
import { assignEquipment, returnEquipment } from "@/lib/actions/equipmentAssignments";
import { resolveEquipment, resolveJob, type ResolvedEquipment } from "../resolve";
import { formDataFrom, throughAction } from "./adapter";
import type {
  CommandContext,
  CommandDefinition,
  CommandInput,
  Exclusion,
  ResolvedPayload,
  Resolution,
} from "../commands";

/**
 * Equipment out and back, over Cyrus's actions — see field.ts for the
 * arrangement. `assignEquipment` keeps its overlap check inside its own
 * transaction; the pre-check here only spares the person a card whose
 * button could only fail, and the sentence it uses is the action's own
 * shape. Equipment has a booking, not a position: "send" and "back" are
 * dispatch records, and the card says so.
 */

const str = (payload: ResolvedPayload, key: string): string | null =>
  typeof payload[key] === "string" ? (payload[key] as string) : null;

const label = (piece: { name: string; assetTag: string | null }) =>
  piece.assetTag ? `${piece.name} (${piece.assetTag})` : piece.name;

async function findEquipment(
  ctx: CommandContext,
  input: CommandInput,
  field: string,
): Promise<{ kind: "piece"; piece: ResolvedEquipment } | Resolution> {
  if (input.equipmentId) {
    const found = await prisma.equipment.findFirst({
      where: { id: input.equipmentId, companyId: ctx.companyId },
      select: {
        id: true,
        name: true,
        assetTag: true,
        type: true,
        assignments: {
          where: { returnedOn: null },
          orderBy: { sentOutOn: "desc" },
          take: 1,
          select: { id: true, jobId: true, sentOutOn: true, job: { select: { name: true } } },
        },
      },
    });
    if (!found) return { kind: "refuse", reason: "That equipment isn't on your account." };
    const stay = found.assignments[0];
    return {
      kind: "piece",
      piece: {
        id: found.id,
        name: found.name,
        assetTag: found.assetTag,
        type: found.type,
        openStay: stay
          ? { id: stay.id, jobId: stay.jobId, jobName: stay.job.name, sentOutOn: stay.sentOutOn.toISOString().slice(0, 10) }
          : null,
      },
    };
  }
  const text = input[field] ?? "";
  if (!text) return { kind: "need", missing: "which piece of equipment" };
  const found = await resolveEquipment(ctx.companyId, text);
  if (found.kind === "none") {
    return {
      kind: "refuse",
      reason: `No equipment matches "${text}". Add it on the equipment page first.`,
      href: "/equipment",
    };
  }
  if (found.kind === "many") {
    return { kind: "clarify", field: "equipmentId", question: `Which ${text}?`, options: found.options };
  }
  return { kind: "piece", piece: found.match };
}

// ------------------------------------------------------------- send out

async function resolveSend(ctx: CommandContext, input: CommandInput): Promise<Resolution> {
  const located = await findEquipment(ctx, input, "equipment");
  if (located.kind !== "piece") return located;
  const { piece } = located;

  if (piece.openStay) {
    return {
      kind: "refuse",
      reason: `${label(piece)} is already out on ${piece.openStay.jobName} from ${piece.openStay.sentOutOn} and hasn't been brought back. Record its return first.`,
      href: "/equipment",
    };
  }

  let job: { id: string; name: string };
  if (input.jobId) {
    const row = await prisma.job.findFirst({
      where: { id: input.jobId, companyId: ctx.companyId },
      select: { id: true, name: true },
    });
    if (!row) return { kind: "refuse", reason: "That job isn't on your account." };
    job = row;
  } else {
    const jobName = input.jobName ?? "";
    if (!jobName) return { kind: "need", missing: "which job it is going to" };
    const found = await resolveJob(ctx.companyId, jobName);
    if (found.kind === "none") {
      return { kind: "refuse", reason: `No job matches "${jobName}".`, href: "/dashboard" };
    }
    if (found.kind === "many") {
      return { kind: "clarify", field: "jobId", question: "Which job?", options: found.options };
    }
    job = { id: found.match.id, name: found.match.name };
  }

  const preview = [
    { label: "Equipment", value: label(piece) },
    { label: "To", value: job.name },
    { label: "Sent out on", value: `${ctx.today} (today, on your calendar)` },
  ];
  if (input.notes) preview.push({ label: "Notes", value: input.notes });

  return {
    kind: "ready",
    resolved: {
      equipmentId: piece.id,
      equipmentLabel: label(piece),
      jobId: job.id,
      jobName: job.name,
      sentOutOn: ctx.today,
      notes: input.notes ?? null,
    },
    preview,
    warnings: [],
  };
}

async function executeSend(ctx: CommandContext, payload: ResolvedPayload) {
  const equipmentId = str(payload, "equipmentId");
  const equipmentLabel = str(payload, "equipmentLabel");
  const jobId = str(payload, "jobId");
  const jobName = str(payload, "jobName");
  const sentOutOn = str(payload, "sentOutOn");
  if (!equipmentId || !equipmentLabel || !jobId || !jobName || !sentOutOn) {
    return { ok: false as const, error: "That card can't be executed. Ask again." };
  }
  const result = await throughAction("Send out", () =>
    assignEquipment(formDataFrom({ equipmentId, jobId, sentOutOn, notes: str(payload, "notes") })),
  );
  if (!result.ok) return { ok: false as const, error: result.error };
  const stay = await prisma.equipmentAssignment.findFirst({
    where: { equipmentId, jobId, returnedOn: null },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return {
    ok: true as const,
    message: `Recorded ${equipmentLabel} as sent to ${jobName} on ${sentOutOn}.`,
    created: {
      label: `${equipmentLabel} on ${jobName}`,
      href: "/equipment",
      targetType: "EquipmentAssignment",
      targetId: stay?.id ?? equipmentId,
    },
  };
}

export const sendEquipmentToJobCommand: CommandDefinition = {
  name: "send_equipment_to_job",
  description:
    "Records a piece of equipment as sent out to a job TODAY. Needs which piece (name, type or asset tag, as the person said it) and which job; ask for either if missing. This is a dispatch record, not a location — there is no GPS. Refuses when the piece is already out on a job and not yet brought back. Does NOT move a piece between jobs in one step: bring it back first.",
  capability: "MANAGE_FIELD",
  tier: "T2_MODIFY",
  mode: "DIRECT",
  action: "assignEquipment",
  core: "assignEquipment",
  title: "Send it out",
  verb: "Finding the equipment",
  button: "Send out",
  input_schema: {
    type: "object",
    properties: {
      equipment: {
        type: "string",
        description: "The piece as the person named it: a name, a type like 'scissor lift', or an asset tag. Required.",
      },
      jobName: { type: "string", description: "The job it is going to, or part of its name. Required." },
      notes: { type: "string", description: "Anything the person said about the move itself. Omit if nothing." },
    },
  },
  continuationKeys: ["equipmentId", "jobId"],
  resolve: resolveSend,
  execute: executeSend,
};

// ------------------------------------------------------------ bring back

async function resolveReturn(ctx: CommandContext, input: CommandInput): Promise<Resolution> {
  const located = await findEquipment(ctx, input, "equipment");
  if (located.kind !== "piece") return located;
  const { piece } = located;

  if (!piece.openStay) {
    return {
      kind: "refuse",
      reason: `${label(piece)} isn't out on any job — it is already in the yard as far as the records go.`,
      href: "/equipment",
    };
  }

  return {
    kind: "ready",
    resolved: {
      assignmentId: piece.openStay.id,
      equipmentLabel: label(piece),
      jobName: piece.openStay.jobName,
      returnedOn: ctx.today,
    },
    preview: [
      { label: "Equipment", value: label(piece) },
      { label: "Back from", value: `${piece.openStay.jobName}, out since ${piece.openStay.sentOutOn}` },
      { label: "Returned on", value: `${ctx.today} (today, on your calendar)` },
    ],
    warnings: [],
  };
}

async function executeReturn(ctx: CommandContext, payload: ResolvedPayload) {
  const assignmentId = str(payload, "assignmentId");
  const equipmentLabel = str(payload, "equipmentLabel");
  const jobName = str(payload, "jobName");
  const returnedOn = str(payload, "returnedOn");
  if (!assignmentId || !equipmentLabel || !jobName || !returnedOn) {
    return { ok: false as const, error: "That card can't be executed. Ask again." };
  }
  const result = await throughAction("Bring back", () =>
    returnEquipment(assignmentId, formDataFrom({ returnedOn })),
  );
  if (!result.ok) return { ok: false as const, error: result.error };
  return {
    ok: true as const,
    message: `Recorded ${equipmentLabel} as back from ${jobName} on ${returnedOn}.`,
    created: {
      label: `${equipmentLabel} back in the yard`,
      href: "/equipment",
      targetType: "EquipmentAssignment",
      targetId: assignmentId,
    },
  };
}

export const bringEquipmentBackCommand: CommandDefinition = {
  name: "bring_equipment_back",
  description:
    "Records a piece of equipment as brought back to the yard TODAY from the job it is out on. Needs which piece (name, type or asset tag); ask if missing. Refuses when the piece is not out on any job. This closes the current dispatch record; it does NOT say where the machine physically is.",
  capability: "MANAGE_FIELD",
  tier: "T2_MODIFY",
  mode: "DIRECT",
  action: "returnEquipment",
  core: "returnEquipment",
  title: "Bring it back",
  verb: "Finding the equipment",
  button: "Bring back",
  input_schema: {
    type: "object",
    properties: {
      equipment: {
        type: "string",
        description: "The piece as the person named it: a name, a type like 'scissor lift', or an asset tag. Required.",
      },
    },
  },
  continuationKeys: ["equipmentId"],
  resolve: resolveReturn,
  execute: executeReturn,
};

export const equipmentCommands: CommandDefinition[] = [sendEquipmentToJobCommand, bringEquipmentBackCommand];

export const equipmentExclusions: Exclusion[] = [
  { action: "updateEquipmentAssignment", reason: "Correcting a stay's dates is done on the equipment page, where the stay being changed is visible; the overlap rule runs there too." },
  { action: "deleteEquipmentAssignment", reason: "Deletes are never commands (T5); owner-only on the page." },
];
