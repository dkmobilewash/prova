import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Does the cleanup delete every child that would block it, and in an order
 * Postgres will accept?
 *
 * `clean-scratch-data.mjs` deletes Job and Contact. Thirteen of their
 * children had foreign keys marked ON DELETE RESTRICT and were never
 * deleted first (issue #154). On an empty or lightly-used database that is
 * invisible — there are no rows, so nothing refuses. On a database that has
 * any of them Postgres refuses the parent delete and the run ends half-done,
 * which is the exact state the script exists to prevent. Every model this
 * missed was added to the schema AFTER the script was written, and nothing
 * anywhere connected the two facts.
 *
 * So this test does not check a list somebody typed. It DERIVES the set from
 * the migrations — the authoritative record of what the database actually
 * enforces, since Prisma's referential defaults differ by optionality
 * (required -> RESTRICT, optional -> SET NULL) and reading them off the
 * schema by eye is how the omission happened — and then reads the delete
 * order out of the script. Add a model with a required `jobId` and this
 * fails here, on a laptop, in a second, instead of failing on somebody's
 * database halfway through a cleanup.
 *
 * The same derivation is applied to `seed-demo.mjs --undo`, which deletes
 * the same two parents for the same reason.
 */

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const migrationsDir = join(repoRoot, "packages/db/prisma/schema/migrations");
const scriptsDir = join(repoRoot, "packages/db/scripts");

type Fk = { child: string; column: string; parent: string; onDelete: string };

/** Every foreign key the migrations have ever created, with the referential
 * action the database is actually holding.
 *
 * Cumulative, and that is sound here: no migration in this repo has ever
 * dropped a foreign-key constraint, so nothing on this list has been
 * superseded. If one ever does, this comment is what tells you to handle it
 * — grep the migrations for `DROP CONSTRAINT`. */
function foreignKeys(): Fk[] {
  const out: Fk[] = [];
  // EVERY GAP HERE IS `\s+`, NOT A SPACE, AND THAT IS THE WHOLE FIX.
  // This pattern spelled each gap as one literal space for as long as every
  // migration was Prisma-generated, because Prisma emits the statement on a
  // single line. #224's was written by hand and wrapped the line after the
  // constraint name — so the pattern did not match it, `foreignKeys()`
  // returned 180 instead of 181, and the ONE missing entry was
  // `InvoiceCounter.jobId -> Job RESTRICT`: a new blocker on Job, which is
  // precisely the thing this file exists to catch. All 13 tests passed.
  //
  // Same shape as every other vacuous check this repo has paid for: it was
  // not lying, it was answering about a set that no longer contained the
  // row anybody cared about. A whitespace-insensitive pattern makes SQL
  // formatting stop being load-bearing; the count test below makes a future
  // formatting surprise fail loudly instead of shrinking the set again.
  const pattern =
    /ALTER TABLE "(\w+)"\s+ADD CONSTRAINT "\w+"\s+FOREIGN KEY \("(\w+)"\)\s+REFERENCES "(\w+)"\("\w+"\)\s+ON DELETE (RESTRICT|CASCADE|SET NULL|SET DEFAULT|NO ACTION)/g;
  for (const dir of readdirSync(migrationsDir)) {
    const file = join(migrationsDir, dir, "migration.sql");
    if (!existsSync(file)) continue;
    const sql = readFileSync(file, "utf8");
    for (const m of sql.matchAll(pattern)) {
      out.push({ child: m[1], column: m[2], parent: m[3], onDelete: m[4] });
    }
  }
  return out;
}

/** Everything that must be deleted before `roots` can be, transitively.
 *
 * RESTRICT and NO ACTION both refuse the parent delete; CASCADE and SET NULL
 * do not, and their children are not this function's problem. Transitive
 * because a grandchild blocks a child that blocks the parent —
 * `ChangeOrderLineItemEdit` blocks `ChangeOrder`, which blocks `Job`, and
 * that is one of the thirteen. */
function blockers(fks: Fk[], roots: string[]): Set<string> {
  const blocking = fks.filter((f) => f.onDelete === "RESTRICT" || f.onDelete === "NO ACTION");
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length) {
    const parent = queue.shift() as string;
    for (const fk of blocking) {
      if (fk.parent === parent && !seen.has(fk.child) && !roots.includes(fk.child)) {
        seen.add(fk.child);
        queue.push(fk.child);
      }
    }
  }
  return seen;
}

/** The models a script deletes, in the order it deletes them.
 *
 * Read from the `del("name", ...)` calls, which is how both scripts are
 * written and is also what they print. Prisma model properties are
 * lower-camel; the migrations use PascalCase table names. */
