import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Issue #101: no date is rendered without saying which zone it is in.
 *
 * The nine sites #101 listed were not the first of their kind — this app
 * had already fixed the same bug twice, in components/fieldReportWeeks.ts
 * and components/equipmentDeployment.ts, and both fixes are still there
 * and still correct. Neither stopped the next one, because a fix at a call
 * site protects that call site and nothing else. So the rule is enforced
 * here instead: every `toLocaleDateString` and every `new
 * Intl.DateTimeFormat` in this app states a `timeZone`, and there is no
 * allowlist to add yourself to.
 *
 * WHAT A BARE CALL ACTUALLY DOES, since it looks harmless and is not:
 * it formats in whatever zone the JavaScript is running in. Server
 * component on Vercel, that is UTC and a UTC-midnight column is right by
 * accident — nothing in this repo pins `TZ`. Client component, that is the
 * reader's zone and the same column is a day early for all of North
 * America.
 */

const ROOT = join(__dirname, "..");
const SKIP_DIRS = new Set(["node_modules", ".next", ".turbo", "dist", "coverage"]);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry) && !/\.(test|dbtest)\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Comments blanked out, string and template literals left alone.
 *
 * Written as a scanner rather than two regexes because the regex version
 * of this is wrong in a way that passes: `//[^\n]*` deletes the second
 * half of every `"https://..."` in the file. Issue #185 is the same
 * lesson from the other side — a census that reads comments as code can be
 * disarmed by a comment; one that mangles strings while stripping them
 * silently changes what it is looking at.
 *
 * Newlines are preserved so reported line numbers are the real ones.
 */
function stripComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += c;
      i += 1;
      while (i < source.length) {
        if (source[i] === "\\") {
          out += source[i] + (source[i + 1] ?? "");
          i += 2;
          continue;
        }
        out += source[i];
        if (source[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] === "\n") out += "\n";
        i += 1;
      }
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** The balanced argument list starting at the `(` at `open`. */
function argsAt(source: string, open: number): string {
  let depth = 0;
  for (let k = open; k < source.length; k += 1) {
    const c = source[k];
    if (c === "(" || c === "[" || c === "{") depth += 1;
    else if (c === ")" || c === "]" || c === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, k + 1);
    }
  }
  return source.slice(open);
}

const CALL = /\.toLocaleDateString\s*\(|new\s+Intl\.DateTimeFormat\s*\(/g;

type Call = { file: string; line: number; args: string };

function callsIn(file: string, stripped: string): Call[] {
  const found: Call[] = [];
  for (const m of stripped.matchAll(CALL)) {
    const open = stripped.indexOf("(", m.index!);
    found.push({
      file,
      line: stripped.slice(0, m.index!).split("\n").length,
      args: argsAt(stripped, open),
    });
  }
  return found;
}

/**
 * Does this call state a zone?
 *
 * The literal case is `{ ..., timeZone: x }` inline. The other case is an
 * options object held in a variable — components/fieldReportWeeks.ts
 * shares one `opts` between two calls, which is correct code that a
 * text search cannot see into. So a bare identifier is RESOLVED against
 * its own declaration in the same file, and a declaration that cannot be
 * found is a FAILURE rather than a pass. That direction matters: the
 * cheap version of this rule ("assume an identifier is fine") turns one
 * unreadable argument into a hole anyone can drive a bare call through.
 */
function statesZone(call: Call, stripped: string): boolean {
  if (/\btimeZone\b/.test(call.args)) return true;
  const inner = call.args.slice(1, -1);
  const parts = inner.split(",");
  const last = parts[parts.length - 1]?.trim() ?? "";
  if (!/^[A-Za-z_$][\w$]*$/.test(last)) return false;
  const decl = new RegExp(`\\b(?:const|let|var)\\s+${last}\\s*(?::[^=]+)?=\\s*\\{`).exec(stripped);
  if (!decl) return false;
  return /\btimeZone\b/.test(argsAt(stripped, stripped.indexOf("{", decl.index)));
}

const FILES = sourceFiles(ROOT);
const STRIPPED = new Map(FILES.map((f) => [f, stripComments(readFileSync(f, "utf8"))]));
const CALLS = FILES.flatMap((f) => callsIn(f, STRIPPED.get(f)!));

describe("every rendered date states its timezone (#101)", () => {
  it("finds the app's source files", () => {
    // Vacuity guard. A walker that returns nothing makes every assertion
    // below trivially true.
    expect(FILES.length).toBeGreaterThan(200);
  });

  it("parses as many calls as the raw text contains", () => {
    // THE SIZE CROSS-CHECK, and the reason it is not optional: a check
    // that DERIVES its input has two failure modes, and only one of them
    // looks like a failure. If `CALL` stops matching -- a rename, a
    // formatter putting a newline somewhere new -- the set silently
    // empties and nothing is ever missing from an empty list. So the
    // count is taken a second way, by counting the method names as plain
    // text, and the two must agree.
    //
    // This is the check that caught the last two censuses in this repo:
    // scratch-cleanup-order.test.ts parsed 180 foreign keys out of 181,
    // and ownerRefusalCensus parsed 35 of 36.
    let literal = 0;
    for (const stripped of STRIPPED.values()) {
      literal += (stripped.match(/toLocaleDateString/g) ?? []).length;
      literal += (stripped.match(/new\s+Intl\.DateTimeFormat/g) ?? []).length;
    }
    expect(CALLS.length).toBe(literal);
    expect(CALLS.length).toBeGreaterThan(15);
  });

  it("has no call that leaves the zone to the runtime", () => {
    const bare = CALLS.filter((c) => !statesZone(c, STRIPPED.get(c.file)!)).map(
      (c) => `${c.file.slice(ROOT.length + 1)}:${c.line}`,
    );
    expect(bare).toEqual([]);
  });

  it("routes the two kinds of date through lib/render-date.ts", () => {
    // The formatter is the thing a new call site is supposed to reach for,
    // so it has to exist and export both halves of the distinction --
    // otherwise the rule above is satisfiable only by hand-writing
    // `timeZone` forever, which is what it replaced.
    const mod = readFileSync(join(ROOT, "lib/render-date.ts"), "utf8");
    expect(mod).toMatch(/export function formatCalendarDate\(/);
    expect(mod).toMatch(/export function formatInstant\(/);
  });
});
