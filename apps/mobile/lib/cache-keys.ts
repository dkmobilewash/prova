/**
 * Every cache key the app uses, in one place.
 *
 * The keys matter more than they look: a SCREEN writes one when it loads
 * and reads it when there is no signal, and the PREFETCH writes the same
 * ones ahead of time so arriving on site with no bars still shows the
 * day's work. Those two agreeing is the whole feature — a prefetch that
 * fills `punchlist.<id>` while the screen reads `punch-list.<id>` is a
 * feature that silently does nothing, and both halves look correct in
 * review.
 *
 * `cache-parity.test.ts` asserts that what the prefetch writes is exactly
 * what the screens read, so that disagreement fails the build instead of
 * failing in a basement.
 */
export const cacheKeys = {
  jobs: () => "jobs",
  /** Who this phone is signed in as, and what they may do. Cached like
   * every other read: the shell has to be right in a basement too. */
  me: () => "me",
  punchList: (jobId: string) => `punch-list.${jobId}`,
  reports: (jobId: string) => `reports.${jobId}`,
  photos: (jobId: string) => `photos.${jobId}`,
  time: (jobId: string) => `time.${jobId}`,
  materials: (jobId: string) => `materials.${jobId}`,
  safety: (jobId: string) => `safety.${jobId}`,
  tickets: (jobId: string) => `tickets.${jobId}`,
  drawings: (jobId: string) => `drawings.${jobId}`,
  schedule: (jobId: string) => `schedule.${jobId}`,
} as const;

/** The per-job sections the prefetch fills. `jobs` is not here: it is not
 * about one job, and it is refreshed by opening the Jobs tab. */
export const JOB_SECTION_KEYS = [
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
