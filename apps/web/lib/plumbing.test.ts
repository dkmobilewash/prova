import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards on the plumbing BETWEEN the two lanes, rather than on the code
 * inside either one.
 *
 * Four things went wrong in one day and none of them was a bug in anybody's
 * feature: a workflow on main calling scripts that only existed on an
 * unmerged branch, a demo database migrated from the wrong ref, an audit
 * whose counts disagreed with its own rows for the third time, and a
 * preflight script that diverged from the CI it claims to mirror.
 *
 * They share a shape, and it is the same one the reachability guard was
 * written for: **something two people must keep in agreement by hand, with
 * no signal when it drifts.** The mistake is never the interesting part.
 * The silence around it is.
 *
 * These two assertions are the cheapest possible version of that signal.
 * Neither can tell you a thing is RIGHT — only that two places which must
 * agree still do.
 */

const REPO = resolve(__dirname, "..", "..", "..");

/* ------------------------------------------------------------------ *
 * 1. A workflow must not invoke a script that isn't in the repo.
 * ------------------------------------------------------------------ */

describe("workflows only run scripts that exist on this ref", () => {
  const dir = join(REPO, ".github", "workflows");
  const files = readdirSync(dir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));

  it("finds the workflows at all", () => {
    // Guards the guard. A glob that silently matches nothing passes
    // forever and is worse than no test — the same trap the reachability
    // check has a meta-test for.
    expect(files.length).toBeGreaterThan(2);
  });

  /** Every `node <path>.mjs` a workflow runs, resolved against the
   * `working-directory:` in force at that point in the file. */
  function scriptInvocations(yml: string): { script: string; resolved: string }[] {
    const lines = yml.split("\n");
    const found: { script: string; resolved: string }[] = [];
    let cwd = ".";
    for (const line of lines) {
      const wd = line.match(/^\s*working-directory:\s*(\S+)\s*$/);
      if (wd) cwd = wd[1];
      // `node scripts/foo.mjs`, with or without arguments after it.
      for (const m of line.matchAll(/\bnode\s+([\w./-]+\.mjs)/g)) {
        found.push({ script: m[1], resolved: join(REPO, cwd, m[1]) });
      }
    }
    return found;
  }

  const invocations = files.flatMap((f) =>
    scriptInvocations(readFileSync(join(dir, f), "utf8")).map((i) => ({ workflow: f, ...i })),
  );

  it.each(invocations)("$workflow runs $script, which exists", ({ workflow, script, resolved }) => {
    expect(
      existsSync(resolved),
      `${workflow} invokes "node ${script}" and that file is not in this repo.\n` +
        `Looked for: ${resolved.replace(REPO, "")}\n\n` +
        `A workflow whose script is missing still SHOWS as a button, runs, and ` +
        `fails with a bare "cannot find module" — which reads as a broken ` +
        `workflow rather than a missing dependency. This happened: seed-demo.yml ` +
        `merged to main while the scripts it calls were still on an unmerged ` +
        `branch. Either land the script first, or don't land the button yet.`,
    ).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * 2. FEATURE-AUDIT's arithmetic must agree with its own rows.
 * ------------------------------------------------------------------ */

/*
 * The file states its arithmetic in THREE places, and all three have been
 * wrong at once. On `ebe3532~1` the stated line said 121/88/22/9/2, the
 * summary table said 86 built, and the rows themselves were 87 — three
 * numbers, no two agreeing, every check green.
 *
 * The 121 is worth naming because it is the whole reason this guard reads
 * the file structurally instead of grepping it. Someone recounted by
 * grepping `^| Built |` over the file, which also matches the summary
 * table's OWN four rows — so the count came out at rows + 4, and the error
 * looked like a careful recount. Feature rows are therefore only counted
 * while inside a sheet, and the summary table is parsed separately and
 * asserted against, never counted as data.
 *
 * All three places are checked here. Checking only the total would let two
 * per-sheet errors cancel and pass.
 */

type Counts = { built: number; partial: number; missing: number; descoped: number };
const zero = (): Counts => ({ built: 0, partial: 0, missing: 0, descoped: 0 });
const KEYS = ["built", "partial", "missing", "descoped"] as const;

const sum = (a: Counts, b: Counts): Counts => ({
  built: a.built + b.built,
  partial: a.partial + b.partial,
  missing: a.missing + b.missing,
  descoped: a.descoped + b.descoped,
});
const items = (c: Counts) => c.built + c.partial + c.missing + c.descoped;

/** "built: header says 6, rows have 7" for each status that disagrees. */
function deltas(claim: Counts, actual: Counts): string {
  return KEYS.filter((k) => claim[k] !== actual[k])
    .map((k) => `${k}: says ${claim[k]}, rows have ${actual[k]}`)
    .join("; ");
}

/** Reads the file into per-sheet header counts, per-sheet row counts, the
 *  summary table, and the stated summary line. */
function readAudit() {
  const text = readFileSync(join(REPO, "FEATURE-AUDIT.md"), "utf8");
  const sheets: { n: string; title: string; line: number; header: Counts; rows: Counts }[] = [];
  const summaryTable = zero();
  const summaryTableSaw = new Set<string>();
  const strays: string[] = [];
  let current: (typeof sheets)[number] | null = null;

  text.split("\n").forEach((line, i) => {
    const head = line.match(/^## (\d+)\.\s*(.*?) — ((?:\d+ \w+(?: · )?)+)\s*$/);
    if (head) {
      current = { n: head[1], title: `${head[1]}. ${head[2]}`, line: i + 1, header: zero(), rows: zero() };
      for (const [, n, word] of head[3].matchAll(/(\d+) (built|partial|missing|descoped)/g)) {
        current.header[word as keyof Counts] = Number(n);
      }
      sheets.push(current);
      return;
    }

    const status = line.match(/^\|\s*(Built|Partial|Missing|Descoped)\s*\|/);
    if (!status) return;
    const key = status[1].toLowerCase() as keyof Counts;

    if (current) {
      // Inside a sheet: a feature row.
      current.rows[key] += 1;
      return;
    }

    // Before the first sheet. The only legitimate status-shaped rows up
    // here are the summary table's two-column `| Built | 88 |`.
    const cell = line.match(/^\|\s*(?:Built|Partial|Missing|Descoped)\s*\|\s*(\d+)\s*\|\s*$/);
    if (cell) {
      summaryTable[key] = Number(cell[1]);
      summaryTableSaw.add(key);
    } else {
      strays.push(`line ${i + 1}: ${line.slice(0, 70)}`);
    }
  });

  const summaryLine = text.match(
    /\*\*(\d+) items audited — (\d+) built \/ (\d+) partial \/ (\d+) missing \/ (\d+) descoped\*\*/,
  );

  return { sheets, summaryTable, summaryTableSaw, strays, summaryLine };
}

describe("FEATURE-AUDIT counts agree with its own rows", () => {
  const { sheets, summaryTable, summaryTableSaw, strays, summaryLine } = readAudit();
  const total = sheets.reduce((acc, s) => sum(acc, s.rows), zero());

  /* -- guards on the parser itself, so a miss can't pass as agreement -- */

  it("parses all 26 sheets, numbered contiguously", () => {
    // A sheet header that stops matching (reworded, or its `— N built`
    // suffix dropped) does not fail loudly: its rows get attributed to the
    // PREVIOUS sheet and both sheets then look self-consistent. A bare
    // `length > 20` passes straight through that. The numbering is what
    // makes the miss visible.
    expect(
      sheets.map((s) => s.n),
      "A sheet header did not parse. Headers must read exactly " +
        "`## NN. Title — N built · N partial · N missing`, and this test " +
        "counts rows only while inside one — so an unparsed header silently " +
        "folds its rows into the sheet above it.",
    ).toEqual(Array.from({ length: 26 }, (_, i) => String(i + 1).padStart(2, "0")));
  });

  it("finds a summary table with all four statuses, and nothing else above the sheets", () => {
    expect(
      [...summaryTableSaw].sort(),
      "The summary table above the sheets is missing a status row.",
    ).toEqual([...KEYS].sort());
    expect(
      strays,
      "A status-shaped row sits above the first sheet but is not part of " +
        "the summary table. Feature rows must live under a `## NN.` header, " +
        "or they are counted by nothing.",
    ).toEqual([]);
  });

  /* ---------------- the three places the numbers are stated ------------- */

  it.each(sheets)("sheet $title — header matches the rows under it", ({ title, line, header, rows }) => {
    // The counts are DERIVED from the rows; the header is a copy of a
    // derived fact, which is the thing this codebase never stores. Since
    // the header is written by hand, this is what keeps the copy honest.
    expect(
      rows,
      `Sheet ${title} (FEATURE-AUDIT.md line ${line}) disagrees with its own rows — ` +
        `${deltas(header, rows)}. Fix the header to match the rows beneath it; ` +
        `the rows are the record, the header is a summary of them.`,
    ).toEqual(header);
  });

  it("the summary table equals the sum of every sheet", () => {
    expect(
      summaryTable,
      `The | Status | Count | table disagrees with the rows — ${deltas(summaryTable, total)}. ` +
        `It said 86 built against 87 rows on main for days: it is the least-read ` +
        `of the three places and drifts first.`,
    ).toEqual(total);
  });

  it("the summary line equals the sum of every sheet", () => {
    expect(
      summaryLine,
      "Summary line missing or reworded — this test reads its exact shape: " +
        "`**N items audited — N built / N partial / N missing / N descoped**`",
    ).not.toBeNull();
    const [, gotItems, ...got] = summaryLine!;
    const stated = { built: Number(got[0]), partial: Number(got[1]), missing: Number(got[2]), descoped: Number(got[3]) };

    expect(
      { items: Number(gotItems), ...stated },
      `The summary line disagrees with the rows — ${deltas(stated, total)}` +
        (Number(gotItems) !== items(total) ? `; items: says ${gotItems}, rows have ${items(total)}` : "") +
        `. Recount from the sheets rather than picking a side: after a merge ` +
        `BOTH sides' numbers are usually wrong, because each was right before ` +
        `the other landed. Do not recount by grepping "^| Built |" — that also ` +
        `matches the summary table's own rows and overcounts by exactly four.`,
    ).toEqual({ items: items(total), ...total });
  });
});
