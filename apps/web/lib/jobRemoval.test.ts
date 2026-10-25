import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { JOB_DRAFT_CHILDREN, JOB_HISTORY_RELATIONS } from "./job-details";

/**
 * Can "Remove it" on an estimate ever hit a foreign key it does not know about?
 *
 * It could, and did: on 2026-10-19 a user walk on main removed an estimate
 * with an uploaded takeoff plan and got `TakeoffPlan_jobId_fkey` thrown at
 * them; deleting the plan by hand got as far as `JobBidRecap_jobId_fkey`.
 * `deleteEstimateJob` held a hand-written list of what counts as history and
 * deleted only line items, and every table added to Job since — the takeoff,
 * the recap, the wall runs, sixteen evidence records — was in neither half.
 *
 * So, like `scratch-cleanup-order.test.ts`, this does not check a list somebody
 * typed against another list somebody typed. It DERIVES every foreign key onto
 * Job from the migration SQL, which is what Postgres actually enforces, and
 * requires each one that can refuse a delete to be named exactly once: either
 * the estimate's own working papers (`JOB_DRAFT_CHILDREN`, deleted with it) or
 * history (`JOB_HISTORY_RELATIONS`, which refuses with a sentence). Add a
 * model with a required `jobId` and this fails until somebody decides which.
 */

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const migrationsDir = join(repoRoot, "packages/db/prisma/schema/migrations");

type Fk = { child: string; column: string; parent: string; onDelete: string };

function migrationSql(): string[] {
  return readdirSync(migrationsDir)
    .map((dir) => join(migrationsDir, dir, "migration.sql"))
    .filter((file) => existsSync(file))
    .map((file) => readFileSync(file, "utf8"));
}

/** Every gap is `\s+`, for the reason `scratch-cleanup-order.test.ts` records:
 *  a hand-written migration wrapped one of these statements and a
 *  single-space pattern silently skipped it. */
function foreignKeys(): Fk[] {
  const pattern =
    /ALTER\s+TABLE\s+"(\w+)"\s+ADD\s+CONSTRAINT\s+"\w+"\s+FOREIGN\s+KEY\s+\("(\w+)"\)\s+REFERENCES\s+"(\w+)"\s*\("\w+"\)\s+ON\s+DELETE\s+(RESTRICT|CASCADE|SET NULL|SET DEFAULT|NO ACTION)/g;
  const out: Fk[] = [];
  for (const sql of migrationSql()) {
    for (const m of sql.matchAll(pattern)) out.push({ child: m[1], column: m[2], parent: m[3], onDelete: m[4] });
  }
  return out;
}

const fks = foreignKeys();
const refuses = (fk: Fk) => fk.onDelete === "RESTRICT" || fk.onDelete === "NO ACTION";
const ontoJob = fks.filter((fk) => fk.parent === "Job");
const blockingJob = ontoJob.filter(refuses);

const historyTables = new Set(JOB_HISTORY_RELATIONS.map((r) => r.table));
const draftTables = new Set<string>(JOB_DRAFT_CHILDREN.map((c) => c.table));

/** Grandchildren of a draft child that cannot exist unless a HISTORY record on
 *  the same job does — so the job is refused before the draft delete could
 *  ever meet them. Each names the history table that implies it. */
const IMPLIED_BY_HISTORY: Record<string, string> = {
  // An edit to a line item exists only as part of a change order.
  ChangeOrderLineItemEdit: "ChangeOrder",
  // An invoice line exists only on an invoice.
  InvoiceLineItem: "Invoice",
};

/** SET NULL children of Job that are deliberately left behind, detached,
 *  when an estimate is removed. Named so a new one forces a decision. */
const DETACHED_ON_REMOVE = new Set(["BidInvitation", "DocumentIntake", "Equipment"]);

describe("foreign keys onto Job, from the migrations", () => {
  it("parses every one the SQL declares, not just the ones the pattern can read", () => {
    // Absence of a failure is not a pass: a pattern matching nothing makes
    // every assertion below vacuously true. Count independently of it.
    const literal = migrationSql().reduce(
      (n, sql) => n + (sql.match(/FOREIGN\s+KEY\s*\([^)]*\)\s*REFERENCES\s+"Job"/g) ?? []).length,
      0,
    );
    expect(literal).toBeGreaterThan(50);
    expect(ontoJob).toHaveLength(literal);
    // No migration has dropped a foreign key, which is what makes reading
    // them cumulatively sound. If one ever does, this says to handle it.
    expect(migrationSql().some((sql) => /DROP\s+CONSTRAINT\s+"\w+_fkey"/.test(sql))).toBe(false);
  });

  it("names the two that fired on 19 Oct as blockers", () => {
    for (const table of ["TakeoffPlan", "JobBidRecap"]) {
      expect(blockingJob.find((fk) => fk.child === table)?.onDelete, table).toBe("RESTRICT");
    }
  });
});

describe("every child that can refuse a job delete is decided exactly once", () => {
  it("is either removed with the estimate or holds the job as history", () => {
    const undecided = blockingJob.map((fk) => fk.child).filter((t) => !historyTables.has(t) && !draftTables.has(t));
    expect(undecided, "RESTRICT children of Job in neither list").toEqual([]);
  });

  it("is never in both lists", () => {
    expect([...draftTables].filter((t) => historyTables.has(t))).toEqual([]);
  });

  it("removes only tables that really hang off Job by jobId", () => {
    // The action deletes each draft child with `deleteMany({ where: { jobId } })`
    // through its delegate name, so both halves of that call are pinned here.
    for (const child of JOB_DRAFT_CHILDREN) {
      expect(
        blockingJob.some((fk) => fk.child === child.table && fk.column === "jobId"),
        `${child.table}.jobId -> Job`,
      ).toBe(true);
      expect(child.model, child.table).toBe(child.table[0].toLowerCase() + child.table.slice(1));
    }
  });

  it("cannot meet a grandchild that refuses the draft delete", () => {
    for (const table of draftTables) {
      for (const fk of fks.filter((f) => f.parent === table && refuses(f))) {
        const covered =
          draftTables.has(fk.child) ||
          historyTables.has(fk.child) ||
          historyTables.has(IMPLIED_BY_HISTORY[fk.child] ?? "");
        expect(covered, `${fk.child}.${fk.column} -> ${table} RESTRICT`).toBe(true);
      }
    }
  });

  it("names every SET NULL child of Job, kept as history or detached on purpose", () => {
    for (const fk of ontoJob.filter((f) => f.onDelete === "SET NULL")) {
      expect(historyTables.has(fk.child) || DETACHED_ON_REMOVE.has(fk.child), fk.child).toBe(true);
    }
  });

  it("only lists history that is really attached to the job", () => {
    for (const relation of JOB_HISTORY_RELATIONS) {
      const direct = ontoJob.some((fk) => fk.child === relation.table);
      const viaLineItems =
        relation.throughLineItems === true &&
        fks.some((fk) => fk.child === relation.table && fk.parent === "JobLineItem");
      expect(direct || viaLineItems, relation.table).toBe(true);
    }
  });
});
