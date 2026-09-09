import { prisma, type JobStatus } from "@prova/db";
import { money } from "@/lib/money";

/**
 * Turning what a person SAID into the row they MEANT.
 *
 * A read tool can be loose about this: "Riverside" matching two jobs just
 * returns two rows, and `matchesJobName` in tools.ts is exactly that kind of
 * filter. A write cannot. Money filed against the wrong "Riverside" is a
 * silent error with a GC on the other end of it, and issue #103 already
 * documents the substring matcher returning company-wide good news on a
 * typo. So a resolver here returns exactly one of three things, and "many"
 * is never quietly collapsed to a pick:
 *
 *   one   — an exact (case-insensitive) match, or the only partial match
 *   many  — the candidates, each with the detail that tells them apart,
 *           for the person to choose from a chip row
 *   none  — nothing matched; the command decides whether that means
 *           "create it" (a GC) or "refuse" (a job that must already exist)
 *
 * The ranking is pure and tested; only the reads touch the database.
 */

export type Option = { value: string; label: string; detail?: string };

export type Resolved<T> =
  | { kind: "one"; match: T; warning?: string }
  | { kind: "many"; options: Option[] }
  | { kind: "none" };

/** Exact matches beat partial ones outright; among partial matches nothing
 * is preferred, because preferring the newest or the shortest is a guess
 * dressed as a rule. */
export function rankByName<T extends { name: string }>(rows: T[], text: string): T[] {
  const wanted = text.trim().toLowerCase();
  if (!wanted) return [];
  const exact = rows.filter((row) => row.name.trim().toLowerCase() === wanted);
  if (exact.length > 0) return exact;
  return rows.filter((row) => row.name.toLowerCase().includes(wanted));
}

const MAX_CANDIDATES = 20;

export type ResolvedJob = { id: string; name: string; status: JobStatus; contactName: string };

export async function resolveJob(
  companyId: string,
  text: string,
  options: { status?: JobStatus } = {},
): Promise<Resolved<ResolvedJob>> {
  const wanted = text.trim();
  if (!wanted) return { kind: "none" };
  const rows = await prisma.job.findMany({
    where: {
      companyId,
      ...(options.status ? { status: options.status } : {}),
      name: { contains: wanted, mode: "insensitive" },
    },
    select: { id: true, name: true, status: true, contact: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: MAX_CANDIDATES,
  });
  const candidates = rankByName(rows, wanted);
  if (candidates.length === 0) return { kind: "none" };
  if (candidates.length === 1) {
    const [job] = candidates;
    return {
      kind: "one",
      match: { id: job.id, name: job.name, status: job.status, contactName: job.contact.name },
    };
  }
  return {
    kind: "many",
    options: candidates.map((job) => ({
      value: job.id,
      label: job.name,
      detail: `${job.status.toLowerCase().replace("_", " ")} · ${job.contact.name}`,
    })),
  };
}

export type ResolvedContact = { id: string; name: string; email: string | null; jobCount: number };

/** GCs, with the one rule a job resolver does not need: when every
 * candidate shares the same name AND the same email, they are the
 * duplicates /jobs/new used to mint, and a chip row of three identical
 * "Turner Construction" entries is a question the person cannot answer.
 * The one with the most jobs is used and the card SAYS so. */
export async function resolveContact(
  companyId: string,
  text: string,
): Promise<Resolved<ResolvedContact>> {
  const wanted = text.trim();
  if (!wanted) return { kind: "none" };
  const rows = await prisma.contact.findMany({
    where: { companyId, name: { contains: wanted, mode: "insensitive" } },
    select: { id: true, name: true, email: true, _count: { select: { jobs: true } } },
    orderBy: { createdAt: "asc" },
    take: MAX_CANDIDATES,
  });
  const candidates = rankByName(rows, wanted).map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    jobCount: row._count.jobs,
  }));
  return pickContact(candidates);
}

/** Pure, so the duplicate rule can be tested without a database. */
export function pickContact(candidates: ResolvedContact[]): Resolved<ResolvedContact> {
  if (candidates.length === 0) return { kind: "none" };
  if (candidates.length === 1) return { kind: "one", match: candidates[0] };

  const key = (c: ResolvedContact) => `${c.name.trim().toLowerCase()}|${(c.email ?? "").trim().toLowerCase()}`;
  const identical = candidates.every((c) => key(c) === key(candidates[0]));
  if (identical) {
    const [best] = [...candidates].sort((a, b) => b.jobCount - a.jobCount);
    const others = candidates.length - 1;
    return {
      kind: "one",
      match: best,
      warning: `Reusing the ${best.name} record with ${best.jobCount} ${best.jobCount === 1 ? "job" : "jobs"}; ${others} identical ${others === 1 ? "duplicate exists" : "duplicates exist"} on /contacts.`,
    };
  }

  return {
    kind: "many",
    options: candidates.map((c) => ({
      value: c.id,
      label: c.name,
      detail: `${c.email ?? "no email"} · ${c.jobCount} ${c.jobCount === 1 ? "job" : "jobs"}`,
    })),
  };
}

export type ResolvedCatalogEntry = {
  id: string;
  description: string;
  /** Nullable on the row: an entry can be priced "each" with no unit named. */
  unit: string | null;
  defaultUnitPrice: number | null;
};

