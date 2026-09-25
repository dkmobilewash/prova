import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * NOTHING IS CLEARED UNTIL THE WRITE IS ON THE QUEUE.
 *
 * This is the rule #490 is about, and until now it was the one thing
 * neither of its guards checked. `queued-writes.test.ts` asserts that a
 * screen calls `saveQueued` rather than `enqueue`, and that an error state
 * it declares is drawn. Both can be true of a function that still does
 * this:
 *
 *     setTopic("");
 *     setShowTalkForm(false);
 *     const saved = await saveQueued(op);     // fails
 *     if (!saved.ok) return setError(saved.error);
 *
 * The message appears, and the typed words are already gone. Proved by
 * mutation: restoring exactly that order at a fixed site left all 311
 * mobile tests green.
 *
 * So the ordering was applied correctly at ten sites and missed at four,
 * and the four were found by loading the screens in a browser rather than
 * by anything in this directory:
 *
 *   - `reports/[jobId].tsx` `submitReport` — the daily field report; it
 *     cleared three fields and closed the sheet, then threw away the
 *     `{ ok }` that `create` returns for precisely this.
 *   - `reports/[jobId].tsx` `submitDelay` — the delay record, with a
 *     comment above it claiming it did the opposite.
 *   - `time/[jobId].tsx` `submit` — a whole crew's hours.
 *   - `time/[jobId].tsx` `closeInterval` — which returned `true`
 *     unconditionally, so `onClockOut` went on to `clearSession()` and
 *     erased `clockStartedAt`: a 4h 0m shift gone, queue empty, screen
 *     reading "Not on the clock".
 *
 * WHAT THIS FILE CHECKS. For every function that awaits a queued write, no
 * statement that CLEARS something a person typed, or closes the sheet they
 * typed it into, may run before that await.
 *
 * Three things keep it from going quietly blind, which is the failure mode
 * CLAUDE.md records for every deriving check in this repo:
 *
 *   SIZE  — the number of write call sites the brace parser attributes to
 *           functions must equal the number counted independently, by a
 *           plain scan of the same comment-stripped text. A parser that
 *           stops matching then fails loudly instead of finding nothing to
 *           complain about.
 *   SCOPE — the directories walked are DERIVED from the filesystem: every
 *           directory under `apps/mobile` that holds source. A guard whose
 *           roots are three hardcoded names cannot see a fourth, and that
 *           is not a small set, it is not in the set at all (CLAUDE.md, the
 *           theme-contrast scar). `hooks/` was invisible to the other two
 *           guards until this was written.
 *   COMMENTS — every pattern runs on comment-stripped source. A comment
 *           quoting the pattern has disarmed a guard in this repo three
 *           times now, most recently both of #490's own.
 */

const root = join(__dirname, "..");

/** Directories that hold no app source. Everything else under `apps/mobile`
 * is walked, so a new source directory is in scope the day it is created
 * rather than the day somebody remembers this file. */
const NOT_SOURCE = new Set(["node_modules", "assets", "android", "ios", ".expo", ".turbo", ".maestro"]);

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (NOT_SOURCE.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

/** Every directory directly under `apps/mobile` that holds any source. */
function sourceRoots(): string[] {
  return readdirSync(root)
    .filter((entry) => !NOT_SOURCE.has(entry))
    .filter((entry) => statSync(join(root, entry)).isDirectory())
    .filter((entry) => listFiles(join(root, entry)).some((f) => f.endsWith(".ts") || f.endsWith(".tsx")))
    .sort();
}

const sources = sourceRoots()
  .flatMap((dir) => listFiles(join(root, dir)))
  .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
  .filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"))
  .sort();

/** Comments are prose, and prose is not code. Both forms, including a
 * comment trailing a statement — `queued-writes.test.ts` stripped only
 * whole-line `//` and `offline-notes.test.ts` stripped none at all, which
 * is how a `{/* rendered above as {saveError} *\/}` turned a red guard
 * green. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** The helper every queued write goes through. Named once, from the module
 * that exports it, so a rename breaks this file rather than emptying it. */
const WRITE_HELPER = "saveQueued";

/**
 * The calls that PUT A WRITE ON THE QUEUE, per file.
 *
 * `saveQueued` itself, plus anything in the same file that wraps it and
 * hands back its result — `saveEntry` in the time screen — plus the two
 * writers `useFieldReports` exposes, which are derived from that module's
 * own `Promise<SaveResult>` signatures rather than listed here.
 */
function hookWriters(): string[] {
  const text = withoutComments(readFileSync(join(root, "lib/use-field-reports.ts"), "utf8"));
  return [...text.matchAll(/const (\w+) = useCallback\(\s*async[^)]*\)\s*:\s*Promise<SaveResult>/g)].map(
    (m) => m[1],
  );
}

