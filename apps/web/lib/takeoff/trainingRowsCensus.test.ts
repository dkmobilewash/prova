import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { heldOutReason, isHeldOut } from "./heldOutSets";

/**
 * ── NO HELD-OUT SET MAY REACH A TRAINING ROW ──
 *
 * `heldOutSets.test.ts` proves the LIST is right. This proves the list is
 * APPLIED — which is the other half, and the half that a completeness test
 * cannot see. This repo has paid for that distinction twice (CLAUDE.md on the
 * bid recap's rates: a canonical list proved complete while a consumer read
 * its own inlined copy), so both guards exist and neither implies the other.
 *
 * Two things are checked, and the second is the real one:
 *
 *   1. every labelled set on this machine that is held out is REFUSED by
 *      `heldOutReason` — reading the label directory, so a set that arrives
 *      later is covered without anybody editing a test;
 *   2. anything that BUILDS training rows goes through the split. A row
 *      builder that reads the label directory itself and never asks is how a
 *      held-out set reaches a model, and it would pass every test above.
 *
 * The second is a source census, and it says so: it cannot run the builders,
 * only see that they ask. What makes it honest is that it derives the set of
 * builders rather than naming them, and asserts that set is not empty — a
 * pattern matching nothing would pass everything downstream.
 */

/** `apps/web` — this file is at `apps/web/lib/takeoff`. */
const HERE = join(__dirname, "..", "..");
/** Where a labelled sheet is saved, when this machine has any. */
const LABELS = join(process.env.HOME ?? "", "Claude Folder", "takeoff", "labels");

describe("no held-out set reaches training", () => {
  it("refuses every held-out set among the labels on this machine", () => {
    if (!existsSync(LABELS)) return;
    const dirs = readdirSync(LABELS).filter((name) => {
      try {
        return statSync(join(LABELS, name)).isDirectory();
      } catch {
        return false;
      }
    });
    // Not an assertion about how many there are — a machine with no labels is
    // a legitimate state and this case simply has nothing to say about it.
    for (const dir of dirs) {
      const why = heldOutReason(dir);
      if (why === null) continue;
      expect(why.length, `${dir} is held out but gives no reason`).toBeGreaterThan(0);
    }
    // The four held out on 2026-10-20 arrive as directories named after their
    // PDFs. Any that is present must be refused.
    for (const dir of dirs) {
      if (/CENTRAL.?BANK|Gen.?BBQ|SLN.?Terminal|stem.?bid|Cedar.?Hollow/i.test(dir)) {
        expect(isHeldOut(dir), `${dir} must be refused`).toBe(true);
      }
    }
  });

  it("every training-row builder asks whether the set is held out", () => {
    // ── THE BUILDERS ARE DERIVED, NOT LISTED ──
    //
    // A file that reads the LABEL DIRECTORY and emits rows with a `label`
    // field is building training data, whatever it is called. Naming them
    // instead would leave the next one unguarded and this test green.
    const roots = [join(HERE, "lib"), join(HERE, "scripts")];
    const files: { path: string; code: string }[] = [];
    const walk = (dir: string) => {
      if (!existsSync(dir)) return;
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        const stat = statSync(full);
        if (stat.isDirectory()) {
          if (name === "node_modules" || name === "fixtures") continue;
          walk(full);
          continue;
        }
        if (!/\.(ts|mjs|js)$/.test(name)) continue;
        if (/\.test\.|\.dbtest\./.test(name)) continue;
        files.push({ path: full.slice(HERE.length + 1), code: readFileSync(full, "utf8") });
      }
    };
    for (const root of roots) walk(root);
    expect(files.length, "no source file was scanned — the walk found nothing").toBeGreaterThan(50);

    // Comments stripped, so describing training in prose is not a claim about
    // what the file does.
    const stripped = files.map((f) => ({
      path: f.path,
      code: f.code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""),
    }));

    // ── THE SCOPE, ASSERTED, BECAUSE THE FIRST VERSION OF THIS WAS VACUOUS ──
    //
    // It looked for files that read the label directory AND emit rows, found
    // ZERO, and passed — the whole guard was an empty question. The reason was
    // real and worth more than the test: the row builder lived in a scratch
    // script OUTSIDE the repository, so nothing here could see it and the rule
    // was enforced by whoever remembered it.
    //
    // `trainingRows.ts` is that builder now, in the repo. These two sets are
    // asserted non-empty so a pattern that stops matching fails loudly instead
    // of passing everything downstream.
    const touchLabels = stripped.filter((f) => /TAKEOFF_LABEL_DIR|takeoff\/labels/.test(f.code));
    expect(
      touchLabels.length,
      "nothing reads the label directory — this census has stopped finding its subject",
    ).toBeGreaterThan(0);

    const builders = stripped.filter((f) => /\bTrainingRow\b|\btrainingRows\b/.test(f.code));
    expect(
      builders.map((f) => f.path).filter((p) => !p.includes("heldOutSets")),
      "no file builds training rows — if that is true the rule guards nothing",
    ).not.toEqual([]);

    // ── AND THE ASSERTION ITSELF ──
    //
    // Anything that reads the labels and turns them into rows must ask. The
    // two sets are unioned rather than intersected: a builder that gets its
    // labels some other way is still a builder.
    const mustAsk = [...new Set([...touchLabels, ...builders].map((f) => f.path))]
      .map((path) => stripped.find((f) => f.path === path))
      .filter((f): f is { path: string; code: string } => f !== undefined)
      // A file that only READS labels without making rows is not training —
      // `labelStore.ts` writes them, the offset evals audit them.
      .filter((f) => /\bTrainingRow\b|\btrainingRows\b|\bfamily\b/.test(f.code));

    const unguarded = mustAsk.filter(
      (f) => !/heldOutReason|isHeldOut|splitForTraining|HELD_OUT_SETS/.test(f.code),
    );
    expect(
      unguarded.map((f) => f.path),
      "these build training rows without asking whether the set is held out",
    ).toEqual([]);
  });
});
