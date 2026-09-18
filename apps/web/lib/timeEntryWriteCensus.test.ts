/**
 * An hour, once logged, does not move — not to another person, not to
 * another day, not to another job.
 *
 * WHAT THIS FILE USED TO CHECK, AND WHY IT CHANGED ON 2026-09-13.
 *
 * It used to assert that there was NO update path to `TimeEntry` anywhere in
 * the repo, because there wasn't one: created x13, createMany x2, delete x2,
 * deleteMany x15, reads, and zero updates. A row that can only be created and
 * deleted cannot have its `crewMemberId` reassigned, so the guarantee held by
 * construction and this file's whole job was to refuse to let that precondition
 * disappear quietly.
 *
 * It went red, as designed, when issue #63 added `updateTimeEntry`. That issue
 * is the other side of the same coin: with no update path, the only way to fix
 * "10 hours" that should have been "8" was to DELETE the row — on a
 * one-click Remove with no confirmation — so the correction path destroyed the
 * evidence it was correcting. "No updates" was never the goal; it was a cheap
 * proxy for the goal, and it cost an audit trail to keep.
 *
 * The old message said what to do about exactly this, and it is what was done:
 * PUT THE LOCK BACK IN THE DATABASE. `prova_time_entry_identity_lock`, a
 * BEFORE UPDATE trigger installed by 20260913120000_add_time_entry_correction,
 * RAISES on any UPDATE that changes `jobId`, `employeeUserId` or `date`, and on
 * a `crewMemberId` that is already set becoming a different one. That is the
 * trigger 20260905183000_add_crew_members deliberately held back, and the
 * reason it held back — TimeEntry is live payroll and nothing exercised the
 * trigger, so real rows would have met it first — is precisely what #63
 * changed: there is a correction form now, and saving a correction exercises
 * the lock on the ordinary path.
 *
 * `time-entry-correction.test.ts` is what fails the build if that trigger stops
 * naming every locked column, and if the update payload ever grows one.
 *
 * SO WHAT THIS FILE CHECKS NOW. Not "does an update exist" — one does — but
 * the two things a source scan can still answer that the trigger cannot:
 *
 *   1. every `timeEntry.update` builds its `data` with
 *      `timeEntryCorrectionUpdateData`, the one payload builder whose key set
 *      is asserted EXACTLY by a unit test. An update that assembles its own
 *      object is how a locked column gets written by somebody who never read
 *      any of this;
 *   2. no `updateMany`, no `upsert`, and no nested relation write reaching
 *      TimeEntry through another model — none of which any feature needs, and
 *      the nested one is the door the accessor pattern cannot see.
 *
 * WHAT IT CANNOT SEE, stated plainly so nobody trusts it further than it goes:
 * raw SQL (checked separately below, and only by name), and anything run
 * against Neon by hand. The trigger can see all of those, which is the point
 * of it being in the database and not here.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TIME_ENTRY_LOCKED_COLUMNS } from "./time-entry-correction";

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
const TIME_ENTRY_WRITE =
  /\btimeEntry\s*\.\s*(updateManyAndReturn|updateMany|update|upsert)\s*\(/g;

/** The one payload builder. Its output's key set is asserted exactly in
 * `time-entry-correction.test.ts`, which is what makes "goes through this"
 * worth anything. */
const PAYLOAD_BUILDER = "timeEntryCorrectionUpdateData";

/**
 * The nested-relation door, which the accessor pattern above cannot see.
 *
 * `prisma.crewMember.update({ data: { timeEntries: { connect: ... } } })`
 * REASSIGNS TimeEntry.crewMemberId and contains no `timeEntry.` accessor at
 * all. It is not a contrived evasion — "assign these hours to this crew
 * member", written from a crew-member edit page, is the most natural first
 * implementation once this model gets wired, and it is the one an adversarial
 * review actually constructed.
 *
 * The trigger DOES now catch this one at the database, which is a real
 * improvement over the note that used to be here. It is still refused in
 * source, because a nested write that the trigger rejects is a 500 on a form
 * nobody tested, and because the failure it produces names a plpgsql function
 * rather than the person who wrote the nested write.
 *
 * Five models carry a `timeEntries` back-relation (crew, company, labor and
 * two in jobs) — six as of #63, since User gained `correctedTimeEntries` —
 * so there are that many such doors.
 *
 * Only WRITE verbs are listed. A read — `include: { timeEntries: { where } }`,
 * `select: { timeEntries: true }` — uses none of them, so this does not fire
 * on the many legitimate reads.
 */
