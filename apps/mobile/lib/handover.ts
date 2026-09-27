import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * The phone, in somebody else's hands.
 *
 * Most hangers and tapers do not carry a company phone (the teardown's
 * C15/D-13). Their hours are therefore typed by a foreman from memory at
 * the end of the day, which is how a day gets rounded, mis-remembered, or
 * argued about on Friday. The alternative everybody reaches for — each
 * worker signing into their own account on a borrowed phone — means
 * typing a password into a co-worker's device, over a network that is
 * often not there. Not that.
 *
 * So: the FOREMAN stays signed in, hands the phone across, and while it
 * is in the crew member's hands the app is exactly one thing — their own
 * hours for today, and their signature. Nothing else is reachable. When
 * they hand it back, it returns to the foreman's app.
 *
 * KEPT ON DISK, not in memory, and that is the part worth arguing about:
 * state in React would be escaped by force-quitting the app, which is
 * precisely what someone would do to get out of a screen they did not
 * want to be in. Relaunching lands back in the handover instead
 * (app/_layout.tsx reads this before it renders the tabs).
 *
 * `pin` is optional and does exactly what it says: without one, handing
 * back is a two-step confirm and anyone holding the phone can do it —
 * the protection is that the foreman is standing there. With one, the
 * phone does not come back until the foreman types it. It is a lock on a
 * screen, not a security boundary: it is stored in the clear beside the
 * flag, and the signed-in session on the device is the foreman's either
 * way.
 */

const KEY = "prova.handover";

/**
 * One set of hours this handover has already put in the queue.
 *
 * WHY THE RECEIPT LIVES BESIDE THE FLAG (issue #482). The hours were held in
 * React state, so force-quitting the app — which this module exists to survive,
 * and which somebody wanting out of this screen will do — lost every row from
 * the screen while the QUEUE still held them. `Sign and finish` is disabled
 * until at least one row exists, so the only thing the screen then offered was
 * entering the hours again: a SECOND `time:create` with a fresh
 * `clientOperationId`, and a duplicate day's pay on the one screen whose whole
 * purpose is that the hours are right.
 *
 * READING THE PENDING QUEUE BACK IS NOT ENOUGH, and that is worth writing down
 * because it is the obvious fix and the issue proposed it. `useQueueDrain`
 * flushes every 20 seconds while the app is foregrounded, with no exclusion for
 * a handover — so on a phone WITH signal the op is gone from the queue within
 * seconds of being written, and a relaunch would find nothing there. The
 * offline case would be fixed and the online case would not, which is the worse
 * half to leave: a basement is where the queue is visibly doing its job, and a
 * yard with signal is where it looks like nothing happened.
 *
 * `clientOperationId` is carried so a reader can tell whether a row is still
 * waiting to go up, and so nothing here can be mistaken for a second entry.
 */
export type HandoverEntry = {
  clientOperationId: string;
  hours: string;
  /** When the phone accepted it, for ordering. Not what the entry is FOR — the
   * TimeEntry carries its own entered date. */
  at: string;
};

export type Handover = {
  crewMemberId: string;
  /** Shown on every screen of the handover, so nobody logs eight hours
   * against the wrong name. */
  name: string;
  jobId: string;
  jobName: string;
  startedAt: string;
  /** Four digits, or absent. See the note above about what this is. */
  pin?: string;
  /** Absent on a handover opened before #482, and on one where nothing has
   * been entered yet. Read it as `?? []`. */
  entries?: HandoverEntry[];
};

export async function getHandover(): Promise<Handover | null> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Handover>;
    if (!parsed || typeof parsed.crewMemberId !== "string" || !parsed.crewMemberId) return null;
    if (typeof parsed.jobId !== "string" || !parsed.jobId) return null;
    return {
      crewMemberId: parsed.crewMemberId,
      name: typeof parsed.name === "string" && parsed.name ? parsed.name : "This crew member",
      jobId: parsed.jobId,
      jobName: typeof parsed.jobName === "string" && parsed.jobName ? parsed.jobName : "this job",
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : new Date().toISOString(),
      pin: typeof parsed.pin === "string" && /^\d{4}$/.test(parsed.pin) ? parsed.pin : undefined,
      // CARRIED THROUGH, and this line is the fix as much as the writer below
      // is: this function rebuilds the record field by field, so a new field
      // that is not named here is silently dropped on every read — the receipt
      // would be written, never come back, and #482 would look fixed.
      //
      // A malformed row is DROPPED rather than failing the whole parse. Losing
      // one receipt line costs a re-entry; failing the parse returns null,
      // which `app/_layout.tsx` reads as "no handover open" and would unlock
      // the foreman's whole app to whoever is holding the phone.
      entries: Array.isArray(parsed.entries) ? parsed.entries.filter(isEntry) : undefined,
    };
  } catch {
    return null;
  }
}

function isEntry(value: unknown): value is HandoverEntry {
  if (!value || typeof value !== "object") return false;
  const e = value as Partial<HandoverEntry>;
  return (
    typeof e.clientOperationId === "string" &&
    e.clientOperationId.length > 0 &&
    typeof e.hours === "string" &&
    e.hours.length > 0 &&
    typeof e.at === "string"
  );
}

/**
 * Records that this handover has put one set of hours in the queue, and
 * returns the whole list so a caller renders what is on disk rather than what
 * it hoped it wrote.
 *
 * DEDUPED ON `clientOperationId`, which costs one comparison and means a
 * double-tap or a retried write cannot make one entry look like two — on a
 * screen where two rows reading "8 hours" is the exact thing being prevented.
 *
 * Returns `[]` if the handover ended underneath it. That is not an error worth
 * surfacing: the phone is back with the foreman and this screen is gone.
 */
export async function recordHandoverEntry(entry: HandoverEntry): Promise<HandoverEntry[]> {
  const open = await getHandover();
  if (!open) return [];
  const existing = open.entries ?? [];
  if (existing.some((e) => e.clientOperationId === entry.clientOperationId)) return existing;
  const entries = [...existing, entry];
  await AsyncStorage.setItem(KEY, JSON.stringify({ ...open, entries }));
  return entries;
}

export async function startHandover(handover: Omit<Handover, "startedAt">): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify({ ...handover, startedAt: new Date().toISOString() }));
}

export async function endHandover(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}

/** Whether this attempt to hand the phone back is allowed through.
 * No PIN set: yes, and the confirm step is the whole of it. */
export function pinAccepted(handover: Handover, typed: string): boolean {
  if (!handover.pin) return true;
  return typed === handover.pin;
}

export function isValidPin(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}
