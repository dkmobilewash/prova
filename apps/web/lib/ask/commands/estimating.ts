import { prisma } from "@prova/db";
import { money } from "@/lib/money";
import { addCatalogLine } from "@/lib/estimating/catalog-line";
import { createEstimateJob } from "@/lib/estimating/create-job";
import { draftLinesFromScope } from "@/lib/estimating/draft-lines";
import { resolveCatalogEntry, resolveContact, resolveJob } from "../resolve";
import type {
  CommandContext,
  CommandDefinition,
  CommandInput,
  Exclusion,
  PreviewLine,
  ResolvedPayload,
  Resolution,
} from "../commands";

/**
 * Diego's lane: estimating. Three commands, all T1 drafts on ESTIMATE-stage
 * jobs, all DIRECT through the lifted cores in lib/estimating — the first
 * capability the Ask box can complete rather than describe.
 *
 * What every `resolve` here has in common: it reads, it never writes, and
 * every figure it puts on a card was read from a row (a catalog price) or
 * typed by the person (a quantity). The model contributes names and the
 * person's own words. Where a name matches several rows the person picks
 * from chips; where the person never said something the model is told to
 * ask; where the natural key already exists the card links to it and
 * offers no button.
 */

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function str(payload: ResolvedPayload, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" ? value : null;
}

// ---------------------------------------------------------------- create job

type CreateJobResolved = {
  jobName: string;
  scope: string | null;
  contact: { id: string; name: string } | { name: string; email: string | null };
  draftLines: boolean;
};

function asCreateJob(payload: ResolvedPayload): CreateJobResolved | null {
  const jobName = str(payload, "jobName");
  const contact = payload.contact;
  if (!jobName || typeof contact !== "object" || contact === null) return null;
  const c = contact as Record<string, unknown>;
  if (typeof c.name !== "string") return null;
  return {
    jobName,
    scope: str(payload, "scope"),
    contact:
      typeof c.id === "string"
        ? { id: c.id, name: c.name }
        : { name: c.name, email: typeof c.email === "string" ? c.email : null },
    draftLines: payload.draftLines === true,
  };
}

async function resolveCreateJob(ctx: CommandContext, input: CommandInput): Promise<Resolution> {
  const jobName = input.jobName ?? "";
  const gcName = input.gcName ?? "";
  const scope = input.scope ?? "";

  const missing: string[] = [];
  if (!jobName) missing.push("the job's name");
  if (!gcName && !input.contactId) missing.push("which GC the job is for");
  if (missing.length > 0) return { kind: "need", missing: missing.join(" and ") };

  const warnings: string[] = [];
  let contact: CreateJobResolved["contact"];
  let onFile: { jobCount: number } | null = null;

  if (input.contactId) {
    // A chip answer. The id is asserted in-company here AND again inside
    // the core's transaction; a forged one is refused twice.
    const row = await prisma.contact.findFirst({
      where: { id: input.contactId, companyId: ctx.companyId },
      select: { id: true, name: true, _count: { select: { jobs: true } } },
    });
    if (!row) return { kind: "refuse", reason: "That GC isn't on your account." };
    contact = { id: row.id, name: row.name };
    onFile = { jobCount: row._count.jobs };
  } else {
    const found = await resolveContact(ctx.companyId, gcName);
    if (found.kind === "many") {
      return {
        kind: "clarify",
        field: "contactId",
        question: `Which ${gcName} is this job for?`,
        options: found.options,
      };
    }
    if (found.kind === "one") {
      contact = { id: found.match.id, name: found.match.name };
      onFile = { jobCount: found.match.jobCount };
      if (found.warning) warnings.push(found.warning);
    } else {
      contact = { name: gcName, email: input.gcEmail ?? null };
    }
  }

  const preview: PreviewLine[] = [{ label: "Job", value: jobName }];

  if ("id" in contact) {
    const existing = await prisma.job.findFirst({
      where: {
        companyId: ctx.companyId,
        contactId: contact.id,
        name: { equals: jobName, mode: "insensitive" },
      },
      select: { id: true, name: true },
    });
    preview.push({
      label: "GC",
      value: `${contact.name} (on file, ${onFile?.jobCount ?? 0} ${onFile?.jobCount === 1 ? "job" : "jobs"})`,
    });
    if (existing) {
      return {
        kind: "ready",
        resolved: { jobName, scope: null, contact, draftLines: false },
        preview,
        warnings,
        existing: { label: `${existing.name} for ${contact.name} already exists`, href: `/jobs/${existing.id}` },
      };
    }
  } else {
    preview.push({
      label: "GC",
      value: `${contact.name} (new contact${contact.email ? `, ${contact.email}` : ""})`,
    });
  }

  preview.push({ label: "Scope", value: scope ? clip(scope, 240) : "None given" });
  preview.push({
    label: "Line items",
    value: scope
      ? "Drafted from the scope once the job exists, each flagged for your review"
      : "None yet. Add them on the job page.",
  });

  return {
    kind: "ready",
    resolved: { jobName, scope: scope || null, contact, draftLines: scope !== "" },
    preview,
    warnings,
  };
}