export async function resolveCatalogEntry(
  companyId: string,
  text: string,
): Promise<Resolved<ResolvedCatalogEntry>> {
  const wanted = text.trim();
  if (!wanted) return { kind: "none" };
  const rows = await prisma.lineItemCatalogEntry.findMany({
    where: { companyId, description: { contains: wanted, mode: "insensitive" } },
    select: { id: true, description: true, unit: true, defaultUnitPrice: true },
    orderBy: { description: "asc" },
    take: MAX_CANDIDATES,
  });
  const candidates = rankByName(
    rows.map((row) => ({ ...row, name: row.description })),
    wanted,
  ).map((row) => ({
    id: row.id,
    description: row.description,
    unit: row.unit,
    defaultUnitPrice: row.defaultUnitPrice != null ? Number(row.defaultUnitPrice) : null,
  }));
  if (candidates.length === 0) return { kind: "none" };
  if (candidates.length === 1) return { kind: "one", match: candidates[0] };
  return {
    kind: "many",
    options: candidates.map((entry) => ({
      value: entry.id,
      label: entry.description,
      detail:
        entry.defaultUnitPrice != null
          ? `${money(entry.defaultUnitPrice)} per ${entry.unit ?? "unit"}`
          : `per ${entry.unit ?? "unit"} · no default price`,
    })),
  };
}

// ------------------------------------------------------------------ equipment

export type ResolvedEquipment = {
  id: string;
  name: string;
  assetTag: string | null;
  type: string | null;
  /** The stay with no return date, if any: where the piece is booked to
   * be. A dispatch record, not a position — there is no GPS. */
  openStay: { id: string; jobId: string; jobName: string; sentOutOn: string } | null;
};

/** Exact on the name OR the asset tag wins outright — a tag is the thing
 * painted on the machine, and "SS-114" typed exactly is not a guess. */
export function rankEquipment<T extends { name: string; assetTag: string | null }>(
  rows: T[],
  text: string,
): T[] {
  const wanted = text.trim().toLowerCase();
  if (!wanted) return [];
  const exact = rows.filter(
    (row) =>
      row.name.trim().toLowerCase() === wanted ||
      (row.assetTag ?? "").trim().toLowerCase() === wanted,
  );
  if (exact.length > 0) return exact;
  return rows;
}

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

export async function resolveEquipment(
  companyId: string,
  text: string,
): Promise<Resolved<ResolvedEquipment>> {
  const wanted = text.trim();
  if (!wanted) return { kind: "none" };
  const rows = await prisma.equipment.findMany({
    where: {
      companyId,
      OR: [
        { name: { contains: wanted, mode: "insensitive" } },
        { assetTag: { contains: wanted, mode: "insensitive" } },
        { type: { contains: wanted, mode: "insensitive" } },
      ],
    },
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
    orderBy: { name: "asc" },
    take: MAX_CANDIDATES,
  });
  const candidates: ResolvedEquipment[] = rankEquipment(rows, wanted).map((row) => {
    const stay = row.assignments[0];
    return {
      id: row.id,
      name: row.name,
      assetTag: row.assetTag,
      type: row.type,
      openStay: stay
        ? { id: stay.id, jobId: stay.jobId, jobName: stay.job.name, sentOutOn: isoDay(stay.sentOutOn) }
        : null,
    };
  });
  if (candidates.length === 0) return { kind: "none" };
  if (candidates.length === 1) return { kind: "one", match: candidates[0] };
  return {
    kind: "many",
    options: candidates.map((piece) => ({
      value: piece.id,
      label: piece.name,
      detail: `${piece.assetTag ?? "no tag"} · ${
        piece.openStay ? `out on ${piece.openStay.jobName} since ${piece.openStay.sentOutOn}` : "in the yard"
      }`,
    })),
  };
}

// ------------------------------------------------------------ material orders

export type ResolvedOrder = {
  id: string;
  number: number;
  description: string;
  vendorName: string;
  promisedFor: string | null;
};

/** Open orders on one job — those with no closing delivery — optionally
 * narrowed by what the person called the material or the vendor. */
export async function resolveOpenMaterialOrder(
  companyId: string,
  jobId: string,
  text: string | undefined,
): Promise<Resolved<ResolvedOrder>> {
  const rows = await prisma.materialOrder.findMany({
    where: { companyId, jobId, deliveries: { none: { completesOrder: true } } },
    select: {
      id: true,
      number: true,
      description: true,
      promisedFor: true,
      vendor: { select: { name: true } },
    },
    orderBy: { number: "desc" },
    take: MAX_CANDIDATES,
  });
  const wanted = (text ?? "").trim().toLowerCase();
  const narrowed = wanted
    ? rows.filter(
        (row) =>
          row.description.toLowerCase().includes(wanted) ||
          row.vendor.name.toLowerCase().includes(wanted),
      )
    : rows;
  const exact = wanted ? narrowed.filter((row) => row.description.trim().toLowerCase() === wanted) : [];
  const candidates = (exact.length > 0 ? exact : narrowed).map((row) => ({
    id: row.id,
    number: row.number,
    description: row.description,
    vendorName: row.vendor.name,
    promisedFor: row.promisedFor ? isoDay(row.promisedFor) : null,
  }));
  if (candidates.length === 0) return { kind: "none" };
  if (candidates.length === 1) return { kind: "one", match: candidates[0] };
  return {
    kind: "many",
    options: candidates.map((order) => ({
      value: order.id,
      label: `#${order.number} ${order.description}`,
      detail: `${order.vendorName}${order.promisedFor ? ` · promised ${order.promisedFor}` : ""}`,
    })),
  };
}
