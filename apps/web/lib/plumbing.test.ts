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

type Counts = { built: number; partial: number; missing: number; descoped: number };
const zero = (): Counts => ({ built: 0, partial: 0, missing: 0, descoped: 0 });

/** Reads the file into per-sheet header counts and per-sheet row counts. */
function readAudit() {
  const text = readFileSync(join(REPO, "FEATURE-AUDIT.md"), "utf8");
  const sheets: { title: string; header: Counts; rows: Counts }[] = [];
  let current: (typeof sheets)[number] | null = null;

  for (const line of text.split("\n")) {
    const head = line.match(/^## (\d+\..*?) — ((?:\d+ \w+(?: · )?)+)\s*$/);
    if (head) {
      current = { title: head[1], header: zero(), rows: zero() };
      for (const [, n, word] of head[2].matchAll(/(\d+) (built|partial|missing|descoped)/g)) {
        current.header[word as keyof Counts] = Number(n);
      }
      sheets.push(current);
      continue;
    }
    const row = line.match(/^\| (Built|Partial|Missing|Descoped) \|/);
    if (row && current) {
      current.rows[row[1].toLowerCase() as keyof Counts] += 1;
    }
  }

  const summary = text.match(
    /\*\*(\d+) items audited — (\d+) built \/ (\d+) partial \/ (\d+) missing \/ (\d+) descoped\*\*/,
  );

  return { sheets, summary };
}

describe("FEATURE-AUDIT counts agree with its own rows", () => {
  const { sheets, summary } = readAudit();

  it("finds the sheets at all", () => {
    expect(sheets.length).toBeGreaterThan(20);
  });

  it.each(sheets)("$title header matches the rows under it", ({ header, rows }) => {
    // The counts are DERIVED from the rows; the header is a copy of a
    // derived fact, which is the thing this codebase never stores. Since
    // the header is written by hand, this is what keeps the copy honest.
    expect(header).toEqual(rows);
  });

  it("the summary line equals the sum of every sheet", () => {
    expect(summary, "summary line missing or reworded — this test reads its exact shape").not.toBeNull();
    const total = sheets.reduce<Counts>(
      (acc, s) => ({
        built: acc.built + s.rows.built,
        partial: acc.partial + s.rows.partial,
        missing: acc.missing + s.rows.missing,
        descoped: acc.descoped + s.rows.descoped,
      }),
      zero(),
    );
    const items = total.built + total.partial + total.missing + total.descoped;
    const [, gotItems, gotBuilt, gotPartial, gotMissing, gotDescoped] = summary!;

    expect(
      {
        items: Number(gotItems),
        built: Number(gotBuilt),
        partial: Number(gotPartial),
        missing: Number(gotMissing),
        descoped: Number(gotDescoped),
      },
      "The summary disagrees with the rows. Recount from the sheets rather " +
        "than picking a side: after a merge, BOTH sides' numbers are usually " +
        "wrong, because each was right before the other landed. This has " +
        "happened three times.",
    ).toEqual({ items, ...total });
  });
});
