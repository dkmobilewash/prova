/**
 * What a certified payroll hour may be corrected to, and what it may never
 * be corrected INTO.
 *
 * Issue #63. A logged hour had one action — Remove — so the only way to fix
 * "10" that should have been "8" was to destroy the row and type a new one.
 * These rows are what a WH-347 is built from, so this file pins the two
 * halves of the correction path that cannot be allowed to drift:
 *
 *   1. the figures a correction may touch, as an EXACT key set rather than a
 *      minimum — a test that a field is editable cannot catch a field that
 *      became editable by accident, and `date` becoming editable by accident
 *      is the whole risk here;
 *   2. that the list of locked columns this app enforces is the same list the
 *      DATABASE enforces, read out of the migration that installs the
 *      trigger. A lock in TypeScript is a lock a psql session walks past.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  TIME_ENTRY_CORRECTABLE_KEYS,
  TIME_ENTRY_LOCKED_COLUMNS,
  parseTimeEntryFigures,
  submittedLockedFieldChanges,
  timeEntryCorrectionUpdateData,
  timeEntryPayTypeLabel,
} from "./time-entry-correction";

function form(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.append(key, value);
  return formData;
}

/** The happy-path correction: eight hours instead of ten, and a reason. */
const corrected = () =>
  form({ hours: "8", payType: "STRAIGHT", note: "Timesheet said 8 — logged as 10 in error" });