function deleteOrder(fileName: string): string[] {
  const src = readFileSync(join(scriptsDir, fileName), "utf8");
  return [...src.matchAll(/await del\("(\w+)"/g)].map((m) => m[1]);
}

const pascal = (s: string) => s[0].toUpperCase() + s.slice(1);

const fks = foreignKeys();

describe("foreign-key derivation", () => {
  it("reads the migrations and finds foreign keys", () => {
    expect(fks.length).toBeGreaterThan(100);
    expect(fks.some((f) => f.child === "EquipmentAssignment" && f.parent === "Job")).toBe(true);
    // Declared across two lines in 20260909180000_add_invoice_counter, which
    // is the formatting that defeated the old pattern. Named here so the
    // specific case stays pinned and greppable, not just covered in
    // aggregate by the count below.
    expect(
      fks.find((f) => f.child === "InvoiceCounter" && f.parent === "Job")?.onDelete,
    ).toBe("RESTRICT");
  });

  it("parses EVERY foreign key in the migrations, not just the ones it can read", () => {
    // The rule this file learned the hard way, and the one worth stating
    // generally: ABSENCE OF A FAILURE IS NOT A PASS. `foreignKeys()` returns
    // whatever its pattern happened to match, and a pattern that matches
    // nothing at all would sail through every other test in this file —
    // `blockers()` of an empty set is empty, so nothing is ever missing and
    // nothing is ever out of order. Thirteen green tests, zero coverage.
    //
    // So count the statements INDEPENDENTLY of the pattern that parses them
    // and require the two to agree. `FOREIGN KEY` is the needle because it
    // appears once per foreign key and in nothing else — `ADD CONSTRAINT`
    // does not work, it also introduces the unique and primary-key
    // constraints (186 of those against 181 of these).
    let literal = 0;
    for (const dir of readdirSync(migrationsDir)) {
      const file = join(migrationsDir, dir, "migration.sql");
      if (!existsSync(file)) continue;
      const sql = readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n");
      literal += (sql.match(/FOREIGN KEY/g) ?? []).length;
    }
    expect(
      fks.length,
      `the migrations declare ${literal} foreign keys and this file parsed ${fks.length}. ` +
        "The pattern in foreignKeys() has fallen behind the SQL — find the statement it " +
        "cannot read before trusting anything else in this file.",
    ).toBe(literal);
  });

  it("no migration drops a foreign key, so the cumulative list is current", () => {
    // The one assumption `foreignKeys()` makes. Cheap to check, and if it
    // ever stops being true this test is quietly wrong rather than red.
    const dropped: string[] = [];
    for (const dir of readdirSync(migrationsDir)) {
      const file = join(migrationsDir, dir, "migration.sql");
      if (!existsSync(file)) continue;
      const sql = readFileSync(file, "utf8");
      if (/DROP CONSTRAINT "\w+_fkey"/.test(sql)) dropped.push(dir);
    }
    expect(dropped).toEqual([]);
  });

  it("Prisma's referential defaults are what the database holds", () => {
    // Required relation -> RESTRICT, optional -> SET NULL. Both directions
    // matter: SafetyIncident.jobId is optional and does NOT block, and
    // treating every FK as blocking would send someone deleting rows a
    // cleanup has no business touching.
    const restrict = fks.find((f) => f.child === "JobLineItem" && f.parent === "Job");
    const setNull = fks.find((f) => f.child === "SafetyIncident" && f.parent === "Job");
    expect(restrict?.onDelete).toBe("RESTRICT");
    expect(setNull?.onDelete).toBe("SET NULL");
  });
});

describe.each([
  ["clean-scratch-data.mjs", ["Job", "Contact"]],
  ["seed-demo.mjs", ["Job", "Contact"]],
])("%s deletes children before parents", (file, roots) => {
  const order = deleteOrder(file);
  const deleted = order.map(pascal);
  const required = [...blockers(fks, roots)].sort();

  it("deletes something", () => {
    expect(order.length).toBeGreaterThan(10);
  });

  it("deletes every RESTRICT child of Job and Contact", () => {
    const missing = required.filter((model) => !deleted.includes(model));
    // Named in the failure rather than counted: the point of this test is
    // that somebody can act on it without re-deriving the set by hand.
    expect(missing, `${file} never deletes: ${missing.join(", ")}`).toEqual([]);
  });

  it("deletes each blocking child before the parent it blocks", () => {
    const positionOf = (model: string) => deleted.indexOf(model);
    const wrong: string[] = [];
    for (const fk of fks) {
      if (fk.onDelete !== "RESTRICT" && fk.onDelete !== "NO ACTION") continue;
      const child = positionOf(fk.child);
      const parent = positionOf(fk.parent);
      if (child === -1 || parent === -1) continue;
      if (child > parent) wrong.push(`${fk.child} after ${fk.parent}`);
    }
    expect(wrong, `${file} deletes out of order: ${wrong.join("; ")}`).toEqual([]);
  });

  it("does not delete a counter row, which is a high-water mark", () => {
    // Sequence counters only ever increment; deleting one resets it to zero
    // and the next real record REISSUES a retired number. `--undo` deleted
    // the company-wide SafetyCaseCounter for months (issue #148). The
    // per-JOB counters are a different thing — the job they count for is
    // being deleted too, so the sequence they own ceases to exist rather
    // than restarting — which is why this names one row and not a pattern.
    expect(deleted).not.toContain("SafetyCaseCounter");
  });
});

describe("seed-demo.mjs issues safety case numbers from the counter", () => {
  const raw = readFileSync(join(scriptsDir, "seed-demo.mjs"), "utf8");
  // Comments stripped before matching. The comment explaining what the old
  // code did necessarily QUOTES the old code, and a naive negative match on
  // the source finds it there and fails — which would leave a choice
  // between a test that passes and a comment that explains itself.
  const seed = raw
    .split("\n")
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
    .join("\n");

  it("increments the counter rather than setting it", () => {
    // `update: { lastCaseNumber: 2 }` SET the counter to 2. On a company
    // that had climbed past 2 that is a reset DOWNWARDS, and every number
    // in between is handed out a second time. The counter only ever
    // increments — the same rule the undo path above is protecting, on the
    // write side of it.
    expect(seed).toMatch(/lastCaseNumber:\s*\{\s*increment:/);
    expect(seed).not.toMatch(/update:\s*\{\s*lastCaseNumber:\s*\d/);
  });

  it("does not hardcode case numbers", () => {
    // SafetyIncident is unique on (companyId, caseYear, caseNumber), so a
    // literal 1 collides with any real case already filed this year and
    // takes the whole seed down with it.
    expect(seed).toMatch(/caseNumber:\s*firstCaseNumber/);
  });
});
