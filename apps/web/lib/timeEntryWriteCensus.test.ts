/**
 * An hour, once attributed to a crew member, does not change hands.
 *
 * THIS GUARANTEE USED TO BE A DATABASE TRIGGER AND IS NOW THIS FILE. That
 * is a downgrade, deliberately taken, and the reason is written into
 * `20260905183000_add_crew_members/migration.sql` where the trigger was:
 * `prova_time_entry_crew_member_lock` was a BEFORE UPDATE trigger on
 * `TimeEntry`, which is a LIVE PAYROLL TABLE carrying real production rows.
 * Shipping an unclicked trigger onto live payroll is the one category where
 * being wrong is not an afternoon, so it came out.
 *
 * WHY THE GUARANTEE MATTERS AT ALL. Locking a CrewMember's legal name is
 * worth nothing if the TimeEntry can be repointed at a DIFFERENT CrewMember
 * afterwards: the hours on an already-filed certified payroll would move
 * from one named person to another, and the filing and the data would
 * disagree with nothing anywhere to show they had ever agreed. These rows
 * end up on a WH-347 signed under penalty of perjury.
 *
 * WHAT THIS FILE ACTUALLY CHECKS, and it is not the guarantee itself. It
 * checks the PRECONDITION the guarantee currently rests on: that there is
 * no update path to `TimeEntry` at all. CLAUDE.md records this was
 * established call site by call site — create x13, createMany x2, delete
 * x2, deleteMany x15, findMany x6, findUnique x1, count x3, aggregate x1,
 * and ZERO updates. A row that is only ever created and deleted cannot have
 * its `crewMemberId` reassigned, so today nothing can break the rule.
 *
 * This starts GREEN and goes RED the moment somebody adds the update path
 * that would make reassignment possible. That is the whole job: it does not
 * enforce the rule, it refuses to let the precondition disappear quietly.
 *
 * WHAT IT CANNOT SEE, stated plainly so nobody trusts it further than it
 * goes. A source scan cannot catch:
 *   - raw SQL (`$executeRaw`, `$executeRawUnsafe`, `$queryRaw`) — checked
 *     separately below, but only by name;
 *   - a nested write reaching TimeEntry through another model's update;
 *   - anything run against Neon by hand, from a psql prompt or the console.
 * The trigger could see all of those. This cannot. If `crewMemberId` ever
 * becomes writable through a form, put the lock back in the database —
 * that is the right home for it, and the only reason it is not there today
 * is that a trigger on live payroll wanted a person's ruling first.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appDir = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
/** Scripts talk to Neon directly and several already do bulk deletes, so
 * they are the largest hole a scan limited to apps/web would leave. */
const scriptsDir = join(repoRoot, "packages/db/scripts");

const SKIP_DIRS = new Set(["node_modules", ".next", "dist", ".turbo"]);

function sourceFiles(dir: string, out: string[] = []): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

/**
 * `prisma.timeEntry.update(`, `.updateMany(`, `.upsert(`, and the same
 * through a transaction handle (`tx.timeEntry.update(`).
 *
 * Deliberately matches on the MODEL ACCESSOR rather than on a variable
 * name, so it does not care whether the client is called `prisma`, `db` or
 * `tx`.
 */
