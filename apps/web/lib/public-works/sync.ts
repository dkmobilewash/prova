import type { Prisma, PrismaClient } from "@prova/db";
import { readFirms, readOwners, type CslbFirm } from "./cslb";
import { fetchProjectLinks, openDirSession, searchEcpr, type DirSession, type EcprRow } from "./dir";
import { AWARD_WINDOW_DAYS, COUNTIES, ECPR_WINDOW_DAYS, SLICE_KEYS, ecprWindows, nameIndex, nameKey, nextSlice } from "./signals";

/**
 * THE SYNC: ONE SLICE OF THE PUBLIC RECORD PER CALL, THE STALEST FIRST.
 *
 * A serverless invocation has a 60-second ceiling, the CSLB master file alone
 * takes most of that to stream, and the eCPR search answers one county at a
 * time. So the sync never tries to refresh everything: it asks
 * `nextSlice()` what is stalest, does that, records when, and goes again
 * while there is budget left. Called daily it walks the whole state in about
 * a week; called from the page's button it does the same thing with a
 * person watching. Both are idempotent — a firm upserts on its licence, a
 * signal inserts on DIR's own key and a duplicate is skipped — so a second
 * call a second later repeats nothing.
 *
 * Signals that match no firm are DROPPED, not stored: a filing by a plumber
 * is not a prospect, and an unmatched drywall firm is a name-matching gap to
 * measure (`unmatched` in the report), not a row.
 */

export type SyncDeps = {
  prisma: PrismaClient;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  /** Stop starting new slices after this many ms. */
  budgetMs?: number;
};

export type SliceReport = { key: string; rows: number; matched?: number; unmatched?: number; note?: string };
export type SyncReport = { slices: SliceReport[]; stoppedBy: "budget" | "nothing-stale" };

const DAY = 24 * 60 * 60 * 1000;

export async function runPublicWorksSync(deps: SyncDeps): Promise<SyncReport> {
  const { prisma } = deps;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? (() => new Date());
  const started = now().getTime();
  const budget = deps.budgetMs ?? 45_000;
  const slices: SliceReport[] = [];
  let session: DirSession | null = null;

  for (;;) {
    if (now().getTime() - started > budget) return { slices, stoppedBy: "budget" };
    const states = await prisma.publicWorksSyncSlice.findMany({ select: { key: true, syncedAt: true } });
    const key = nextSlice(states, now());
    if (!key) return { slices, stoppedBy: "nothing-stale" };

    let report: SliceReport;
    if (key === SLICE_KEYS.master) report = await syncMaster(prisma, fetchImpl, now());
    else if (key === SLICE_KEYS.personnel) report = await syncPersonnel(prisma, fetchImpl, now());
    else {
      session ??= await openDirSession(fetchImpl);
      report = key === SLICE_KEYS.links ? await syncLinks(prisma, session, now()) : await syncEcpr(prisma, session, key.slice("ecpr:".length), now());
    }
    await prisma.publicWorksSyncSlice.upsert({
      where: { key },
      create: { key, syncedAt: now(), rows: report.rows, note: report.note ?? null },
      update: { syncedAt: now(), rows: report.rows, note: report.note ?? null },
    });
    slices.push(report);
  }
}

/** Read the whole filtered file FIRST, then write. The first version
 * upserted each row as it streamed, and CSLB closed the socket 33 MB in —
 * a server will not hold a connection open while the client talks to a
 * database between chunks. ~6,700 firms fit in memory many times over. */
async function syncMaster(prisma: PrismaClient, fetchImpl: typeof fetch, now: Date): Promise<SliceReport> {
  const firms: CslbFirm[] = [];
  for await (const firm of readFirms(fetchImpl)) firms.push(firm);
  await inBatches(firms, 50, async ({ licence, ...rest }) => {
    await prisma.publicWorksFirm.upsert({
      where: { licence },
      create: { licence, ...rest, owners: [], refreshedAt: now },
      update: { ...rest, refreshedAt: now },
    });
  });
  return { key: SLICE_KEYS.master, rows: firms.length };
}

/** Fifty concurrent writes at a time: one at a time is 6,700 round trips to
 * Neon, which does not fit a 60-second function; all at once exhausts the
 * pool (connection_limit=5 behind the pooler). */
async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

async function syncPersonnel(prisma: PrismaClient, fetchImpl: typeof fetch, now: Date): Promise<SliceReport> {
  const firms = await prisma.publicWorksFirm.findMany({ select: { licence: true } });
  const owners = await readOwners(new Set(firms.map((f) => f.licence)), fetchImpl);
  await inBatches([...owners], 50, async ([licence, list]) => {
    await prisma.publicWorksFirm.update({ where: { licence }, data: { owners: list as unknown as Prisma.InputJsonValue, refreshedAt: now } });
  });
  return { key: SLICE_KEYS.personnel, rows: owners.size };
}