async function executeCreateJob(ctx: CommandContext, payload: ResolvedPayload) {
  const resolved = asCreateJob(payload);
  if (!resolved) return { ok: false as const, error: "That card can't be executed. Ask again." };

  const created = await createEstimateJob(
    ctx.companyId,
    {
      jobName: resolved.jobName,
      scope: resolved.scope,
      contact: "id" in resolved.contact ? { id: resolved.contact.id } : resolved.contact,
    },
    { refuseDuplicateName: true },
  );
  if (!created.ok) return { ok: false as const, error: created.error };

  const { jobId, contactCreated, alreadyExisted } = created.value;
  const link = { label: resolved.jobName, href: `/jobs/${jobId}`, targetType: "Job", targetId: jobId };

  if (alreadyExisted) {
    return {
      ok: true as const,
      message: `${resolved.jobName} already exists for ${resolved.contact.name}; nothing new was created.`,
      created: link,
    };
  }

  let message = contactCreated
    ? `Created ${resolved.jobName} and added ${resolved.contact.name} as a contact.`
    : `Created ${resolved.jobName} for ${resolved.contact.name}.`;

  if (resolved.draftLines && resolved.scope) {
    const drafted = await draftLinesFromScope(ctx.companyId, { jobId, scopeText: resolved.scope });
    message += drafted.ok
      ? ` Drafted ${drafted.value.count} line ${drafted.value.count === 1 ? "item" : "items"} from the scope, flagged for review.`
      : ` Line items could not be drafted (${drafted.error}). Use "Draft line items" on the job page.`;
  }

  return { ok: true as const, message, created: link };
}

export const createEstimateJobCommand: CommandDefinition = {
  name: "create_estimate_job",
  description:
    "Starts a NEW job at the ESTIMATE stage for a general contractor. There is no separate estimate record: a job's line items ARE its estimate. Needs the job's name and the GC's name — if the person gave either one no name, ask them for it instead of calling this. When a scope of work is given, line items are drafted from it after the job exists, flagged for review. Does NOT contract the job, price anything itself, or send anything. It proposes only: the person confirms on a card before anything is created.",
  capability: "MANAGE_ESTIMATING",
  requiresAlso: ["VIEW_JOB_COSTS"],
  tier: "T1_DRAFT",
  mode: "DIRECT",
  action: "createJob",
  core: "createEstimateJob",
  title: "Create the job",
  verb: "Preparing the job",
  button: "Create job",
  input_schema: {
    type: "object",
    properties: {
      jobName: {
        type: "string",
        description: "The job's name, exactly as the person said it. Required: ask if they did not give one.",
      },
      gcName: {
        type: "string",
        description: "The general contractor the job is for, as the person named them. Required: ask if they did not say.",
      },
      gcEmail: {
        type: "string",
        description: "The GC's email address, only when the person gave one.",
      },
      scope: {
        type: "string",
        description: "The scope of work in the person's own words: trade, building, rough quantities, anything they said about the work itself. Words like 'commercial' or 'tenant improvement' belong here. Omit when they said nothing about the work.",
      },
    },
  },
  continuationKeys: ["contactId"],
  resolve: resolveCreateJob,
  execute: executeCreateJob,
};

// --------------------------------------------------------------- draft lines

