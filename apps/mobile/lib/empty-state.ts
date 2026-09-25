import { t, type StringKey } from "./i18n";

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
 * typed per screen — and it is a KEY per screen rather than a sentence,
 * so the Spanish half of it cannot drift out of step (lib/i18n.ts). `offline-notes.test.ts` fails the build on a cached
 * list screen that writes its own.
 */
export function emptyFor(
  loadedFrom: string | "nothing" | null,
  /** The list, as it is named INSIDE the sentence: "the photos", "the
   * hours". A key rather than a string, because the sentence it lands in
   * is translated and half a translated sentence is worse than none. */
  thing: StringKey,
  whenEmpty: { title: StringKey; description?: StringKey },
): { emptyTitle: string; emptyDescription?: string } {
  if (loadedFrom === "nothing") {
    return {
      emptyTitle: t("offline.cantLoad", { thing: t(thing) }),
      emptyDescription: t("offline.cantLoad.body"),
    };
  }
  return {
    emptyTitle: t(whenEmpty.title),
    emptyDescription: whenEmpty.description ? t(whenEmpty.description) : undefined,
  };
}
