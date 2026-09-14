/**
 * The other half of issue #65: not "is the label right" but "did somebody
 * write a twenty-third picker that renders the bare job name again".
 *
 * jobLabels.test.ts proves the shared helper says enough to tell two jobs
 * apart. This file proves every picker in the app actually CALLS it — which
 * is a different claim, and the one this repo keeps getting wrong. CLAUDE.md
 * records three separate cases of code that was "written, documented, and
 * never called", every one of them green the whole time, because nothing
 * referenced the dead part.
 *
 * WHAT IT SCANS, AND WHAT IT CANNOT SEE. Stated up front so nobody trusts it
 * further than it goes.
 *
 * The shape it looks for is a JSX line whose entire content is `{job.name}`
 * or `{j.name}`. That is what a job option or a filter chip looks like after
 * Prettier: a `.map()` body is broken across lines, so the rendered
 * expression ends up alone on its own line. A SINGLE job's heading is written
 * inline — `<h1>{job.name}</h1>` on /jobs/[id] — and is correctly invisible
 * here, because a page about one job cannot pick the wrong one.
 *
 * It therefore cannot see a picker that renders `<span>{job.name}</span>` on
 * one line, and it cannot see one that spells the variable something else
 * (`{row.name}`). It also cannot see whether the label is CORRECT — that is
 * jobLabels.test.ts's job.
 *
 * The reason it is a source scan at all: no test in this repo can render one
 * of these pages. A `<select>`'s options come from a server component that
 * queries Postgres, and the unit suite deliberately touches neither React nor
 * a database.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appDir = fileURLToPath(new URL("..", import.meta.url));

/**
 * EVERY JOB PICKER IN THE APP, and how many labelled job rows each one
 * renders. A picker is anywhere a person chooses which job a record is filed
 * against, or which job a list is filtered to.
 *
 * Maintained by hand ON PURPOSE, and checked in both directions below: a file
 * here with the wrong count fails, and a file NOT here that calls the helper
 * fails too. Adding a picker means adding a line, which is the only moment
 * anybody is going to think about whether their new `<select>` is readable.
 */
const LABELLED_PICKERS: Record<string, number> = {
  // ---- form selects: what a record gets filed against
  "components/BackchargeFields.tsx": 1,
  "components/CloseoutJobCard.tsx": 1,
  "components/ComplianceUploadForm.tsx": 1,
  "components/DrawingSetFields.tsx": 1,
  // Two: deploy a piece of equipment, and move an existing stay to another job.
  "components/EquipmentDeploymentControls.tsx": 2,
  "components/FieldReportComposer.tsx": 1,
  "components/MaterialOrderFields.tsx": 1,
  "components/MessageComposer.tsx": 1,
  "components/PunchListForm.tsx": 1,
  "components/PunchListRow.tsx": 1,
  "components/RfiFields.tsx": 1,
  "components/SafetyIncidentFields.tsx": 1,
  "components/SubmittalFields.tsx": 1,
  "components/ToolboxTalkForm.tsx": 1,
  // ---- filter chip rows: which job a log is narrowed to
  "app/(app)/backcharges/page.tsx": 1,
  "app/(app)/drawings/page.tsx": 1,
  "app/(app)/material-orders/page.tsx": 1,
  "app/(app)/photos/page.tsx": 1,
  "app/(app)/punch-lists/page.tsx": 1,
  "app/(app)/rfis/page.tsx": 1,
  "app/(app)/submittals/page.tsx": 1,
};

/**
 * Job lists that keep the bare name, each with the reason it is not a picker.
 *
 * The test is `{job.name}` alone on a line, so an entry here is a deliberate
 * statement that nothing gets FILED from this list.
 */
const BARE_NAME_EXCEPTIONS: Record<string, { count: number; why: string }> = {
  "app/(app)/deployment/page.tsx": {
    count: 2,
    why:
      "Two read-only lists, no form and no filter: the jobs one crew member " +
      "is split across, and the by-job cards. Both rows already carry their " +
      "own distinguishing detail (the crew names, the start/end dates), and " +
      "every job on this page is CONTRACTED or IN_PROGRESS, so a status " +
      "suffix would repeat itself down the whole page.",
  },
};

/** Copied from rowActionsCensus.test.ts, and for the same reason it exists
 * there: a source scan that reads its own documentation is a check that
 * cannot fail. This very file writes `{job.name}` in prose several times
 * above. */
