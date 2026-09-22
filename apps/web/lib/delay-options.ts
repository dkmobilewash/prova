import type { DelayCause, DelayResponsibleParty, NotificationMethod } from "@prova/db";

/**
 * The delay pickers' option lists and their label lookups — and NOTHING that
 * touches the database.
 *
 * They were in `delays-core.ts` until 2026-09-21, which opens with
 * `import { prisma } from "@prova/db"`. `PunchItemFields.tsx` is a "use
 * client" component and imports `RESPONSIBLE_PARTIES` from there, so the
 * bundler pulled the whole module — and PrismaClient with it — into the
 * browser bundle for /punch-lists. Evaluating it there throws
 * "PrismaClient is unable to run in this browser environment", which the
 * error boundary renders as "This page didn't load". The SERVER render was
 * fine the whole time, which is why nothing in the server log said so.
 *
 * The import above is `import type`, and that is the load-bearing word: a
 * type import is erased before bundling, so naming `@prova/db` here costs
 * the browser nothing. A value import of the same module would put this file
 * straight back where it came from.
 *
 * `delays-core.ts` re-exports all of this, so every server call site is
 * unchanged. A client component must import from HERE.
 * `client-prisma-boundary.test.ts` fails the build if one stops.
 */

export const DELAY_CAUSES: { value: DelayCause; label: string }[] = [
  { value: "WEATHER", label: "Weather" },
  { value: "GC_SCHEDULE", label: "GC schedule / sequencing" },
  { value: "OTHER_TRADE", label: "Another trade in the way" },
  { value: "MATERIAL", label: "Material late or wrong" },
  { value: "INSPECTION", label: "Inspection" },
  { value: "DESIGN_RFI", label: "Design question / RFI" },
  { value: "SITE_ACCESS", label: "Site access" },
  { value: "EQUIPMENT", label: "Equipment" },
  { value: "OTHER", label: "Other" },
];

export const RESPONSIBLE_PARTIES: { value: DelayResponsibleParty; label: string }[] = [
  { value: "GC", label: "GC" },
  { value: "OWNER", label: "Owner" },
  { value: "OTHER_TRADE", label: "Another trade" },
  { value: "SUPPLIER", label: "Supplier" },
  { value: "OURSELVES", label: "Us" },
  { value: "NOBODY", label: "Nobody (weather, act of God)" },
];

export const NOTIFICATION_METHODS: { value: NotificationMethod; label: string }[] = [
  { value: "PHONE", label: "Phone" },
  { value: "EMAIL", label: "Email" },
  { value: "TEXT", label: "Text" },
  { value: "IN_PERSON", label: "In person" },
  { value: "MEETING", label: "Meeting" },
  { value: "OTHER", label: "Other" },
];

export const causeLabel = (c: string) => DELAY_CAUSES.find((x) => x.value === c)?.label ?? c;
export const partyLabel = (p: string) => RESPONSIBLE_PARTIES.find((x) => x.value === p)?.label ?? p;
export const methodLabel = (m: string) => NOTIFICATION_METHODS.find((x) => x.value === m)?.label ?? m;
