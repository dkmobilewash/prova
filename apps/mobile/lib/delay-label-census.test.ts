import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EN } from "./strings/en";

/**
 * THE PHONE'S WORD FOR EVERY DELAY ENUM, AND ONE FOR EVERY MEMBER.
 *
 * `app/reports/[jobId].tsx` carries three `[enumValue, stringKey]` tables —
 * CAUSES, PARTIES, METHODS. They drive the chips somebody taps AND, since
 * issue #484, the wording of a logged delay. That second job is why this file
 * exists: the row used to be drawn from the server's own `causeLabel`, which
 * is always English, while the optimistic row drawn on the tap used the
 * translated chip. On a Spanish phone a delay read `Retraso · Clima · GC` and
 * then, on sync, `Retraso · Weather · GC` — it changed language under the
 * person who had just typed it. Both halves now read the enum through these
 * tables, so a member missing from one is a delay nobody can word.
 *
 * WHAT THIS CAUGHT ON ITS FIRST RUN, which is the argument for having it:
 * `NotificationMethod` has SIX members and METHODS had FIVE. `OTHER` was
 * absent, so "Other" could not be recorded on the phone at all, and an OTHER
 * stored from the web would have rendered as the raw token once the row
 * started reading the enum. Counting the table against the schema found it in
 * a second; reading the table did not, three times.
 *
 * THE SHAPE OF THE CHECK follows CLAUDE.md's census rules, because a guard
 * that derives its own input has two failure modes and only one of them looks
 * like a failure:
 *
 *   - the SCHEMA is the source of truth, not the table — the database
 *     enforces what the migrations wrote, and the phone has to render
 *     whatever the API hands it;
 *   - every parse asserts it found something (an empty enum body or an empty
 *     table would make every comparison below pass vacuously);
 *   - the table count is asserted against the schema count as well as the
 *     membership, so a pattern that silently stops matching fails loudly
 *     instead of shrinking the set it compares.
 */

const root = join(__dirname, "..");
const SCREEN = join(root, "app/reports/[jobId].tsx");
const SCHEMA = join(root, "../../packages/db/prisma/schema/labor.prisma");

/** An enum body as the schema writes it. Anchored on the declaration and read
 * to the closing brace rather than matched across the whole file: a regex over
 * a whole schema is one formatting change from matching nothing. */
function schemaEnum(name: string): string[] {
  const schema = readFileSync(SCHEMA, "utf8");
  const start = schema.indexOf(`enum ${name} {`);
  expect(start, `no "enum ${name} {" in labor.prisma`).toBeGreaterThan(-1);
  const end = schema.indexOf("}", start);
  expect(end, `unterminated enum ${name}`).toBeGreaterThan(start);
  return schema
    .slice(start + `enum ${name} {`.length, end)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[A-Z][A-Z_]*$/.test(line));
}

/** The `[value, key]` pairs of one table in the screen. */
function table(name: string): [string, string][] {
  const source = readFileSync(SCREEN, "utf8");
  const start = source.indexOf(`const ${name} = [`);
  expect(start, `no "const ${name} = [" in the reports screen`).toBeGreaterThan(-1);
  const end = source.indexOf("] as const;", start);
  expect(end, `unterminated ${name}`).toBeGreaterThan(start);
  return [...source.slice(start, end).matchAll(/\["([A-Z_]+)",\s*"([^"]+)"\]/g)].map(
    (m) => [m[1], m[2]] as [string, string],
  );
}

const PAIRS: { table: string; enumName: string }[] = [
  { table: "CAUSES", enumName: "DelayCause" },
  { table: "PARTIES", enumName: "DelayResponsibleParty" },
  { table: "METHODS", enumName: "NotificationMethod" },
];

describe("the delay tables cover their schema enums", () => {
  it("reads a real schema and a real screen", () => {
    // Anti-vacuity before anything else. Nothing is ever missing from an empty
    // set, and nothing is ever mislabelled in one.
    for (const { enumName } of PAIRS) {
      expect(schemaEnum(enumName).length, `${enumName} parsed empty`).toBeGreaterThanOrEqual(5);
    }
    for (const { table: name } of PAIRS) {
      expect(table(name).length, `${name} parsed empty`).toBeGreaterThanOrEqual(5);
    }
  });

  for (const { table: name, enumName } of PAIRS) {
    it(`${name} has exactly the members ${enumName} declares`, () => {
      const members = schemaEnum(enumName);
      const rows = table(name);
      // The COUNT as well as the membership: if the pattern above ever stops
      // matching a row, this says "6 declared, 5 parsed" instead of quietly
      // comparing a shorter list.
      expect(rows.length, `${enumName} declares ${members.length} members, ${name} has ${rows.length} rows`).toBe(
        members.length,
      );
      expect(rows.map(([value]) => value).sort()).toEqual([...members].sort());
    });

    it(`${name} points every member at a string that exists`, () => {
      // A key with no entry renders as the key itself — "reports.method.other"
      // on screen, which is the failure this catches before a person sees it.
      // Spanish is covered by strings-census.test.ts, which requires the two
      // dictionaries to carry identical keys.
      for (const [value, key] of table(name)) {
        expect(Object.keys(EN), `${name}.${value} points at "${key}", which no dictionary has`).toContain(key);
      }
    });
  }
});

describe("the row is worded from the enum, not from the server's label", () => {
  const source = readFileSync(SCREEN, "utf8");

  it("does not read the server's English label fields", () => {
    // Issue #484. These are gone from `DelayRow` too, so this is belt and
    // braces — but the type could come back, and the render must not.
    expect(source).not.toMatch(/\bd\.causeLabel\b/);
    expect(source).not.toMatch(/\bd\.responsibleLabel\b/);
  });

  it("does not interpolate a raw enum into the GC-told sentence", () => {
    // It used to read `d.gcNotifiedHow.toLowerCase().replace("_", " ")`, which
    // put an English word in a Spanish sentence — "Se le avisó al GC por
    // phone" — and only rendered IN_PERSON readably by accident.
    expect(source).not.toMatch(/gcNotifiedHow\.toLowerCase\(\)/);
    expect(source).toMatch(/labelFor\(METHODS, d\.gcNotifiedHow, t\)/);
  });

  it("words both halves of the headline through the tables", () => {
    expect(source).toMatch(/labelFor\(CAUSES, d\.cause, t\)/);
    expect(source).toMatch(/labelFor\(PARTIES, d\.responsibleParty, t\)/);
  });
});