function withoutComments(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function tsxFiles(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) tsxFiles(full, out);
    else if (name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** A JSX line that renders nothing but the job's bare name. */
const BARE_NAME_LINE = /^[ \t]*\{(?:job|j)\.name\}[ \t]*$/gm;

const HELPER_CALL = "jobPickerLabel(";

function countOf(haystack: string, needle: string) {
  return haystack.split(needle).length - 1;
}

describe("the job-picker census", () => {
  const files = tsxFiles(appDir).map((full) => {
    const source = readFileSync(full, "utf8");
    return { path: relative(appDir, full), source, code: withoutComments(source) };
  });

  it("finds the app, so an empty sweep cannot pass by accident", () => {
    expect(files.length).toBeGreaterThan(150);
    expect(files.map((f) => f.path)).toContain("components/RfiFields.tsx");
    expect(files.map((f) => f.path)).toContain("app/(app)/rfis/page.tsx");
  });

  it("has a pattern that matches the thing it is looking for", () => {
    // The lesson of the scratch-cleanup guard (CLAUDE.md): a pattern that
    // matches NOTHING passes every assertion downstream of it, because
    // nothing is ever missing from an empty set. So the pattern is tested
    // against a control string, independently of the repo.
    const control = ["<option value={job.id}>", "  {job.name}", "</option>"].join("\n");
    expect(control.match(BARE_NAME_LINE)).toHaveLength(1);
    expect("<h1>{job.name}</h1>".match(BARE_NAME_LINE)).toEqual(null);
    expect(withoutComments("/* {job.name} */").match(BARE_NAME_LINE)).toEqual(null);
  });

  it("labels every job picker with the shared helper, and nothing else calls it", () => {
    const calls = new Map<string, number>();
    for (const f of files) {
      const n = countOf(f.code, HELPER_CALL);
      if (n > 0) calls.set(f.path, n);
    }

    expect(Object.fromEntries([...calls].sort())).toEqual(
      Object.fromEntries(Object.entries(LABELLED_PICKERS).sort()),
    );
  });

  it("calls the helper exactly as many times as the inventory claims", () => {
    // The size assertion the per-file check above cannot make for itself: a
    // total, against a number that comes from the hand-written inventory
    // rather than from the same scan. A picker deleted, or one added without
    // being listed, moves this.
    const expected = Object.values(LABELLED_PICKERS).reduce((a, b) => a + b, 0);
    const actual = files.reduce((n, f) => n + countOf(f.code, HELPER_CALL), 0);

    expect(expected).toEqual(22);
    expect(actual).toEqual(expected);
  });

  it("renders no bare job name outside the read-only lists that are allowed one", () => {
    const bare: Record<string, number> = {};
    for (const f of files) {
      const hits = f.code.match(BARE_NAME_LINE)?.length ?? 0;
      if (hits > 0) bare[f.path] = hits;
    }

    const allowed = Object.fromEntries(
      Object.entries(BARE_NAME_EXCEPTIONS).map(([path, { count }]) => [path, count]),
    );

    expect(
      bare,
      Object.keys(bare).join() === Object.keys(allowed).join()
        ? ""
        : [
            "",
            "A job row is rendering the bare job name.",
            "",
            "Issue #65: fifteen jobs, seven of them called 'Smith kitchen",
            "remodel', and every picker in the app showed seven identical rows.",
            "What gets filed through these is certified payroll, a pay app, a",
            "backcharge — evidence records that lock on creation and never",
            "delete once sent, so the wrong row is not a mistake you take back.",
            "",
            "Use jobPickerLabel(job) from @/components/jobLabels, and add the",
            "picker to LABELLED_PICKERS in this file.",
            "",
            "If this list is genuinely read-only — nothing is filed or filtered",
            "from it — add it to BARE_NAME_EXCEPTIONS with the reason.",
            "",
          ].join("\n"),
    ).toEqual(allowed);

    // Non-vacuity, restated as an assertion rather than trusted: the
    // exceptions are non-empty, so a pattern that stopped matching would make
    // `bare` empty and fail the comparison above. This pins that intent.
    expect(Object.keys(allowed).length).toBeGreaterThan(0);
  });

  it("keeps the JobOption type in one place, so a picker cannot invent a narrower one", () => {
    // Three separate `JobOption = { id, name }` declarations is how the bare
    // name survived: a new picker copied whichever one was nearest and the
    // type never asked for a GC. There is one now, and it REQUIRES the GC and
    // the status — so a page that forgets to select them does not compile.
    const declarations = files.filter((f) => /export type JobOption\s*=/.test(f.code));
    expect(declarations.map((f) => f.path)).toEqual([]);
  });
});
