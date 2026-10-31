import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A SUPPLIER QUOTE, AN ADDENDUM AND A SPEC SECTION ARE THE PROJECT'S — SO NO
 * QUERY ON THEM ASKS "WHICH WERE FILED UNDER THIS INVITATION".
 *
 * Which papers an invitation shows is decided in one place,
 * `lib/estimating/bid-papers.ts` (`paperWhere`, `paperWhereMany`,
 * `paperWhereForJob`). A `where: { bidInvitationId }` on one of these three
 * models is the OLD question, and it is a silent defect rather than a crash: GC
 * B's row simply shows nothing, or an edit from GC B's row reports "no longer on
 * this bid", exactly as it did before this change. A new reader written from
 * habit would pass every test that seeds one GC.
 *
 * What this reads is SOURCE, comments stripped (this repo's house style
 * explains its history, and a comment that quotes the old `where` must neither
 * count as a call nor disarm the scan). It proves no `where` in a call on these
 * three models names `bidInvitationId`. It does NOT see a `where` built in a
 * variable and passed by name, or raw SQL; `refilePapers` builds its own
 * `filedHere` that way on purpose, since "everything filed under this
 * invitation" is the one place that IS the right question.
 *
 * THE SIZE OF WHAT IT PARSED is asserted against a looser count that shares no
 * pattern with the one that parses, so a regex that matches nothing fails here
 * instead of passing every assertion below it.
 */

const webRoot = fileURLToPath(new URL("..", import.meta.url));

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === "e2e") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|dbtest|eval)\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** The text from an opening bracket at `start` to its match, or "" when unbalanced. */
function balanced(text: string, start: number): string {
  const open = text[start];
  const close = open === "(" ? ")" : open === "{" ? "}" : "]";
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close && --depth === 0) return text.slice(start, i + 1);
  }
  return "";
}

const files = ["lib", "app", "components"].flatMap((d) => sources(join(webRoot, d)));
const code = new Map(files.map((f) => [f, stripComments(readFileSync(f, "utf8"))]));

const CALL = /\b(?:prisma|tx|db)\s*\.\s*(bidQuote|bidAddendum|bidSpecSection)\s*\.\s*(\w+)\s*\(/g;
const LOOSE = /\.\s*(?:bidQuote|bidAddendum|bidSpecSection)\s*\.\s*\w+\s*\(/g;

type Call = { file: string; model: string; method: string; where: string | null };

const calls: Call[] = [];
for (const [file, text] of code) {
  for (const match of text.matchAll(CALL)) {
    const body = balanced(text, match.index! + match[0].length - 1);
    const whereAt = body.search(/\bwhere\s*:\s*\{/);
    const where = whereAt === -1 ? null : balanced(body, body.indexOf("{", whereAt));
    calls.push({ file: file.slice(webRoot.length), model: match[1]!, method: match[2]!, where });
  }
}

describe("quotes, addenda and spec sections are never queried by their filing invitation", () => {
  it("parsed a real number of files and calls, counted without the pattern that parses them", () => {
    expect(files.length).toBeGreaterThan(500);
    const loose = [...code.values()].reduce((sum, text) => sum + [...text.matchAll(LOOSE)].length, 0);
    expect(calls.length).toBeGreaterThanOrEqual(10);
    expect(calls).toHaveLength(loose);
    // The pattern can see the three readers this change moved, by name.
    for (const file of ["components/BidLog.tsx", "lib/ask/handlers.ts", "lib/estimating/proposal-facts-query.ts"]) {
      expect(calls.some((c) => c.file === file), `${file} should contain a call on one of the three models`).toBe(true);
    }
  });

  it("no where clause on them names bidInvitationId", () => {
    // The ONE file allowed to ask "which papers were filed under this invitation":
    // `refilePapers` moves exactly those, and it is the same file that defines the
    // right question. It is asserted to still be in the scan, so an exemption
    // cannot outlive the file it is for.
    const ALLOWED = "lib/estimating/bid-papers.ts";
    expect(calls.some((c) => c.file === ALLOWED)).toBe(true);
    // A `paperWhere*(...)` call may take the invitation's id as its argument —
    // that is how it is asked — so those calls are removed before looking.
    const withoutHelpers = (where: string) => {
      let out = where;
      for (let at = out.search(/paperWhere\w*\s*\(/); at !== -1; at = out.search(/paperWhere\w*\s*\(/)) {
        const open = out.indexOf("(", at);
        const call = balanced(out, open);
        if (call === "") break;
        out = out.slice(0, at) + out.slice(open + call.length);
      }
      return out;
    };
    const offenders = calls.filter(
      (c) => c.file !== ALLOWED && c.where !== null && /\bbidInvitationId\b/.test(withoutHelpers(c.where)),
    );
    expect(offenders.map((c) => `${c.file}: ${c.model}.${c.method}`)).toEqual([]);
  });

  it("every paper WRITE goes through paperFiling, so a new row carries its project", () => {
    const creates = calls.filter((c) => c.method === "create" || c.method === "createMany");
    expect(creates.length).toBeGreaterThanOrEqual(3);
    for (const call of creates) {
      const text = code.get(webRoot + call.file)!;
      const at = text.search(new RegExp(`\\.\\s*${call.model}\\s*\\.\\s*${call.method}\\s*\\(`));
      const body = balanced(text, text.indexOf("(", at));
      expect(body, `${call.file}: ${call.model}.${call.method} must spread paperFiling(...)`).toMatch(/paperFiling\s*\(/);
    }
  });
});