const TIME_ENTRY_WRITE = /\btimeEntry\s*\.\s*(update|updateMany|upsert)\s*\(/g;

/** Raw SQL naming the table. Cannot prove intent, only that it is worth a
 * human reading the call — which is why the message says so. */
/*
 * NOT /g, and that is a fix rather than a style choice.
 *
 * This regex is used with `.test()` inside a `.filter()` over every file. A
 * /g regex carries `lastIndex` between calls, and `.test()` only resets it
 * when it FAILS — so after a file matches, the next file is searched from
 * the previous match's offset instead of from 0, and a match before that
 * offset is not seen.
 *
 * Reproduced on real files before removing the flag: raw SQL planted at the
 * END of lib/actions/labor.ts and at the START of lib/actions/materialOrders.ts
 * (its immediate neighbour in scan order) reported ONLY labor.ts, while the
 * control — the same planted SQL in materialOrders.ts alone — reported it
 * correctly. The census still went red, so this could not hide an offender
 * outright; it under-reported one, which is the same shape of "guard that
 * looks like more protection than it gives" this file exists to avoid.
 */
const RAW_SQL_TIME_ENTRY = /\$(?:execute|query)Raw(?:Unsafe)?[\s\S]{0,200}?"?TimeEntry"?/;

/** Comments are stripped before scanning. PR #176's census was silently
 * disarmed for a whole file because an explanatory comment contained the
 * literal pattern it looked for — the prose satisfied the regex and the
 * assertion stopped depending on the code. Do not remove this. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const EXCEPTIONS: Record<string, string> = {
  // Intentionally empty. A line here means somebody decided TimeEntry may
  // be updated from that file; write the reason and say what stops
  // crewMemberId being reassigned by it.
};

describe("the TimeEntry write census", () => {
  const files = [...sourceFiles(appDir), ...sourceFiles(scriptsDir)].map((full) => ({
    path: relative(repoRoot, full),
    source: stripComments(readFileSync(full, "utf8")),
  }));

  it("finds the app AND the db scripts, so an empty sweep cannot pass by accident", () => {
    // The failure this guards is the one rowActionsCensus guards too: a
    // scan that silently walks zero files passes, and reads exactly like a
    // scan that found nothing wrong.
    expect(files.length).toBeGreaterThan(50);
    const paths = files.map((f) => f.path);
    expect(paths).toContain("apps/web/lib/actions/labor.ts");
    expect(paths.some((p) => p.startsWith("packages/db/scripts/"))).toBe(true);
  });

  it("proves the scan can see a TimeEntry call at all", () => {
    // Guards the guard from the other side. If the accessor is ever renamed
    // and every pattern silently stops matching, the census above would go
    // quiet rather than red. This asserts the corpus really does contain
    // TimeEntry work for the scan to have looked at.
    const mentions = files.filter((f) => /\btimeEntry\s*\./.test(f.source));
    expect(mentions.length).toBeGreaterThan(0);
  });

  it("has no update, updateMany or upsert path to TimeEntry", () => {
    const offenders = files
      .filter((f) => !(f.path in EXCEPTIONS))
      .map((f) => ({ path: f.path, hits: [...f.source.matchAll(TIME_ENTRY_WRITE)].map((m) => m[1]) }))
      .filter((f) => f.hits.length > 0)
      .map((f) => `${f.path} (${[...new Set(f.hits)].join(", ")})`);

    expect(
      offenders,
      offenders.length === 0
        ? ""
        : [
            "",
            "Something can now UPDATE a TimeEntry, and until this commit nothing could.",
            "",
            "That matters because of one field. `TimeEntry.crewMemberId` must be",
            "one-way: NULL -> a crew member id is how an entry gets attributed, and",
            "anything after that is a reassignment. Hours on an already-filed",
            "certified payroll would move from one named person to another, and the",
            "filing and the data would disagree with nothing to show they ever agreed.",
            "A misattributed entry is DELETED and re-entered — which is what",
            "deleteTimeEntry already does.",
            "",
            "This was a BEFORE UPDATE trigger in the database until",
            "20260905183000_add_crew_members. It was removed because a trigger on a",
            "live payroll table, shipped unclicked, wanted a person's ruling first.",
            "This census is the weaker replacement, and it only works while no update",
            "path exists at all.",
            "",
            "So if you are adding one: put the lock back in the database. That is the",
            "right home for it and the migration comment says how. Do not add a",
            "check in the action and call it done — an action-layer rule is exactly",
            "what this repo's 'written, documented, and never called' scar is about.",
            "",
            "If it genuinely cannot touch crewMemberId, add the file to EXCEPTIONS in",
            "this file with the reason and what stops it.",
            "",
          ].join("\n"),
    ).toEqual([]);
  });

  it("has no raw SQL writing TimeEntry, which no scan of Prisma calls could see", () => {
    const offenders = files
      .filter((f) => !(f.path in EXCEPTIONS))
      .filter((f) => RAW_SQL_TIME_ENTRY.test(f.source))
      .map((f) => f.path);

    expect(
      offenders,
      offenders.length === 0
        ? ""
        : [
            "",
            "Raw SQL naming TimeEntry. This cannot tell a SELECT from an UPDATE, so",
            "it is asking a human to read the call rather than accusing it.",
            "",
            "If it writes crewMemberId, see the message on the census above: the lock",
            "belongs in the database. If it only reads, add it to EXCEPTIONS with",
            "that reason.",
            "",
          ].join("\n"),
    ).toEqual([]);
  });
});
