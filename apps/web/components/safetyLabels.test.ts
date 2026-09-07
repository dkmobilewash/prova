import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INCIDENT_OUTCOMES, isRecordable } from "@/components/safetyLabels";

/**
 * `isRecordable` decides two different things: how the log renders a case,
 * and — since the delete guard — whether that case can be removed at all.
 * The second use is what makes the fallback below dangerous.
 */
describe("isRecordable, as a delete guard", () => {
  /** Every member of the IncidentOutcome enum, READ OUT OF THE SCHEMA.
   *
   * This list used to be typed out in this file, with a comment saying that
   * was "the whole point". It was the opposite: a hand-written copy of the
   * enum notices nothing, because adding a member to the schema does not
   * touch this file, so the guard stayed green through exactly the change
   * it was written to catch. Issue #150 item 2 — and the fifth instance in
   * this repo of a test whose fixture cannot reach its own condition.
   *
   * The schema is the source of truth: it generates the Prisma client AND
   * the Postgres type, so a value that can arrive in `outcome` is a value
   * that appears here. Read from the directory rather than from one named
   * file so moving the enum between .prisma files cannot quietly empty it,
   * and asserted non-empty below so a rename fails loudly instead of
   * looping over nothing.
   */
  const SCHEMA_DIR = join(__dirname, "../../../packages/db/prisma/schema");

  function enumMembers(name: string): string[] {
    const text = readdirSync(SCHEMA_DIR)
      .filter((f) => f.endsWith(".prisma"))
      .map((f) => readFileSync(join(SCHEMA_DIR, f), "utf8"))
      .join("\n");
    // `enum Name {` through the first closing brace. Prisma enum bodies are
    // one bare identifier per line; comments start with `//` or `///`.
    const block = new RegExp(`^enum\\s+${name}\\s*\\{([^}]*)\\}`, "m").exec(text);
    if (!block) return [];
    return block[1]
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("//"))
      .map((line) => line.split(/\s+/)[0]);
  }

  const SCHEMA_OUTCOMES = enumMembers("IncidentOutcome");

  it("finds the enum it claims to be guarding", () => {
    // Without this, a renamed enum makes every loop below iterate an empty
    // list and the file passes while checking nothing — the failure mode
    // that put this test in an issue in the first place.
    expect(SCHEMA_OUTCOMES.length).toBeGreaterThan(1);
    expect(SCHEMA_OUTCOMES).toContain("FIRST_AID_ONLY");
  });

  it("classifies every outcome the schema can store", () => {
    // `isRecordable` ends in `?? false`, so an outcome missing from
    // INCIDENT_OUTCOMES reads as NOT recordable — which now means "this
    // OSHA case may be deleted". A new enum member that nobody adds to the
    // label map would silently become the one deletable kind of recordable
    // case. Adding one to the schema now fails HERE, which is the only
    // reason this test exists.
    const known = INCIDENT_OUTCOMES.map((o) => o.value);
    for (const outcome of SCHEMA_OUTCOMES) {
      expect(known).toContain(outcome);
    }
  });

  it("carries no label for an outcome the schema cannot store", () => {
    // The other direction, and cheap: a value left in the label map after
    // the schema dropped it puts a dead option in the form's dropdown.
    for (const known of INCIDENT_OUTCOMES.map((o) => o.value)) {
      expect(SCHEMA_OUTCOMES).toContain(known);
    }
  });

  it("treats first aid as the only removable outcome", () => {
    expect(isRecordable("FIRST_AID_ONLY")).toBe(false);
    const recordable = SCHEMA_OUTCOMES.filter((o) => o !== "FIRST_AID_ONLY");
    expect(recordable.length).toBeGreaterThan(0);
    for (const outcome of recordable) {
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
