import { prisma } from "@prova/db";
import {
  AccApiError,
  AccForbiddenError,
  fetchAccRfis,
  fetchAccSubmittals,
  listAccHubs,
  listAccProjects,
  type AccConfig,
  type AccFeedItem,
  type AccFeedKind,
  type AccProject,
} from "@prova/integrations";
import { withAccToken, type AccDeps } from "./connection";

/**
 * Reading a GC's ACC project into the cache under one link. Same shape as
 * lib/procore/feed.ts — read that file's header first.
 *
 * READ-ONLY toward ACC: every call here goes through `accGet`, whose method
 * is a literal GET. The only WRITES are to this company's own AccItem cache
 * and the link's last-refresh line.
 *
 * TENANT SCOPE. Every query names the company from the SESSION, passed in
 * by the action — a link id from a browser is only ever looked up together
 * with that company id, so another company's link reads as "not found".
 */

/** A cache older than this is refreshed when someone opens a page showing
 * it. Fifteen minutes, same value as Procore's — fresh enough that a GC's
 * answer shows up the same morning, rare enough to stay far inside
 * Autodesk's rate limit. */
export const ACC_STALE_AFTER_MS = 15 * 60 * 1000;

const KINDS: { kind: AccFeedKind; label: string }[] = [
  { kind: "RFI", label: "RFIs" },
  { kind: "SUBMITTAL", label: "submittals" },
];

export function isStale(lastRefreshedAt: Date | null, now: Date): boolean {
  return !lastRefreshedAt || now.getTime() - lastRefreshedAt.getTime() >= ACC_STALE_AFTER_MS;
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
  | { kind: AccFeedKind; ok: true; items: AccFeedItem[]; truncated: boolean }
  | { kind: AccFeedKind; ok: false; message: string };

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
 * Refresh one link: read both kinds, then replace each kind that was read
 * successfully, in one transaction with the status line. A kind that failed
 * (say the GC's account has not added the Submittals tool for this login)
 * keeps what it had, and the status line says which.
 *
 * Returns null when the link is not this company's.
 */
export async function refreshAccLink(companyId: string, linkId: string, deps: AccDeps = {}): Promise<RefreshOutcome | null> {
  const link = await prisma.accProjectLink.findFirst({
    where: { id: linkId, companyId },
    select: { id: true, accAccountId: true, accProjectId: true },
  });
  if (!link) return null;
  const ref = { accAccountId: link.accAccountId, accProjectId: link.accProjectId };

  const outcomes = await withAccToken(
    companyId,
    async (token, config) => {
      const results: KindOutcome[] = [];
      const readers = { RFI: fetchAccRfis, SUBMITTAL: fetchAccSubmittals } as const;
      for (const { kind } of KINDS) {
        try {
          const page = await readers[kind](config, token, ref, deps);
          results.push({ kind, ok: true, items: page.items, truncated: page.truncated });
        } catch (error) {
          // Per-kind failures are reported, not fatal. A 401 is NOT caught
          // here: it goes up to withAccToken, which refreshes and reruns.
          if (error instanceof AccForbiddenError || error instanceof AccApiError) {
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
      await tx.accItem.deleteMany({ where: { companyId, linkId: link.id, kind: outcome.kind } });
      if (outcome.items.length > 0) {
        await tx.accItem.createMany({
          data: outcome.items.map((item) => ({
            companyId,
            linkId: link.id,
            kind: item.kind,
            accId: item.accId,
            number: item.number,
            title: item.title,
            status: item.status,
            revision: item.revision,
            discipline: item.discipline,
            ballInCourt: item.ballInCourt,
            dueDate: dayToDate(item.dueDate),
            accUpdatedAt: instant(item.updatedAt),
            webUrl: item.webUrl,
            fetchedAt: now,
          })),
          // Autodesk should never list one id twice in a list; if it does,
          // the second copy is dropped rather than failing the refresh.
          skipDuplicates: true,
        });
      }
    }
    await tx.accProjectLink.updateMany({
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

export type LinkableAccount = {
  id: string;
  name: string;
  projects: AccProject[];
  /** Set when this account's projects could not be read — most often
   * because that account has not added the C Stream app as a Custom
   * Integration. */
  problem: string | null;
};

/** Every ACC account this login belongs to, with the projects it can see in
 * each. An account whose projects are unreadable is still listed, with the
 * reason, so the owner knows WHY a GC's project is missing. */
export async function listLinkableAccProjects(companyId: string, deps: AccDeps = {}): Promise<LinkableAccount[]> {
  return withAccToken(
    companyId,
    async (token, config: AccConfig) => {
      const hubs = await listAccHubs(config, token, deps);
      const out: LinkableAccount[] = [];
      for (const hub of hubs) {
        try {
          const projects = await listAccProjects(config, token, hub, deps);
          out.push({ ...hub, projects, problem: null });
        } catch (error) {
          if (error instanceof AccForbiddenError) {
            out.push({
              ...hub,
              projects: [],
              problem:
                "Autodesk won't list this account's projects to C Stream. Their ACC account admin has to add the C Stream app first (Account Admin → Custom Integrations).",
            });
          } else if (error instanceof AccApiError) {
            out.push({ ...hub, projects: [], problem: error.message });
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
