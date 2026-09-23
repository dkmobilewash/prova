import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * The job this phone is on.
 *
 * A foreman works one job all day, occasionally two. Before this, every
 * screen took a `jobId` from the route and the app had no idea which job
 * you were on the moment you left it — which is why Create and Camera
 * could not exist as tabs: they had nothing to act on.
 *
 * Kept on the device rather than in memory, because the answer has to
 * survive the app being killed in a truck and reopened on a roof. It is
 * also a CACHE OF A CHOICE, not a source of truth about the job: the name
 * and status are what to draw in the header immediately, and the real job
 * data is still fetched by whatever screen needs it.
 */

const KEY = "prova.current-job";

export type CurrentJob = { id: string; name: string; status: string | null };

export async function getCurrentJob(): Promise<CurrentJob | null> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CurrentJob>;
    // A half-written or older-shaped entry is treated as "no job chosen"
    // rather than rendered: a header reading "undefined" is worse than a
    // header asking you to pick.
    if (!parsed || typeof parsed.id !== "string" || !parsed.id) return null;
    return { id: parsed.id, name: typeof parsed.name === "string" ? parsed.name : "Job", status: parsed.status ?? null };
  } catch {
    return null;
  }
}

/**
 * Everyone currently showing the job, so a change reaches them at once.
 *
 * Reading on FOCUS alone is not enough, and the gap is not cosmetic. The
 * capture sheet takes its job from the tab LAYOUT, which never loses
 * focus while you move between tabs — so after "Leave <job>" the sheet
 * kept offering Photo, Field report and Time against the job the phone
 * had just left, and a tap would have filed work against it. Found on a
 * phone during #427's click-list; no test could see it, because the two
 * stale readers were two different components agreeing with each other.
 *
 * A module-level set rather than a context: `setCurrentJob` is called
 * from row handlers deep in screens that have no provider above them.
 */
const listeners = new Set<() => void>();

export function onCurrentJobChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function announce(): void {
  for (const listener of [...listeners]) listener();
}

export async function setCurrentJob(job: CurrentJob): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(job));
  announce();
}

export async function clearCurrentJob(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
  announce();
}
