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