async function resolveDraftLines(ctx: CommandContext, input: CommandInput): Promise<Resolution> {
  const jobName = input.jobName ?? "";
  if (!jobName && !input.jobId) return { kind: "need", missing: "which job to draft line items for" };

  let job: { id: string; name: string };
  if (input.jobId) {
    const row = await prisma.job.findFirst({
      where: { id: input.jobId, companyId: ctx.companyId, status: "ESTIMATE" },
      select: { id: true, name: true },
    });
    if (!row) return { kind: "refuse", reason: "That job isn't on your account at the estimate stage." };
    job = row;
  } else {
    const found = await resolveJob(ctx.companyId, jobName, { status: "ESTIMATE" });
    if (found.kind === "none") {
      return {
        kind: "refuse",
        reason: `No estimate-stage job matches "${jobName}". Line items can only be drafted while a job is still an estimate.`,
        href: "/dashboard",
      };
    }
    if (found.kind === "many") {
      return { kind: "clarify", field: "jobId", question: `Which job?`, options: found.options };
    }
    job = { id: found.match.id, name: found.match.name };
  }

  const detail = await prisma.job.findFirst({
    where: { id: job.id, companyId: ctx.companyId },
    select: {
      scope: true,
      lineItems: { where: { aiDrafted: true, isDeleted: false }, select: { id: true }, take: 1 },
    },
  });
  if (detail && detail.lineItems.length > 0) {
    return {
      kind: "refuse",
      reason: `${job.name} already has drafted line items. Review them on the job page rather than drafting a second set.`,
      href: `/jobs/${job.id}`,
    };
  }

  const scopeText = input.scopeText || detail?.scope?.trim() || "";
  if (!scopeText) return { kind: "need", missing: "the scope of work to draft from" };

  return {
    kind: "ready",
    resolved: { jobId: job.id, jobName: job.name, scopeText },
    preview: [
      { label: "Job", value: job.name },
      { label: "Scope", value: clip(scopeText, 240) },
      { label: "Line items", value: "Drafted from this scope, each flagged for your review" },
    ],
    warnings: [],
  };
}

async function executeDraftLines(ctx: CommandContext, payload: ResolvedPayload) {
  const jobId = str(payload, "jobId");
  const jobName = str(payload, "jobName");
  const scopeText = str(payload, "scopeText");
  if (!jobId || !jobName || !scopeText) {
    return { ok: false as const, error: "That card can't be executed. Ask again." };
  }
  const drafted = await draftLinesFromScope(ctx.companyId, { jobId, scopeText });
  if (!drafted.ok) return { ok: false as const, error: drafted.error };
  const n = drafted.value.count;
  return {
    ok: true as const,
    message: `Drafted ${n} line ${n === 1 ? "item" : "items"} on ${jobName}, flagged for review.`,
    created: { label: jobName, href: `/jobs/${jobId}`, targetType: "Job", targetId: jobId },
  };
}

export const draftEstimateLinesCommand: CommandDefinition = {
  name: "draft_estimate_lines",
  description:
    "Drafts line items for an EXISTING estimate-stage job from a scope of work, each flagged for review. Needs the job's name; uses the scope the person gives now, or the scope already recorded on the job when they give none. Refuses when the job already has drafted lines or is past the estimate stage. Does NOT price anything itself: a price comes from the company's catalog or its won bids, or is marked as a guess.",
  capability: "MANAGE_ESTIMATING",
  requiresAlso: ["VIEW_JOB_COSTS"],
  tier: "T1_DRAFT",
  mode: "DIRECT",
  action: "draftLineItemsFromScope",
  core: "draftLinesFromScope",
  title: "Draft the line items",
  verb: "Preparing the draft",
  button: "Draft line items",
  input_schema: {
    type: "object",
    properties: {
      jobName: {
        type: "string",
        description: "The job's name or part of it, as the person said it. Required.",
      },
      scopeText: {
        type: "string",
        description: "The scope of work in the person's own words, when they gave one now. Omit to use the scope already on the job.",
      },
    },
  },
  continuationKeys: ["jobId"],
  resolve: resolveDraftLines,
  execute: executeDraftLines,
};

// -------------------------------------------------------------- catalog line

