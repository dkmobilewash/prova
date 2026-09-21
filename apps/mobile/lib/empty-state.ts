/**
 * What a list says when it has nothing to show — and the distinction the
 * whole offline layer exists for.
 *
 * "There is nothing here" and "I could not find out" are different
 * sentences, and on a jobsite the first one is a CLAIM: "Nothing
 * outstanding on this job." read as a clean punch list to a foreman
 * standing in front of a wall that is not. That exact sentence was
 * reported from site on 2026-09-20 and fixed on the punch list, the
 * drawings and the schedule — and six other screens went on saying "No
 * photos yet", "No time logged", "Nothing on order", "No T&M tickets",
 * "No reports yet" and "No jobs yet" when the truth was that this phone
 * had never loaded them and could not now.
 *
 * So the sentence is derived from the load, in one place, rather than
 * typed per screen. `offline-notes.test.ts` fails the build on a cached
 * list screen that writes its own.
 */
export function emptyFor(
  loadedFrom: string | "nothing" | null,
  /** The thing, named the way the screen names it: "the photos", "the
   * day's hours". Reads as "Can't load the photos right now." */
  thing: string,
  whenEmpty: { title: string; description?: string },
): { emptyTitle: string; emptyDescription?: string } {
  if (loadedFrom === "nothing") {
    return {
      emptyTitle: `Can't load ${thing} right now.`,
      emptyDescription:
        "No connection, and this phone hasn't loaded this before. Anything you add is kept and sent when you're back in range.",
    };
  }
  return { emptyTitle: whenEmpty.title, emptyDescription: whenEmpty.description };
}
