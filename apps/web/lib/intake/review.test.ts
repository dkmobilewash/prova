import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  INTAKE_KINDS,
  INTAKE_KIND_LABELS,
  countIntake,
  intakeSummarySentence,
  reviewRank,
  sortForReview,
} from "./review";

/**
 * What the review screen puts in front of a person, and in what order.
 *
 * The ordering is the whole product claim of `/intake`: a tray of 80 files
 * is only useful if the ones the machine is unsure about are the ones you
 * read first. Sorted the other way round — highest confidence at the top,
 * which is what a naive `orderBy: createdAt` or a confidence enum sorted
 * alphabetically both give you — the person scrolls past 62 correct rows
 * to reach the 4 that need them, and on camera that is indistinguishable
 * from the product not working.
 */

const row = (
  proposedKind: string,
  proposedConfidence: string,
  fileName = `${proposedKind}-${proposedConfidence}.pdf`,
) => ({ proposedKind, proposedConfidence, fileName, status: "PROPOSED" }) as const;

describe("the review order", () => {
  it("puts what we could not place above everything else", () => {
    // UNKNOWN is first regardless of how confident the classifier was
    // about being unable to place it. "Confidently unplaceable" is still
    // the row a person has to deal with by hand.
    const sorted = sortForReview([
      row("SUBMITTAL", "HIGH"),
      row("UNKNOWN", "HIGH"),
      row("DRAWING", "LOW"),
    ]);
    expect(sorted.map((r) => r.proposedKind)).toEqual(["UNKNOWN", "DRAWING", "SUBMITTAL"]);
  });

  it("ranks low confidence above medium, and medium above high", () => {
    const sorted = sortForReview([
      row("DRAWING", "HIGH"),
      row("SUBMITTAL", "MEDIUM"),
      row("PAY_APP", "LOW"),
    ]);
    expect(sorted.map((r) => r.proposedConfidence)).toEqual(["LOW", "MEDIUM", "HIGH"]);
  });

  it("breaks a tie by filename so the order is stable between renders", () => {
    // Two rows of the same rank must not swap places when the page
    // re-renders after a confirm — a row moving under the cursor is how
    // somebody files the wrong document.
    const sorted = sortForReview([
      row("DRAWING", "HIGH", "b.pdf"),
      row("SUBMITTAL", "HIGH", "a.pdf"),
    ]);
    expect(sorted.map((r) => r.fileName)).toEqual(["a.pdf", "b.pdf"]);
  });

  it("does not mutate the array it was given", () => {
    const rows = [row("SUBMITTAL", "HIGH"), row("UNKNOWN", "LOW")];
    const before = rows.map((r) => r.proposedKind);
    sortForReview(rows);
    expect(rows.map((r) => r.proposedKind)).toEqual(before);
  });

  it("ranks an unrecognised confidence as uncertain rather than certain", () => {
    // A value this build does not know about must sort UP, not down. The
    // failure mode that matters here is a row a person never looks at.
    expect(reviewRank(row("DRAWING", "SOMETHING_NEWER"))).toBeLessThan(
      reviewRank(row("DRAWING", "HIGH")),
    );
  });
});

describe("the counts at the top", () => {
  const rows = [
    ...Array.from({ length: 5 }, () => row("SUBMITTAL", "HIGH")),
    ...Array.from({ length: 3 }, () => row("DRAWING", "MEDIUM")),
    row("PAY_APP", "LOW"),
    row("UNKNOWN", "LOW"),
    row("UNKNOWN", "HIGH"),
    { ...row("SUBMITTAL", "HIGH"), status: "FILED" },
    { ...row("SUBMITTAL", "HIGH"), status: "DISMISSED" },
  ];

  it("counts ready, needs-a-look and could-not-place over the tray only", () => {
    // A filed or dismissed row has left the tray. Counting it again is how
    // a number on screen stops matching the rows underneath it.
    expect(countIntake(rows)).toEqual({
      readyToFile: 5,
      needALook: 4,
      couldNotPlace: 2,
      filed: 1,
      dismissed: 1,
    });
  });

  it("never counts an UNKNOWN row as ready to file", () => {
    // The product promise: UNKNOWN waits for a person, whatever the
    // classifier's confidence was.
    const counts = countIntake([row("UNKNOWN", "HIGH")]);
    expect(counts.readyToFile).toBe(0);
    expect(counts.couldNotPlace).toBe(1);
  });

  it("writes the sentence the demo reads off the screen", () => {
    expect(intakeSummarySentence(countIntake(rows))).toBe(
      "5 ready to file, 4 need a look, 2 we couldn't place",
    );
  });

  it("says so plainly when the tray is empty", () => {
    expect(
      intakeSummarySentence({
        readyToFile: 0,
        needALook: 0,
        couldNotPlace: 0,
        filed: 0,
        dismissed: 0,
      }),
    ).toBe("Nothing waiting");
  });

  it("uses the singular for one of anything", () => {
    expect(
      intakeSummarySentence({
        readyToFile: 1,
        needALook: 1,
        couldNotPlace: 1,
        filed: 0,
        dismissed: 0,
      }),
    ).toBe("1 ready to file, 1 needs a look, 1 we couldn't place");
  });
});