async function resolveCatalogLine(ctx: CommandContext, input: CommandInput): Promise<Resolution> {
  const jobName = input.jobName ?? "";
  const item = input.item ?? "";
  const quantity = input.quantity ?? "";

  const missing: string[] = [];
  if (!jobName && !input.jobId) missing.push("which job");
  if (!item && !input.catalogEntryId) missing.push("which catalog item");
  if (!quantity) missing.push("the quantity");
  if (missing.length > 0) return { kind: "need", missing: missing.join(", ") };

  if (Number.isNaN(Number(quantity)) || Number(quantity) <= 0) {
    return { kind: "need", missing: "the quantity as a number greater than zero" };
  }

  let job: { id: string; name: string };
  if (input.jobId) {
    const row = await prisma.job.findFirst({
      where: { id: input.jobId, companyId: ctx.companyId, status: "ESTIMATE" },
      select: { id: true, name: true },
    });
    if (!row) return { kind: "refuse", reason: "That job isn't on your account at the estimate stage." };
    job = row;
  } else {
    const found = await resolveJob(ctx.companyId, jobName, { status: "ESTIMATE" });
    if (found.kind === "none") {
      return {
        kind: "refuse",
        reason: `No estimate-stage job matches "${jobName}". Lines can only be added while a job is still an estimate.`,
        href: "/dashboard",
      };
    }
    if (found.kind === "many") {
      return { kind: "clarify", field: "jobId", question: "Which job?", options: found.options };
    }
    job = { id: found.match.id, name: found.match.name };
  }

  let entry: { id: string; description: string; unit: string | null; defaultUnitPrice: number | null };
  if (input.catalogEntryId) {
    const row = await prisma.lineItemCatalogEntry.findFirst({
      where: { id: input.catalogEntryId, companyId: ctx.companyId },
      select: { id: true, description: true, unit: true, defaultUnitPrice: true },
    });
    if (!row) return { kind: "refuse", reason: "That catalog item isn't on your account." };
    entry = { ...row, defaultUnitPrice: row.defaultUnitPrice != null ? Number(row.defaultUnitPrice) : null };
  } else {
    const found = await resolveCatalogEntry(ctx.companyId, item);
    if (found.kind === "none") {
      return {
        kind: "refuse",
        reason: `Nothing in the catalog matches "${item}". Add it on the catalog page first, or add a free-form line on the job page.`,
        href: "/catalog",
      };
    }
    if (found.kind === "many") {
      return { kind: "clarify", field: "catalogEntryId", question: "Which catalog item?", options: found.options };
    }
    entry = found.match;
  }

  return {
    kind: "ready",
    resolved: {
      jobId: job.id,
      jobName: job.name,
      catalogEntryId: entry.id,
      description: entry.description,
      unit: entry.unit,
      quantity,
    },
    preview: [
      { label: "Job", value: job.name },
      { label: "Item", value: entry.description },
      {
        label: "Unit price",
        value:
          entry.defaultUnitPrice != null
            ? `${money(entry.defaultUnitPrice)} per ${entry.unit ?? "unit"}`
            : "No default price on the catalog entry",
      },
      { label: "Quantity", value: `${quantity} ${entry.unit ?? ""}`.trim() },
    ],
    warnings: [],
  };
}

async function executeCatalogLine(ctx: CommandContext, payload: ResolvedPayload) {
  const jobId = str(payload, "jobId");
  const jobName = str(payload, "jobName");
  const catalogEntryId = str(payload, "catalogEntryId");
  const quantity = str(payload, "quantity");
  if (!jobId || !jobName || !catalogEntryId || !quantity) {
    return { ok: false as const, error: "That card can't be executed. Ask again." };
  }
  const added = await addCatalogLine(ctx.companyId, { jobId, catalogEntryId, quantity });
  if (!added.ok) return { ok: false as const, error: added.error };
  return {
    ok: true as const,
    message: `Added ${quantity} ${added.value.unit ?? ""} of ${added.value.description} to ${jobName}.`.replace(/\s+/g, " "),
    created: { label: jobName, href: `/jobs/${jobId}`, targetType: "Job", targetId: jobId },
  };
}

