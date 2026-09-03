import { describe, expect, it } from "vitest";
import { INCIDENT_OUTCOMES, isRecordable } from "@/components/safetyLabels";

/**
 * `isRecordable` decides two different things: how the log renders a case,
 * and — since the delete guard — whether that case can be removed at all.
 * The second use is what makes the fallback below dangerous.
 */
describe("isRecordable, as a delete guard", () => {
  /** Every member of the IncidentOutcome enum in the Prisma schema. Kept
   * here literally rather than imported, because that is the whole point:
   * if somebody adds an outcome to the schema and not to INCIDENT_OUTCOMES,
   * this list is what notices. */
  const SCHEMA_OUTCOMES = [
    "DEATH",
    "DAYS_AWAY",
    "RESTRICTED_OR_TRANSFER",
    "OTHER_RECORDABLE",
    "FIRST_AID_ONLY",
  ] as const;

  it("classifies every outcome the schema can store", () => {
    // `isRecordable` ends in `?? false`, so an outcome missing from
    // INCIDENT_OUTCOMES reads as NOT recordable — which now means "this
    // OSHA case may be deleted". A new enum member that nobody adds here
    // would silently become the one deletable kind of recordable case.
    const known = INCIDENT_OUTCOMES.map((o) => o.value);
    for (const outcome of SCHEMA_OUTCOMES) {
      expect(known).toContain(outcome);
    }
  });

  it("treats first aid as the only removable outcome", () => {
    expect(isRecordable("FIRST_AID_ONLY")).toBe(false);
    for (const outcome of SCHEMA_OUTCOMES.filter((o) => o !== "FIRST_AID_ONLY")) {
      expect(isRecordable(outcome)).toBe(true);
    }
  });

  it("refuses to guess about a value it does not know", () => {
    // Documents the fallback rather than endorsing it: an unrecognised
    // string is treated as not recordable, which is why the test above
    // exists to keep the list complete.
    expect(isRecordable("SOMETHING_NEW")).toBe(false);
  });
});
