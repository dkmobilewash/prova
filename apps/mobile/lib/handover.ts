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
    };
  } catch {
    return null;
  }
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
