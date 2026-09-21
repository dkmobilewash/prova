import * as api from "./api";
import { cacheKeys } from "./cache-keys";
import { cacheSet } from "./offline-cache";
import { holds } from "./capabilities";
import type { Capability, Me } from "./types";

/**
 * Fills the cache for a job WHILE there is still signal.
 *
 * The cache a screen writes when you open it only helps if you opened it
 * before you lost signal, which is not how a day goes: the phone is in a
 * pocket on the drive over and out of the pocket in a basement. So while
 * the app is open and online it quietly keeps the current job's sections
 * fresh, and arriving with no bars still shows today's work.
 *
 * Deliberately NOT a sync engine. It writes the same keys the screens
 * read (`cache-parity.test.ts` proves that), it never merges, and the
 * next successful screen load overwrites whatever it put there. Photos
 * are METADATA only — the rows, not the images — because a job's photos
 * are tens of megabytes and this runs on somebody's cellular plan.
 *
 * A section that fails is skipped rather than failing the batch: losing
 * signal halfway through is the normal case, and the sections that did
 * land are worth keeping.
 */
export async function prefetchJob(jobId: string, token: string, me: Me | null = null): Promise<number> {
  // Only what this person is allowed to read. Without this, a bookkeeper's
  // phone would spend a cellular round trip per section collecting 403s,
  // and cache "nothing" against keys their screens will never open.
  const may = (capability: Capability) => holds(me, capability);
  const sections: [string, () => Promise<unknown>][] = [
    [cacheKeys.punchList(jobId), () => api.listPunchListItems(jobId, token)],
    [cacheKeys.reports(jobId), () => api.listFieldReports(jobId, token)],
    [cacheKeys.photos(jobId), () => api.listMedia(jobId, token)],
    [cacheKeys.time(jobId), () => api.listTimeEntries(jobId, token)],
    [cacheKeys.materials(jobId), async () => ({
      orders: await api.listMaterialOrders(jobId, token),
      vendors: await api.listVendors(token),
    })],
    [cacheKeys.safety(jobId), async () => ({
      talks: await api.listToolboxTalks(jobId, token),
      incidents: await api.listIncidents(jobId, token),
    })],
    [cacheKeys.tickets(jobId), () => api.listTmTickets(jobId, token)],
    // Drawings and the schedule are READ-ONLY and are exactly what a
    // phone is opened for once signal has gone: which revision governs,
    // and who is on site tomorrow.
    [cacheKeys.drawings(jobId), () => api.listDrawings(jobId, token)],
    [cacheKeys.schedule(jobId), () => api.listSchedule(jobId, token)],
  ];

  let filled = 0;
  for (const [key, read] of sections) {
    if (!may(key.startsWith("drawings") ? "MANAGE_JOBS" : "MANAGE_FIELD")) continue;
    try {
      await cacheSet(key, await read());
      filled += 1;
    } catch {
      // No signal, or that one endpoint is unhappy. Whatever landed
      // before it stays; the rest is the next pass's problem.
    }
  }
  return filled;
}

/** The keys `prefetchJob` fills, for the parity test. Derived from the
 * same list the function uses would be better still, but the function
 * needs a token to build it — so the test asserts these against the
 * screens AND against the section list above. */
export const PREFETCHED_KEYS = [
  cacheKeys.punchList,
  cacheKeys.reports,
  cacheKeys.photos,
  cacheKeys.time,
  cacheKeys.materials,
  cacheKeys.safety,
  cacheKeys.tickets,
  cacheKeys.drawings,
  cacheKeys.schedule,
] as const;
