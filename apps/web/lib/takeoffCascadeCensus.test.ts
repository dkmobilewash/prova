import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ── EVERYTHING UNDER A TAKEOFF PLAN MUST CASCADE, AND THIS IS WHY ──
 *
 * `TakeoffPlan`'s own comment asserts that one `takeoffPlan.deleteMany({ jobId })`
 * reaches every child, so none of them needs registering in `HANDLED_MODELS` or
 * in either cleanup script's `del()` order. That sentence is load-bearing: both
 * cleanup scripts depend on it, and CLAUDE.md names this exact list as the shape
 * that goes stale — a child added without amending it leaves the claim asserting
 * something nobody re-checked.
 *
 * The failure it guards is the `InvoiceCounter` scar (#224/#227) in a different
 * table. A child with a RESTRICT foreign key is invisible until a cleanup run
 * refuses a job delete halfway through somebody's database, because Prisma's
 * DEFAULT for a required relation is RESTRICT — so getting this wrong is the
 * result of writing nothing, not of writing something wrong.
 *
 * ── WHAT THIS CHECKS, AND THE ONE THING IT CANNOT ──
 *
 * It reads the MIGRATION SQL, not the schema file, for the reason
 * `scratch-cleanup-order.test.ts` gives: the database enforces what the
 * migrations wrote, not what the schema reads like.
 *
 * It cannot tell you the cascade FIRES — only that it is declared. That proof
 * is a real Postgres deleting a real plan, and it was run when
 * `TakeoffWallProposal` was added: a proposal row written, then
 * `takeoffPlan.deleteMany({ jobId })` succeeding with zero rows left. A census
 * proves the code is there and never that the database honours it, which is
 * this repo's own lesson about the limit of a census.
 */

const MIGRATIONS = resolve(process.cwd(), "../../packages/db/prisma/schema/migrations");

/**
 * The SQL with its comment lines removed, which is not optional here.
 *
 * THIS FILE'S OWN FIRST RUN FAILED ON IT: the census parsed 369 foreign keys
 * against 376 "declared", and all seven of the difference were the words
 * FOREIGN KEY inside `--` comments — including the one in the migration added
 * beside this test, which explains why both of ITS constraints cascade.
 *
 * CLAUDE.md records the same trap twice from `OpeningDeductionForm.tsx`: a
 * census over a file that documents its own history must read CODE, never text,
 * because the better the comment, the more likely it contains the string you
 * are counting. `scratch-cleanup-order.test.ts` filters the same way.
 */
const code = (sql: string) =>
  sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

/** Every `ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY … REFERENCES … ON DELETE X`. */
type ForeignKey = { table: string; column: string; target: string; onDelete: string };

function foreignKeys(): ForeignKey[] {
  const out: ForeignKey[] = [];
  for (const dir of readdirSync(MIGRATIONS)) {
    if (!dir.match(/^\d{14}_/)) continue;
    const sql = code(readFileSync(resolve(MIGRATIONS, dir, "migration.sql"), "utf8"));
    // `\s+` everywhere a gap can fall, which is the #224 fix: a hand-written
    // migration wrapped its line after the constraint name and a pattern
    // spelling that gap as one literal space skipped the whole statement.
    const pattern =
      /ALTER\s+TABLE\s+"(\w+)"\s+ADD\s+CONSTRAINT\s+"[^"]+"\s+FOREIGN\s+KEY\s*\(\s*"(\w+)"\s*\)\s*REFERENCES\s+"(\w+)"\s*\([^)]*\)\s*ON\s+DELETE\s+(CASCADE|RESTRICT|SET\s+NULL|SET\s+DEFAULT|NO\s+ACTION)/gi;
    for (const match of sql.matchAll(pattern)) {
      out.push({
        table: match[1],
        column: match[2],
        target: match[3],
        onDelete: match[4].toUpperCase().replace(/\s+/g, " "),
      });
    }
  }
  return out;
}

describe("everything under a takeoff plan is collected by deleting the plan", () => {
  const keys = foreignKeys();

  it("PARSED THE MIGRATIONS AT ALL — a pattern matching nothing passes everything after it", () => {
    // The size assertion this repo asks of anything that derives its own input,
    // against a source that cannot drift with the pattern. Without it, a
    // formatting change that stops the regex matching would leave every
    // assertion below trivially true: nothing is ever RESTRICT in an empty set.
    const declared = readdirSync(MIGRATIONS)
      .filter((dir) => dir.match(/^\d{14}_/))
      .reduce(
        (total, dir) =>
          total +
          (code(readFileSync(resolve(MIGRATIONS, dir, "migration.sql"), "utf8")).match(/FOREIGN KEY/g) ??
            []).length,
        0,
      );
    expect(declared, "no migration declares a foreign key — the path is wrong").toBeGreaterThan(100);
    expect(
      keys.length,
      `the migrations declare ${declared} foreign keys and this census parsed ${keys.length}`,
    ).toBe(declared);
  });

  /**
   * Which tables hang off `TakeoffPlan`, transitively, following only the
   * relations that would be walked by deleting a plan.
   *
   * DERIVED, NOT LISTED, which is the point: a new child joins this set without
   * anybody editing this file, and is then held to the same rule.
   */
  const reachable = () => {
    const found = new Set(["TakeoffPlan"]);
    for (let pass = 0; pass < 10; pass += 1) {
      for (const key of keys) {
        if (found.has(key.target) && !found.has(key.table)) found.add(key.table);
      }
    }
    found.delete("TakeoffPlan");
    return found;
  };

  it("names the children rather than finding none", () => {
    const children = reachable();
    // The three that have been there since the takeoff shipped, so this cannot
    // pass by walking nothing.
    expect(children).toContain("TakeoffPlanPage");
    expect(children).toContain("TakeoffScaleCalibration");
    expect(children).toContain("TakeoffMeasurement");
    expect(children).toContain("TakeoffWallProposal");
  });

  it("EVERY ONE OF THEM CASCADES — a RESTRICT would refuse a cleanup run", () => {
    const children = reachable();
    const blocking = keys
      .filter((key) => children.has(key.table) && children.has(key.target) || (children.has(key.table) && key.target === "TakeoffPlan"))
      .filter((key) => key.onDelete !== "CASCADE" && key.onDelete !== "SET NULL")
      .map((key) => `${key.table}.${key.column} -> ${key.target} ${key.onDelete}`);

    expect(
      blocking,
      "a child of TakeoffPlan blocks its own parent's delete; both cleanup scripts would refuse the job",
    ).toEqual([]);
  });

  it("the new proposal table cascades from BOTH of its parents", () => {
    // Named explicitly because it has two, and only one of them is the page.
    // Deleting a page cascades to its calibrations AND to this, and Postgres
    // fires those triggers in creation order — so a RESTRICT on the
    // calibration side would see rows that are about to be deleted anyway and
    // block the whole delete. That is the #227 shape exactly.
    const mine = keys.filter((key) => key.table === "TakeoffWallProposal");
    expect(mine.map((key) => `${key.column}:${key.onDelete}`).sort()).toEqual([
      "calibrationId:CASCADE",
      "pageId:CASCADE",
    ]);
  });
});