function writeCallsIn(file: string, code: string): string[] {
  const names = new Set([WRITE_HELPER]);
  // A local wrapper: `const saveEntry = async (…): Promise<SaveResult> =>`
  for (const m of code.matchAll(/const (\w+) = async[^;]*?Promise<SaveResult>/g)) names.add(m[1]);
  // The hook's writers, but only where this file actually takes them.
  if (/useFieldReports\s*\(/.test(code)) for (const name of hookWriters()) names.add(name);
  return [...names].filter((n) => new RegExp(`await\\s+${n}\\s*\\(`).test(code));
}

/**
 * Statements that take back what somebody typed, or the sheet they typed it
 * into. Deliberately narrow: `setX("")`, `setX(null)`, `setX([])`,
 * `setShowX(false)` and a navigation away. A check that flagged every setter
 * would be turned off within a week.
 *
 * CLEARING AN ERROR IS NOT CLEARING INPUT, and the first draft of this file
 * did not distinguish them: it flagged `setSaveError(null)` at the top of
 * the very functions this rule was written to fix. Wiping a stale message
 * before starting is correct and is what stops an old failure hanging over a
 * new attempt, so error state is excluded by name.
 */
const CLEARS =
  /\bset(?!\w*[Ee]rror\b)[A-Z]\w*\(\s*(?:""|''|``|null|\[\]|false)\s*\)|\brouter\.(?:replace|push|back|navigate)\s*\(/g;

/**
 * Every function body in the file, by brace matching.
 *
 * It matches ARROW bodies as well as named ones, because the two writers
 * this rule cares most about are `useCallback(async (…) => {` — the first
 * draft only understood `const x = …{` and `function x(){`, so both of
 * `useFieldReports`' writers were attributed to the hook itself and its
 * unrelated `setLoading(false)` was reported as an offender.
 */
const CONTROL_BLOCK = /^(?:if|for|while|switch|catch|else)$/;

/** The keyword owning the `(...)` that closes just before `at`, if any. */
function precedingKeyword(code: string, at: number): string {
  let i = at - 1;
  while (i >= 0 && /\s/.test(code[i])) i -= 1;
  if (code[i] !== ")") return "";
  let depth = 0;
  for (; i >= 0; i -= 1) {
    if (code[i] === ")") depth += 1;
    else if (code[i] === "(") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  let j = i - 1;
  while (j >= 0 && /\s/.test(code[j])) j -= 1;
  let end = j + 1;
  while (j >= 0 && /[A-Za-z]/.test(code[j])) j -= 1;
  return code.slice(j + 1, end);
}

function functionBodies(code: string): { name: string; start: number; end: number }[] {
  const out: { name: string; start: number; end: number }[] = [];
  for (let i = 0; i < code.length; i += 1) {
    if (code[i] !== "{") continue;
    const before = code.slice(Math.max(0, i - 400), i);
    // A function body opens right after `=>` or after a parameter list.
    if (!/(?:=>|\))\s*$/.test(before)) continue;
    // …but `for (…) {` and `if (…) {` also end in `)`, and treating a loop
    // body as a function put the write in `time`'s `submit` inside the for
    // block instead, so the clears above the loop were never examined and
    // the sentinel below caught it.
    if (/\)\s*$/.test(before) && CONTROL_BLOCK.test(precedingKeyword(code, i))) continue;
    let depth = 0;
    let end = -1;
    for (let j = i; j < code.length; j += 1) {
      if (code[j] === "{") depth += 1;
      else if (code[j] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end === -1) continue;
    const named = /(?:const|function)\s+(\w+)[^;{]*$/.exec(before);
    out.push({ name: named ? named[1] : "(anonymous)", start: i, end });
  }
  return out;
}

/** The smallest function body containing `at` — the function that actually
 * owns the write, rather than every hook and component wrapped around it. */
function ownerOf(bodies: { name: string; start: number; end: number }[], at: number) {
  const containing = bodies.filter((b) => b.start <= at && at <= b.end);
  if (containing.length === 0) return null;
  return containing.reduce((a, b) => (b.end - b.start < a.end - a.start ? b : a));
}

type Site = { file: string; fn: string; cleared: string | null };

function sites(): Site[] {
  const found: Site[] = [];
  for (const file of sources) {
    const rel = file.slice(root.length + 1);
    if (rel === "lib/save-queued.ts") continue; // the helper defines it
    const code = withoutComments(readFileSync(file, "utf8"));
    const writers = writeCallsIn(file, code);
    if (writers.length === 0) continue;
    const bodies = functionBodies(code);
    const awaitWrite = new RegExp(`await\\s+(?:${writers.join("|")})\\s*\\(`, "g");
    // ONE SITE PER WRITE CALL, attributed to the smallest function around it.
    // The count of these is what the size assertion below compares against a
    // plain scan of the same text.
    for (const m of code.matchAll(awaitWrite)) {
      const owner = ownerOf(bodies, m.index!);
      if (!owner) continue;
      const before = code.slice(owner.start, m.index!);
      const cleared = [...before.matchAll(CLEARS)].map((c) => c[0].trim());
      found.push({ file: rel, fn: owner.name, cleared: cleared.length ? cleared.join(", ") : null });
    }
  }
  return found;
}

describe("the scan can see the app", () => {
  it("derives its roots from the filesystem, and they all exist", () => {
    const roots = sourceRoots();
    // A hardcoded list is how `hooks/` stayed invisible to the other two
    // guards; this is the assertion that a new directory cannot hide.
    expect(roots, "the source roots are not derived").toContain("app");
    expect(roots).toContain("components");
    expect(roots).toContain("lib");
    for (const dir of roots) expect(statSync(join(root, dir)).isDirectory()).toBe(true);
  });

  it("scans a real set of files", () => {
    expect(sources.length, "the file walk found almost nothing").toBeGreaterThan(40);
    expect(
      sources.some((f) => f.endsWith(join("app", "time", "[jobId].tsx"))),
      "the walk is missing the screen with the most queued writes",
    ).toBe(true);
  });

  it("knows which calls are queued writes, and does not have to be told", () => {
    const time = withoutComments(readFileSync(join(root, "app/time/[jobId].tsx"), "utf8"));
    expect(writeCallsIn("app/time/[jobId].tsx", time), "the local wrapper was not derived").toContain(
      "saveEntry",
    );
    const reports = withoutComments(readFileSync(join(root, "app/reports/[jobId].tsx"), "utf8"));
    expect(writeCallsIn("app/reports/[jobId].tsx", reports), "the hook's writers were not derived").toContain(
      "create",
    );
    expect(hookWriters().sort(), "useFieldReports' writers").toEqual(["create", "update"]);
  });

  it("attributes every write call site to a function", () => {
    // THE SIZE ASSERTION, counted a second way that cannot drift with the
    // brace parser: every `await <writer>(` in the same comment-stripped
    // text. If the parser breaks, the two numbers disagree and this says so,
    // instead of every case below passing on an empty set.
    let counted = 0;
    for (const file of sources) {
      const rel = file.slice(root.length + 1);
      if (rel === "lib/save-queued.ts") continue;
      const code = withoutComments(readFileSync(file, "utf8"));
      const writers = writeCallsIn(file, code);
      if (writers.length === 0) continue;
      counted += [...code.matchAll(new RegExp(`await\\s+(?:${writers.join("|")})\\s*\\(`, "g"))].length;
    }
    expect(counted, "no queued write was found at all — the pattern has stopped matching").toBeGreaterThan(
      10,
    );
    expect(
      sites().length,
      `the parser attributed ${sites().length} write sites to functions but the text holds ${counted}`,
    ).toBe(counted);
  });
});

describe("no screen clears what somebody typed before the write lands", () => {
  it("leaves nothing cleared ahead of the await", () => {
    const offenders = sites()
      .filter((s) => s.cleared !== null)
      .map((s) => `${s.file} ${s.fn}(): ${s.cleared}`);
    expect(
      offenders,
      `these clear the form or close the sheet BEFORE the queued write is known to have landed, so a phone that cannot write to its own storage swallows what was typed: ${offenders.join(" | ")}`,
    ).toEqual([]);
  });

  it("is looking at the functions it means to", () => {
    // Vacuity guard with teeth: the four sites this rule was written from
    // must each still be a function this file examines. If one is renamed
    // away, that is a change worth failing over rather than silently
    // dropping from the census.
    const examined = sites().map((s) => `${s.file} ${s.fn}`);
    for (const site of [
      "app/time/[jobId].tsx closeInterval",
      "app/time/[jobId].tsx submit",
      "app/reports/[jobId].tsx submitReport",
      "app/reports/[jobId].tsx submitDelay",
    ]) {
      expect(examined, `${site} is no longer covered by this rule`).toContain(site);
    }
  });
});
