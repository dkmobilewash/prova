import { prisma } from "@prova/db";
import {
  ProcoreApiError,
  ProcoreForbiddenError,
  fetchProcoreDrawings,
  fetchProcoreRfis,
  fetchProcoreSubmittals,
  listProcoreCompanies,
  listProcoreProjects,
  type ProcoreConfig,
  type ProcoreFeedItem,
  type ProcoreFeedKind,
  type ProcoreProject,
} from "@prova/integrations";
import { withProcoreToken, type ProcoreDeps } from "./connection";

/**
 * Reading a GC's Procore project into the cache under one link.
 *
 * READ-ONLY toward Procore: every call here goes through `procoreGet`,
 * whose method is a literal GET. The only WRITES are to this company's own
 * ProcoreItem cache and the link's last-refresh line.
 *
 * TENANT SCOPE. Every query names the company from the SESSION, passed in
 * by the action — a link id from a browser is only ever looked up together
 * with that company id, so another company's link reads as "not found".
 */

/** A cache older than this is refreshed when someone opens a page showing
 * it. Fifteen minutes: fresh enough that a GC's answer shows up the same
 * morning, rare enough to stay far inside Procore's hourly rate limit. */
export const PROCORE_STALE_AFTER_MS = 15 * 60 * 1000;

const KINDS: { kind: ProcoreFeedKind; label: string }[] = [
  { kind: "DRAWING", label: "drawings" },
  { kind: "RFI", label: "RFIs" },
  { kind: "SUBMITTAL", label: "submittals" },
];

export function isStale(lastRefreshedAt: Date | null, now: Date): boolean {
  return !lastRefreshedAt || now.getTime() - lastRefreshedAt.getTime() >= PROCORE_STALE_AFTER_MS;
}

function dayToDate(day: string | null): Date | null {
  return day ? new Date(`${day}T00:00:00.000Z`) : null;
}

function instant(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

type KindOutcome =
  | { kind: ProcoreFeedKind; ok: true; items: ProcoreFeedItem[]; truncated: boolean }
  | { kind: ProcoreFeedKind; ok: false; message: string };

export type RefreshOutcome = { ok: boolean; message: string };

/** One sentence for the link's status line, from what each kind did. */
export function refreshSentence(outcomes: KindOutcome[]): RefreshOutcome {
  const parts: string[] = [];
  const failures: string[] = [];
  for (const outcome of outcomes) {
    const label = KINDS.find((k) => k.kind === outcome.kind)?.label ?? outcome.kind;
    if (outcome.ok) {
      parts.push(`${outcome.items.length}${outcome.truncated ? "+" : ""} ${label}`);
    } else {
      failures.push(`${label}: ${outcome.message}`);
    }
  }
  const read = parts.length > 0 ? `Read ${parts.join(", ")}.` : "";
  const failed = failures.length > 0 ? ` Couldn't read ${failures.join(" ")}` : "";
  return { ok: failures.length === 0, message: `${read}${failed}`.trim() };
}

/**
 * Refresh one link: read all three kinds, then replace each kind that was
 * read successfully, in one transaction with the status line. A kind that
 * failed (say the GC gives this login no Drawings access) keeps what it
 * had, and the status line says which.
 *
 * Returns null when the link is not this company's.
 */
export async function refreshProcoreLink(
  companyId: string,
  linkId: string,
  deps: ProcoreDeps = {},
): Promise<RefreshOutcome | null> {
  const link = await prisma.procoreProjectLink.findFirst({
    where: { id: linkId, companyId },
    select: { id: true, procoreCompanyId: true, procoreProjectId: true },
  });
  if (!link) return null;
  const ref = { procoreCompanyId: link.procoreCompanyId, procoreProjectId: link.procoreProjectId };

  const outcomes = await withProcoreToken(
    companyId,
    async (token, config) => {
      const results: KindOutcome[] = [];
      const readers = {
        DRAWING: fetchProcoreDrawings,
        RFI: fetchProcoreRfis,
        SUBMITTAL: fetchProcoreSubmittals,
      } as const;
      for (const { kind } of KINDS) {
        try {
          const page = await readers[kind](config, token, ref, deps);
          results.push({ kind, ok: true, items: page.items, truncated: page.truncated });
        } catch (error) {
          // Per-kind failures are reported, not fatal. A 401 is NOT caught
          // here: it goes up to withProcoreToken, which refreshes and reruns.
          if (error instanceof ProcoreForbiddenError || error instanceof ProcoreApiError) {
            results.push({ kind, ok: false, message: error.message });
          } else {
            throw error;
          }
        }
      }
      return results;
    },
    deps,
  );

  const summary = refreshSentence(outcomes);
  const now = (deps.now ?? (() => new Date()))();
  await prisma.$transaction(async (tx) => {
    for (const outcome of outcomes) {
      if (!outcome.ok) continue;
      await tx.procoreItem.deleteMany({ where: { companyId, linkId: link.id, kind: outcome.kind } });
      if (outcome.items.length > 0) {
        await tx.procoreItem.createMany({
          data: outcome.items.map((item) => ({
            companyId,
            linkId: link.id,
            kind: item.kind,
            procoreId: item.procoreId,
            number: item.number,
            title: item.title,
            status: item.status,
            revision: item.revision,
            discipline: item.discipline,
            ballInCourt: item.ballInCourt,
            dueDate: dayToDate(item.dueDate),
            procoreUpdatedAt: instant(item.updatedAt),
            webUrl: item.webUrl,
            fetchedAt: now,
          })),
          // Procore should never list one id twice in a list; if it does,
          // the second copy is dropped rather than failing the refresh.
          skipDuplicates: true,
        });
      }
    }
    await tx.procoreProjectLink.updateMany({
      where: { id: link.id, companyId },
      data: {
        lastRefreshedAt: now,
        lastRefreshStatus: summary.ok ? "SUCCESS" : "FAILURE",
        lastRefreshMessage: summary.message,
      },
    });
  });
  return summary;
}

export type LinkableCompany = {
  id: string;
  name: string;
  projects: ProcoreProject[];
  /** Set when this company's projects could not be read — most often
   * because that company has not installed the C Stream app. */
  problem: string | null;
};

/** Every Procore company this login belongs to, with the projects it can
 * see in each. A company whose projects are unreadable is still listed,
 * with the reason, so the owner knows WHY a GC's project is missing. */
export async function listLinkableProjects(companyId: string, deps: ProcoreDeps = {}): Promise<LinkableCompany[]> {
  return withProcoreToken(
    companyId,
    async (token, config: ProcoreConfig) => {
      const companies = await listProcoreCompanies(config, token, deps);
      const out: LinkableCompany[] = [];
      for (const company of companies) {
        try {
          const projects = await listProcoreProjects(config, token, company, deps);
          out.push({ ...company, projects, problem: null });
        } catch (error) {
          if (error instanceof ProcoreForbiddenError) {
            out.push({
              ...company,
              projects: [],
              problem:
                "Procore won't list this company's projects to C Stream. Their Procore admin has to add the C Stream app to their company first (Procore: Company Admin → App Management).",
            });
          } else if (error instanceof ProcoreApiError) {
            out.push({ ...company, projects: [], problem: error.message });
          } else {
            throw error;
          }
        }
      }
      return out;
    },
    deps,
  );
}
