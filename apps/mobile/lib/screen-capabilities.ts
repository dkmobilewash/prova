import type { StringKey } from "./i18n";
import type { Capability } from "./types";

/**
 * Which capability each screen on this phone needs — and it is not a
 * second opinion, it is a copy of what the API route behind that screen
 * already asserts.
 *
 * `screen-capabilities.test.ts` derives the right-hand side from the
 * route files in apps/web and fails when the two disagree, so this table
 * cannot drift into being the phone's own idea of permissions. The point
 * of having it at all is that a phone cannot ask "would this 403?"
 * without making the request — it needs to know BEFORE it draws a tab.
 *
 * The screens that are not here need nothing beyond being signed in: the
 * jobs list, the outbox, settings, the handover.
 */
export const SCREEN_CAPABILITY = {
  "reports/[jobId]": "MANAGE_FIELD",
  "photos/[jobId]": "MANAGE_FIELD",
  "punch-list/[jobId]": "MANAGE_FIELD",
  "time/[jobId]": "MANAGE_FIELD",
  "materials/[jobId]": "MANAGE_FIELD",
  "safety/[jobId]": "MANAGE_FIELD",
  "ticket/[jobId]": "MANAGE_FIELD",
  "schedule/[jobId]": "MANAGE_FIELD",
  "drawings/[jobId]": "MANAGE_JOBS",
} as const satisfies Record<string, Capability>;

export type GuardedScreen = keyof typeof SCREEN_CAPABILITY;

/** The API route each screen's list comes from, as a path under
 * `apps/web/app/api/v1/`. Used by the census to read the capability the
 * SERVER asserts rather than trusting the table above. */
export const SCREEN_ROUTE: Record<GuardedScreen, string> = {
  "reports/[jobId]": "field-reports/route.ts",
  "photos/[jobId]": "jobs/[id]/media/route.ts",
  "punch-list/[jobId]": "jobs/[id]/punch-list/route.ts",
  "time/[jobId]": "jobs/[id]/time-entries/route.ts",
  "materials/[jobId]": "jobs/[id]/material-orders/route.ts",
  "safety/[jobId]": "jobs/[id]/toolbox-talks/route.ts",
  "ticket/[jobId]": "jobs/[id]/tickets/route.ts",
  "schedule/[jobId]": "jobs/[id]/schedule/route.ts",
  "drawings/[jobId]": "jobs/[id]/drawings/route.ts",
};

/**
 * What each guarded screen is called in the sentence that explains why it
 * is not there: "Field reports aren't part of your job function."
 *
 * A KEY rather than the noun itself, for the same reason `emptyFor` takes
 * one (lib/empty-state.ts): the sentence around it is translated, and a
 * Spanish refusal naming an English screen is half a sentence. The type is
 * what proves each one exists — `StringKey` is `keyof typeof EN`, so a
 * noun that is not in the dictionary fails the build here rather than
 * rendering its own key to somebody who cannot read the screen anyway.
 *
 * Imported as a TYPE so this module stays pure: nothing here calls `t`,
 * and `NotYourJobFunction` — which re-renders on a language change —
 * translates the noun at the point it draws it.
 */
export const SCREEN_NOUN: Record<GuardedScreen, StringKey> = {
  "reports/[jobId]": "notYourJob.noun.reports",
  "photos/[jobId]": "notYourJob.noun.photos",
  "punch-list/[jobId]": "notYourJob.noun.punch",
  "time/[jobId]": "notYourJob.noun.time",
  "materials/[jobId]": "notYourJob.noun.materials",
  "safety/[jobId]": "notYourJob.noun.safety",
  "ticket/[jobId]": "notYourJob.noun.tickets",
  "schedule/[jobId]": "notYourJob.noun.schedule",
  "drawings/[jobId]": "notYourJob.noun.drawings",
};