const NESTED_TIME_ENTRY_WRITE =
  /\btimeEntries\s*:\s*\{[\s\S]{0,300}?\b(connect|connectOrCreate|disconnect|set|update|updateMany|upsert|create|createMany|delete|deleteMany)\s*:/;

/**
 * This file scans itself, and its own failure messages — and now its own
 * POSITIVE CONTROLS — necessarily contain examples of every shape it hunts
 * for. Comment-stripping does not help: the examples live in STRING
 * LITERALS, which are code.
 *
 * So it is excluded from its own scan, structurally, by path — NOT via
 * EXCEPTIONS. An EXCEPTIONS entry disarms a file for a REASON somebody
 * argued; this is a self-reference, and putting it in the same list would
 * teach the next reader that adding files there is normal. That is the
 * exact spiral PR #176's census fell into.
 *
 * The cost is real and small: a genuine TimeEntry write added to THIS file
 * would not be caught. It is a test file for a census; nothing writes from
 * here.
 */
const SELF = "apps/web/lib/timeEntryWriteCensus.test.ts";

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

/**
 * The text between the parentheses of a call starting at `index`.
 *
 * Balanced rather than "the next 400 characters", because a Prisma call's
 * argument object is nested and a fixed window either stops inside it (and
 * misses the `data`) or runs past it (and reads the next statement). If the
 * parentheses never balance it returns the REST of the file: an unparseable
 * call has to look like an offender, never like a clean one. That is the
 * empty-question failure mode CLAUDE.md names — a parser that finds nothing
 * passes every assertion downstream of it.
 */
function callArguments(source: string, index: number): string {
  const open = source.indexOf("(", index);
  if (open === -1) return source.slice(index);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "(") depth += 1;
    else if (source[i] === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return source.slice(open);
}

type Scanned = { path: string; source: string };

/** Every TimeEntry write call in a file, with its arguments. */
function timeEntryWrites(file: Scanned) {
  return [...file.source.matchAll(TIME_ENTRY_WRITE)].map((match) => ({
    verb: match[1],
    args: callArguments(file.source, match.index ?? 0),
  }));
}

const LOCKED_KEY = new RegExp(`\\b(${TIME_ENTRY_LOCKED_COLUMNS.join("|")})\\s*:`);

/** Update call sites that either assemble their own payload or name a locked
 * column anywhere in the call. Exported shape kept tiny on purpose: the two
 * tests below and the positive controls all go through this one function, so
 * a control proving it CAN flag is a control over the real check. */
function offendingWrites(files: Scanned[]) {
  const out: string[] = [];
  for (const file of files) {
    for (const write of timeEntryWrites(file)) {
      if (write.verb !== "update") {
        out.push(`${file.path}: ${write.verb} — no feature needs a bulk or upserting write to payroll`);
        continue;
      }
      if (!write.args.includes(PAYLOAD_BUILDER)) {
        out.push(`${file.path}: update builds its own data instead of using ${PAYLOAD_BUILDER}()`);
      }
      const locked = LOCKED_KEY.exec(write.args);
      if (locked) {
        out.push(`${file.path}: update names the locked column "${locked[1]}"`);
      }
    }
  }
  return out;
}

const EXCEPTIONS: Record<string, string> = {
  // Intentionally empty. A line here means somebody decided TimeEntry may be
  // written from that file in a way this census refuses; write the reason,
  // and say what stops the job, the person, the day or the crew member being
  // reassigned by it.
};

describe("the TimeEntry write census", () => {
  const files = [...sourceFiles(appDir), ...sourceFiles(scriptsDir)]
    .map((full) => ({
      path: relative(repoRoot, full),
      source: stripComments(readFileSync(full, "utf8")),
    }))
    .filter((f) => f.path !== SELF);

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
    // and every pattern silently stops matching, the census below would go
    // quiet rather than red. This asserts the corpus really does contain
    // TimeEntry work for the scan to have looked at.
    const mentions = files.filter((f) => /\btimeEntry\s*\./.test(f.source));
    expect(mentions.length).toBeGreaterThan(0);
  });

  it("finds the one update path that exists, so the checks below are not scanning zero calls", () => {
    // The size assertion. Until #63 this file's guarantee was "no updates",
    // and the checks below would all pass vacuously if the correction path
    // were deleted, renamed, or moved somewhere this scan cannot read — which
    // reads exactly like a clean census.
    const writes = files.flatMap((f) => timeEntryWrites(f).map((w) => `${f.path}: ${w.verb}`));
    expect(writes).toEqual(["apps/web/lib/actions/labor.ts: update"]);
  });

  it("CAN flag a bad write — the positive control for the two checks below", () => {
    /* Synthetic offenders, because a check whose only evidence is that it
       found nothing is the failure this repo has paid for four times over
       (green `gh pr checks` on a commit nobody asked about; a watcher whose
       needle was already on the page; a guard that parsed nothing and passed
       thirteen assertions). These three strings are what the real pattern is
       run against, through the same function, so the control is over the
       check and not over a copy of it. */
    const planted: Scanned[] = [
      {
        path: "fake/hand-rolled.ts",
        source: 'await prisma.timeEntry.update({ where: { id }, data: { hours: "8" } });',
      },
      {
        path: "fake/reassigns.ts",
        source: `await prisma.timeEntry.update({ where: { id }, data: ${PAYLOAD_BUILDER}(f, u, now), date: newDate });`,
      },
      { path: "fake/bulk.ts", source: "await prisma.timeEntry.updateMany({ data: { payType: p } });" },
    ];

    const flagged = offendingWrites(planted);
    expect(flagged).toHaveLength(3);
    expect(flagged[0]).toContain("builds its own data");
    expect(flagged[1]).toContain('locked column "date"');
    expect(flagged[2]).toContain("updateMany");

    // And the real shape is NOT flagged, so the check is discriminating
    // rather than merely noisy.
    expect(
      offendingWrites([
        {
          path: "fake/correction.ts",
          source: `await prisma.timeEntry.update({ where: { id: entry.id }, data: ${PAYLOAD_BUILDER}(figures, user.id, new Date()) });`,
        },
      ]),
    ).toEqual([]);
  });

  it("writes TimeEntry only through the audited correction payload", () => {
    const offenders = offendingWrites(files.filter((f) => !(f.path in EXCEPTIONS)));

    expect(
      offenders,
      offenders.length === 0
        ? ""
        : [
            "",
            "A TimeEntry write is not going through the one audited path.",
            "",
            "Seven columns on this table are LOCKED after creation — jobId,",
            "employeeUserId, crewMemberId, date, and the clock-capture evidence",
            "clockStartedAt, clockEndedAt, clockBreakMinutes. The identity four",
            "are what a WH-347 line is keyed by: the project, the named person,",
            "the day worked. An UPDATE that changes any of them does not correct",
            "a record, it silently turns it into a different one, and a filing",
            "already sent would disagree with the data with nothing anywhere to",
            "show that they ever agreed.",
            "",
            `So every update passes its data through ${PAYLOAD_BUILDER}(), whose`,
            "key set is asserted EXACTLY in time-entry-correction.test.ts — not as",
            "a subset, because a subset check would pass just as happily with",
            "`date` in the payload.",
            "",
            "The database refuses these too: prova_time_entry_identity_lock, a",
            "BEFORE UPDATE trigger from 20260913120000_add_time_entry_correction,",
            "RAISES on any of the seven. That is the enforcement and this is the",
            "manners — a write the trigger rejects is a 500 on a form nobody",
            "tested, naming a plpgsql function instead of the person who wrote it.",
            "",
            "If you need to correct a figure this payload does not carry, add it",
            "there and to TIME_ENTRY_CORRECTABLE_KEYS, and argue it in that file",
            "— that is one decision in one place, which is the whole arrangement.",
            "",
            "If a locked name here is a `where` FILTER rather than a write, that",
            "is a limit of this pattern rather than a bug in your code: say so in",
            "EXCEPTIONS, or make the pattern read the data clause only.",
            "",
          ].join("\n"),
    ).toEqual([]);
  });

  it("has no nested relation write reaching TimeEntry through another model", () => {
    const offenders = files
      .filter((f) => !(f.path in EXCEPTIONS))
      .filter((f) => NESTED_TIME_ENTRY_WRITE.test(f.source))
      .map((f) => f.path);

    expect(
      offenders,
      offenders.length === 0
        ? ""
        : [
            "",
            "A nested relation write can reach TimeEntry without ever naming the",
            "`timeEntry.` accessor:",
            "",
            "  prisma.crewMember.update({",
            "    where: { id: newCrewId },",
            "    data: { timeEntries: { connect: { id: entryId } } },",
            "  })",
            "",
            "That reassigns TimeEntry.crewMemberId. The CrewMember identity trigger",
            "does NOT stop it — that trigger fires on the parent UPDATE and passes,",
            "because no identity column changed. The TimeEntry trigger added in",
            "20260913120000_add_time_entry_correction DOES stop it, at the cost of",
            "a raised exception on a form somebody shipped.",
            "",
            "Correct a figure through updateTimeEntry. Re-attributing an hour is a",
            "delete and a re-entry, which is what the two-step Remove is for.",
            "",
            "If this is a READ (include/select) that happens to match, that is a bug",
            "in this pattern rather than in your code — say so in EXCEPTIONS and fix",
            "the pattern.",
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
            "If it writes one of the locked columns the trigger will refuse it at",
            "runtime — read the census message above for which columns and why. If it",
            "only reads, add it to EXCEPTIONS with that reason.",
            "",
          ].join("\n"),
    ).toEqual([]);
  });
});