export const addCatalogLineCommand: CommandDefinition = {
  name: "add_catalog_line",
  description:
    "Adds ONE line to an estimate-stage job from the company's own catalog, at the catalog's price. Needs the job's name, the catalog item as the person named it, and a quantity; ask for whichever is missing. Does NOT invent an item or a price: when the catalog has no such item it refuses and says so. Does NOT total anything.",
  capability: "MANAGE_ESTIMATING",
  requiresAlso: ["VIEW_JOB_COSTS"],
  tier: "T1_DRAFT",
  mode: "DIRECT",
  action: "addLineItemFromCatalog",
  core: "addCatalogLine",
  title: "Add the line",
  verb: "Preparing the line",
  button: "Add line",
  input_schema: {
    type: "object",
    properties: {
      jobName: { type: "string", description: "The job's name or part of it, as the person said it. Required." },
      item: { type: "string", description: "The catalog item as the person named it, e.g. '5/8 Type X'. Required." },
      quantity: {
        type: "string",
        description: "The quantity in the item's own unit, as the person said it, digits only, e.g. '200'. Required.",
      },
    },
  },
  continuationKeys: ["jobId", "catalogEntryId"],
  resolve: resolveCatalogLine,
  execute: executeCatalogLine,
};

export const estimatingCommands: CommandDefinition[] = [
  createEstimateJobCommand,
  draftEstimateLinesCommand,
  addCatalogLineCommand,
];

/** Every other export of jobs.ts and estimating.ts, each with the reason it
 * is not a command. Per action rather than a wildcard, because these are
 * the two files this lane just read line by line. */
export const estimatingExclusions: Exclusion[] = [
  { action: "addLineItem", reason: "A free-form line carries a typed unit price, a number the model would be supplying. Use add_catalog_line or the job page." },
  { action: "updateLineItem", reason: "Editing a priced line is done on the job page, where the row it changes is visible." },
  { action: "updateLineItemForecast", reason: "A cost forecast is job-costing money; phase 3 territory once natural keys exist." },
  { action: "deleteLineItem", reason: "Deletes are never commands (T5); the page's own two-step delete is the path." },
  { action: "markJobContracted", reason: "The transition that locks pricing behind change orders and requires a signed request; never offered (T5)." },
  { action: "recordExecutedSubcontract", reason: "Needs a real File for the executed subcontract; nothing a prompt can supply." },
  { action: "setJobStatus", reason: "Status transitions gate billing and time; a page decision, not a prompt (T5)." },
  { action: "addCostEntry", reason: "Job-cost money with no natural key yet (#102); phase 3." },
  { action: "deleteCostEntry", reason: "Deletes are never commands (T5)." },
  { action: "updateJobSchedule", reason: "Schedule dates are edited on the job page; a T2 modify for a later phase." },
  { action: "assignCrewMember", reason: "Its duplicate check uses the instanceof form shared.ts documents as false at runtime; not registered until that is fixed." },
  { action: "unassignCrewMember", reason: "Removing a person from a roster is done where the roster is shown." },
  { action: "addTakeoffLineItems", reason: "Takeoff needs dimensions in a form the model should not be transcribing; the job page's takeoff form is the path." },
  { action: "createBidInvitation", reason: "Bid tracking is a later phase; needs a contact resolver and a due date the person types." },
  { action: "updateBidInvitationStatus", reason: "A won/lost decision is made on the bids page where the bid is visible." },
  { action: "deleteBidInvitation", reason: "Deletes are never commands (T5)." },
  { action: "createLineItemCatalogEntry", reason: "A catalog entry carries a typed default price, a number the model would be supplying." },
  { action: "deleteLineItemCatalogEntry", reason: "Deletes are never commands (T5)." },
  { action: "saveLineItemAsCatalogEntry", reason: "Promoting a line to the catalog is done from the line on the job page." },
  { action: "saveEstimateVersion", reason: "versionNumber is max+1 outside a transaction (estimating.ts); not exposed to a retrying caller until it has a counter." },
  { action: "updateCatalogDefaultsFromActuals", reason: "Owner-only pricing change with its own margin arithmetic; page only." },
  { action: "importCatalogEntries", reason: "Owner-only bulk import of pasted CSV; page only." },
];
