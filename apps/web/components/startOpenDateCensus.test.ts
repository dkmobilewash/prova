/**
 * A form that can open ON ARRIVAL (`startOpen`, from `?new=1` / `?add=1`) is
 * in server-rendered markup, so it may not call `localToday()` during render:
 * the server computes its own date, the browser's first render computes the
 * user's, and on any evening west of UTC the two disagree and hydration
 * breaks (CLAUDE.md, Dates). `localToday()` is only safe in a form a click
 * mounted. These forms use `useLocalToday()`, which is "" until after mount.
 *
 * BackchargeForm and MaterialOrderForm shipped exactly that (ux round 5),
 * and FieldReportComposer and CrewScheduleBoard carried comments saying they
 * were safe "because nothing renders until the button is clicked" — true
 * until startOpen was added under them.
 *
 * WHAT IT CANNOT SEE: a child Fields component that calls `localToday()`
 * itself. None of the startOpen forms' children do today.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const appDir = fileURLToPath(new URL("..", import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx$/.test(name) && !/\.test\./.test(name)) out.push(path);
  }
  return out;
}

const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const startOpenForms = [...walk(join(appDir, "components")), ...walk(join(appDir, "app"))]
  .map((path) => ({ file: relative(appDir, path), source: stripComments(readFileSync(path, "utf8")) }))
  .filter(({ source }) => /useState\([^)]*\bstartOpen\b/.test(source));

it("finds the startOpen forms (a pattern matching nothing would pass everything)", () => {
  const files = startOpenForms.map(({ file }) => file);
  for (const known of [
    "components/BackchargeForm.tsx",
    "components/MaterialOrderForm.tsx",
    "components/FieldReportComposer.tsx",
    "components/CrewScheduleBoard.tsx",
    "components/RfiForm.tsx",
    "components/SubmittalForm.tsx",
  ]) {
    expect(files).toContain(known);
  }
  expect(files.length).toBeGreaterThanOrEqual(8);
});

it("no startOpen form calls localToday() during render — use useLocalToday()", () => {
  const offenders = startOpenForms.filter(({ source }) => /\blocalToday\(\)/.test(source)).map(({ file }) => file);
  expect(offenders).toEqual([]);
});