describe("parseTimeEntryFigures", () => {
  it("takes the hours, the pay type and the note", () => {
    const result = parseTimeEntryFigures(corrected());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.hours).toBe("8");
    expect(result.value.payType).toBe("STRAIGHT");
    expect(result.value.note).toBe("Timesheet said 8 — logged as 10 in error");
  });

  it("refuses hours that are not a positive number, with a sentence a user can read", () => {
    // Production REDACTS a thrown Server Action message to a digest, so every
    // refusal here has to come back as a value. The message is asserted, not
    // just the failure: an empty string would satisfy `ok === false`.
    for (const hours of ["", "0", "-4", "eight"]) {
      const result = parseTimeEntryFigures(form({ hours }));
      expect(result.ok, `hours="${hours}" was accepted`).toBe(false);
      if (result.ok) continue;
      expect(result.error).toContain("Hours");
      expect(result.error.length).toBeGreaterThan(10);
    }
  });

  it("treats an empty note and empty allowances as not set rather than as zero", () => {
    const result = parseTimeEntryFigures(form({ hours: "8", note: "   ", perDiemAmount: "", travelPayAmount: "" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.note).toBeNull();
    expect(result.value.perDiemAmount).toBeNull();
    expect(result.value.travelPayAmount).toBeNull();
  });

  it("refuses an allowance that is not a number instead of writing NaN to a money column", () => {
    const result = parseTimeEntryFigures(form({ hours: "8", perDiemAmount: "fifty" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Per diem");
  });

  it("falls back to straight time on an unrecognised pay type, as logging does", () => {
    const result = parseTimeEntryFigures(form({ hours: "8", payType: "TRIPLE_TIME" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.payType).toBe("STRAIGHT");
  });

  it("IGNORES a locked field even when the request sends one", () => {
    // The edit form renders the person and the day as text, so a request
    // carrying either did not come from that form. The parse layer drops
    // them; the action refuses them out loud; the database trigger is what
    // actually enforces it. This is the first of those three.
    const result = parseTimeEntryFigures(
      form({
        hours: "8",
        date: "2026-01-01",
        employeeUserId: "someone-else",
        crewMemberId: "somebody-else-again",
        jobId: "a-different-job",
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const locked of TIME_ENTRY_LOCKED_COLUMNS) {
      expect(Object.keys(result.value), `${locked} survived the parse`).not.toContain(locked);
    }
  });
});

describe("the update payload", () => {
  it("writes EXACTLY the correctable columns, plus who corrected it and when", () => {
    // An exact key set, not a subset. `toContain` checks would pass just as
    // happily with `date` in the payload, which is the one thing this file
    // exists to stop.
    const parsed = parseTimeEntryFigures(corrected());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const at = new Date("2026-09-13T17:04:00.000Z");
    const data = timeEntryCorrectionUpdateData(parsed.value, "user-1", at);

    expect(Object.keys(data).sort()).toEqual(
      [...TIME_ENTRY_CORRECTABLE_KEYS, "lastCorrectedAt", "lastCorrectedByUserId"].sort(),
    );
    expect(data.lastCorrectedAt).toBe(at);
    expect(data.lastCorrectedByUserId).toBe("user-1");
  });

  it("names nine fields and no more, so widening the type is a decision and not a side effect", () => {
    // The size assertion CLAUDE.md asks of anything that derives a set: the
    // payload's keys come from one place, so this is the independent count.
    expect(TIME_ENTRY_CORRECTABLE_KEYS).toHaveLength(7);
    expect([...TIME_ENTRY_CORRECTABLE_KEYS].sort()).toEqual([
      "craftClassificationId",
      "hours",
      "lineItemId",
      "note",
      "payType",
      "perDiemAmount",
      "travelPayAmount",
    ]);
  });

  it("shares no field with the locked list", () => {
    for (const locked of TIME_ENTRY_LOCKED_COLUMNS) {
      expect(TIME_ENTRY_CORRECTABLE_KEYS as readonly string[]).not.toContain(locked);
    }
  });
});

describe("submittedLockedFieldChanges", () => {
  const stored = { employeeUserId: "user-1", date: new Date("2026-08-31T00:00:00.000Z") };

  it("says nothing when the form sends no locked field at all — the normal edit", () => {
    expect(submittedLockedFieldChanges(corrected(), stored)).toEqual([]);
  });

  it("says nothing when a locked field is sent unchanged", () => {
    const formData = form({ hours: "8", employeeUserId: "user-1", date: "2026-08-31" });
    expect(submittedLockedFieldChanges(formData, stored)).toEqual([]);
  });

  it("names the person when the request tries to move the hours to somebody else", () => {
    const formData = form({ hours: "8", employeeUserId: "user-2" });
    expect(submittedLockedFieldChanges(formData, stored)).toEqual(["the person"]);
  });

  it("names the day when the request tries to move the hours to another date", () => {
    const formData = form({ hours: "8", date: "2026-09-01" });
    expect(submittedLockedFieldChanges(formData, stored)).toEqual(["the day worked"]);
  });

  it("names both when both are changed", () => {
    const formData = form({ hours: "8", employeeUserId: "user-2", date: "2026-09-01" });
    expect(submittedLockedFieldChanges(formData, stored)).toEqual(["the person", "the day worked"]);
  });
});

describe("the database holds the same lock this module names", () => {
  /* A TypeScript list of locked columns is a promise the application layer
     makes. The migration is where it becomes a rule, and CLAUDE.md's own
     record of this table says so in as many words: the guarantee "an hour,
     once attributed, does not change hands" used to be a trigger, was
     downgraded to a source census because TimeEntry is live payroll, and the
     census's message says that anybody adding an update path must put the
     lock back in the database. This asserts they did. */
  const migrationsDir = fileURLToPath(
    new URL("../../../packages/db/prisma/schema/migrations", import.meta.url),
  );

  const triggerSql = (() => {
    for (const dir of readdirSync(migrationsDir).sort()) {
      const file = join(migrationsDir, dir, "migration.sql");
      if (!existsSync(file)) continue;
      const sql = readFileSync(file, "utf8");
      if (sql.includes("prova_time_entry_identity_lock")) return sql;
    }
    return null;
  })();

  it("installs a BEFORE UPDATE trigger on TimeEntry", () => {
    expect(
      triggerSql,
      "no migration creates prova_time_entry_identity_lock — an update path to a live payroll " +
        "table exists with nothing but application code stopping a reassignment",
    ).not.toBeNull();
    expect(triggerSql).toMatch(/BEFORE UPDATE ON "TimeEntry"/);
    expect(triggerSql).toMatch(/FOR EACH ROW EXECUTE FUNCTION prova_time_entry_identity_lock\(\)/);
  });

  it("compares every column this module calls locked, and no fewer", () => {
    const sql = triggerSql ?? "";
    for (const column of TIME_ENTRY_LOCKED_COLUMNS) {
      expect(sql, `the trigger never reads NEW."${column}"`).toContain(`NEW."${column}"`);
      expect(sql, `the trigger never reads OLD."${column}"`).toContain(`OLD."${column}"`);
    }
    // The size half. Without it, a trigger that compares one column and
    // mentions the other three in its RAISE message would pass above.
    const comparisons = (sql.match(/IS DISTINCT FROM/g) ?? []).length;
    expect(
      comparisons,
      `the trigger makes ${comparisons} IS DISTINCT FROM comparisons for ` +
        `${TIME_ENTRY_LOCKED_COLUMNS.length} locked columns`,
    ).toBe(TIME_ENTRY_LOCKED_COLUMNS.length);
  });

  it("raises rather than silently ignoring the change", () => {
    // A trigger that returns OLD instead of raising would discard the whole
    // update, including the correction the user did mean.
    expect((triggerSql ?? "").match(/RAISE EXCEPTION/g) ?? []).toHaveLength(2);
  });
});

describe("timeEntryPayTypeLabel", () => {
  it("labels the four pay types", () => {
    expect(timeEntryPayTypeLabel("STRAIGHT")).toBe("Straight");
    expect(timeEntryPayTypeLabel("DOUBLE_TIME")).toBe("Double time");
  });

  it("falls back to the stored value rather than rendering nothing", () => {
    expect(timeEntryPayTypeLabel("WHAT_IS_THIS")).toBe("WHAT_IS_THIS");
  });
});