/* ------------------------------------------------------------------ *
 * The three lists of kinds that must never disagree
 * ------------------------------------------------------------------ */

/**
 * The same ten strings are written down in four places, and all four are
 * load-bearing in a different way:
 *
 *   - `INTAKE_KINDS` here — what the override dropdown offers;
 *   - `IntakeKind` in classify.ts — what the classifier may return, and it
 *     is written by a different person than this file;
 *   - `enum DocumentIntakeKind` in the Prisma schema — what the client
 *     will accept as a value;
 *   - `CREATE TYPE ... AS ENUM` in the migration — what the DATABASE
 *     actually holds, which is the only one of the four that can refuse a
 *     write at two in the afternoon in front of a camera.
 *
 * A dropdown offering a value the database does not have is not a typecheck
 * failure and not a lint failure: it is a 500 on the confirm button, on the
 * one row somebody overrode by hand.
 *
 * EACH LIST IS DERIVED BY A PATTERN, WHICH MEANS EACH ONE CAN COME BACK
 * EMPTY — and an empty list agrees with everything. So every parse below is
 * required to return exactly `INTAKE_KINDS.length` entries, and that length
 * is asserted against a literal. A pattern that matches nothing fails here
 * rather than passing three comparisons against the void. Same rule as
 * scratch-cleanup-order.test.ts, which paid for it.
 */

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const read = (path: string) => readFileSync(`${repoRoot}${path}`, "utf8");

/** The quoted strings inside `export type IntakeKind = | "A" | "B";` */
function classifyKinds(): string[] {
  const source = read("apps/web/lib/intake/classify.ts");
  const block = /export type IntakeKind\s*=([\s\S]*?);/.exec(source);
  if (!block) return [];
  return [...block[1].matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
}

/** The members of `enum DocumentIntakeKind { … }` in the Prisma schema. */
function schemaKinds(): string[] {
  const source = read("packages/db/prisma/schema/intake.prisma");
  const block = /enum DocumentIntakeKind\s*\{([\s\S]*?)\}/.exec(source);
  if (!block) return [];
  return [...block[1].matchAll(/^\s*([A-Z][A-Z_]*)\s*$/gm)].map((m) => m[1]);
}

/** The values in the migration's `CREATE TYPE … AS ENUM (…)`. */
function migrationKinds(): string[] {
  const source = read(
    "packages/db/prisma/schema/migrations/20260913120000_add_document_intake/migration.sql",
  );
  const block = /CREATE TYPE "DocumentIntakeKind" AS ENUM \(([^)]*)\)/.exec(source);
  if (!block) return [];
  return [...block[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
}

describe("the kinds agree everywhere they are written down", () => {
  it("has ten of them, so a parse that finds nothing cannot pass", () => {
    // The literal is the thing that cannot drift with any of the parses
    // below. Changing it is a deliberate act — which is the point.
    expect(INTAKE_KINDS.length).toBe(10);
  });

  it("offers a label for every kind and no label for anything else", () => {
    expect(Object.keys(INTAKE_KIND_LABELS).sort()).toEqual([...INTAKE_KINDS].sort());
  });

  it("matches the classifier's own union", () => {
    const parsed = classifyKinds();
    expect(
      parsed.length,
      `parsed ${parsed.length} kinds out of classify.ts, expected ${INTAKE_KINDS.length}. ` +
        "Either the union changed or the pattern in this file can no longer read it.",
    ).toBe(INTAKE_KINDS.length);
    expect([...parsed].sort()).toEqual([...INTAKE_KINDS].sort());
  });

  it("matches the Prisma enum", () => {
    const parsed = schemaKinds();
    expect(parsed.length).toBe(INTAKE_KINDS.length);
    expect([...parsed].sort()).toEqual([...INTAKE_KINDS].sort());
  });

  it("matches what the migration actually created in the database", () => {
    const parsed = migrationKinds();
    expect(
      parsed.length,
      `parsed ${parsed.length} values out of the CREATE TYPE, expected ${INTAKE_KINDS.length}`,
    ).toBe(INTAKE_KINDS.length);
    expect([...parsed].sort()).toEqual([...INTAKE_KINDS].sort());
  });
});
