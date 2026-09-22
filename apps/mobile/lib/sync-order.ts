/**
 * The order a screen does its two jobs in: READ what this phone knows,
 * and SEND what it is holding. They are not equally urgent, and for three
 * rounds of testing on a real phone they were in the wrong order.
 *
 * Every screen that queues writes used one shape:
 *
 *     const token = await getToken();      // offline: up to 4s now, 162s before
 *     if (token) await flushQueue(token);  // offline: every op fails, in order
 *     await refresh();                     // ← the list, and its "no connection" note
 *
 * So the list a foreman is standing there looking at was behind a token
 * fetch and a queue flush that exist to talk to a server that is not
 * answering. On 2026-09-20, with no signal, Home and the read-only
 * screens showed "Showing what this phone last loaded — no connection"
 * and the seven queue-backed screens — punch list, field reports, time,
 * photos, materials, safety, T&M — showed nothing at all. Same cache,
 * same note, same code: they were simply still waiting. And a flush that
 * is ALREADY in flight is awaited rather than started, so one slow upload
 * blocks every one of those screens at once.
 *
 * THE RULE, and it is worth stating as a rule because it keeps being
 * broken by reasonable-looking code: **the read never waits on the
 * write.** Refreshing is local-first and answers in milliseconds from the
 * cache; flushing is a network round trip per queued op. The only thing
 * the flush earns is a SECOND refresh afterwards, replacing optimistic
 * rows with the server's.
 *
 * Kept as a plain function rather than living in the hook so the ordering
 * itself is testable — sync-order.test.ts pins it with a flush that never
 * resolves, which is exactly the device case nobody could reproduce.
 */
export type SyncSteps = {
  /** Re-read the screen's list — cache-first, never blocking on network. */
  refresh: () => Promise<void>;
  /** Send whatever is queued. Resolves, rejects or hangs; none of that may
   * reach the refresh above. */
  flush: () => Promise<boolean>;
  /** Re-read the pending/refused counters that the screen shows. */
  counters: () => Promise<void>;
};

export async function syncOnce({ refresh, flush, counters }: SyncSteps): Promise<void> {
  // FIRST, and not awaited before the rest is set up: whatever the phone
  // already knows is on screen before anything is attempted over the wire.
  const reading = refresh().catch(() => {});
  await counters();
  await reading;

  const sent = await flush().catch(() => false);
  if (!sent) return;

  // Something actually went up, so what is on screen is now behind the
  // server: read it again, and update the counters the write changed.
  await counters();
  await refresh().catch(() => {});
}