async function firmIndex(prisma: PrismaClient) {
  return nameIndex(await prisma.publicWorksFirm.findMany({ select: { licence: true, name: true, fullName: true } }));
}

async function syncLinks(prisma: PrismaClient, session: DirSession, now: Date): Promise<SliceReport> {
  const since = new Date(now.getTime() - AWARD_WINDOW_DAYS * DAY).toISOString().slice(0, 10);
  const filter = `x_cdoi2_csm_portal_project.award_date>=${since}`;
  const index = await firmIndex(prisma);
  // The prime is the row on the same project that is NOT a sub; a sub's
  // `parent` field is usually empty, so remember primes per project.
  const primes = new Map<string, string>();
  let rows = 0, matched = 0, unmatched = 0;
  for (let page = 1; ; page++) {
    const { rows: list, numPages } = await fetchProjectLinks(session, filter, page);
    for (const r of list) if (r.is_sub_contractor === "false" && r.customer_account) primes.set(r.x_cdoi2_csm_portal_project__id, r.customer_account);
    for (const r of list) {
      rows++;
      if (r.is_sub_contractor !== "true") continue;
      const licence = index.get(nameKey(r.customer_account));
      if (!licence) { unmatched++; continue; }
      const award = r["x_cdoi2_csm_portal_project.award_date"];
      await insertSignal(prisma, {
        licence,
        kind: "PROJECT_LISTING",
        vendorKey: `link:${r.sys_id}`,
        project: r["x_cdoi2_csm_portal_project.name"] || r.x_cdoi2_csm_portal_project || "public project",
        awardingBody: r["x_cdoi2_csm_portal_project.awarding_body"] || null,
        primeContractor: r.parent || primes.get(r.x_cdoi2_csm_portal_project__id) || null,
        occurredOn: award ? new Date(`${award}T00:00:00Z`) : new Date(now.toISOString().slice(0, 10) + "T00:00:00Z"),
        payload: r as unknown as Prisma.InputJsonValue,
      });
      matched++;
    }
    if (!list.length || page >= numPages) break;
  }
  return { key: SLICE_KEYS.links, rows, matched, unmatched, note: `award >= ${since}` };
}

async function syncEcpr(prisma: PrismaClient, session: DirSession, county: string, now: Date): Promise<SliceReport> {
  if (!(COUNTIES as readonly string[]).includes(county)) throw new Error(`Not a California county: ${county}`);
  const index = await firmIndex(prisma);
  const to = now;
  const from = new Date(now.getTime() - ECPR_WINDOW_DAYS * DAY);
  let rows = 0, matched = 0, unmatched = 0, capped = 0;
  // Start with one window; a capped answer splits it and tries again.
  const queue = ecprWindows(from, to, false);
  while (queue.length) {
    const w = queue.shift()!;
    const result = await searchEcpr(session, { ...w, county });
    if (result.capped) {
      const halves = ecprWindows(new Date(`${w.dateFrom}T00:00:00Z`), new Date(`${w.dateTo}T00:00:00Z`), true);
      if (halves.length > 1) { queue.unshift(...halves); continue; }
      capped++;
    }
    for (const r of result.rows) {
      rows++;
      const licence = index.get(nameKey(r.CONTRACTORNAME));
      if (!licence) { unmatched++; continue; }
      await insertSignal(prisma, signalFromEcpr(licence, r));
      matched++;
    }
  }
  return { key: SLICE_KEYS.ecpr(county), rows, matched, unmatched, note: capped ? `${capped} two-day window(s) still capped at 6,500` : undefined };
}

export type NewSignal = {
  licence: string;
  kind: "ECPR_FILING" | "PROJECT_LISTING";
  vendorKey: string;
  project: string;
  awardingBody: string | null;
  primeContractor: string | null;
  occurredOn: Date;
  payload: Prisma.InputJsonValue;
};

export function signalFromEcpr(licence: string, r: EcprRow): NewSignal {
  return {
    licence,
    kind: "ECPR_FILING",
    vendorKey: `ecpr:${r.IDPAYROLL_TRANSACTION}`,
    project: r.PROJECTNAME?.trim() || `DIR project ${r.PROJECTID}`,
    awardingBody: r.AWARDINGBODY?.trim() || null,
    primeContractor: null,
    occurredOn: new Date(`${r.SUBMISSIONDATE || r.END_DATE}T00:00:00Z`),
    payload: r as unknown as Prisma.InputJsonValue,
  };
}

/** Insert, and treat "already there" as done — DIR's key is unique. */
async function insertSignal(prisma: PrismaClient, s: NewSignal) {
  await prisma.publicWorksSignal.createMany({ data: s, skipDuplicates: true });
}

