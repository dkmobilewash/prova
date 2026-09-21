import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every route the phone reads a field record from asserts a capability.
 *
 * The phone's role shell hides what a person cannot reach — but a hidden
 * tab is not a guard, and the two routes this file was written for
 * (`time-entries` and `tickets`) asserted NOTHING at all while the
 * equivalent web surface has withheld on MANAGE_FIELD since #396. A
 * bookkeeper could read a job's hours with a bearer token and a URL.
 *
 * The exceptions are listed with reasons rather than pattern-matched
 * away, and each is checked below for still being what it claims.
 */

const V1 = join(__dirname, "..", "app", "api", "v1");

/** Routes that deliberately assert nothing beyond being signed in. */
const OPEN: Record<string, string> = {
  "jobs/route.ts": "the job list itself — every function needs to know which jobs exist",
  "crew/route.ts": "names to attach work to; a picker, not a record",
  "crafts/route.ts": "the company's craft classifications — reference data behind a picker",
  "vendors/route.ts": "vendor names behind the material-order picker",
  "jobs/[id]/line-items/route.ts": "cost codes behind a picker; the amounts are not here",
  "jobs/[id]/apprentice-ratio/route.ts": "a ratio warning computed from the schedule, shown beside hours",
  "device-tokens/route.ts": "registering THIS device for push, which is about the phone, not the company",
  "me/route.ts": "who is holding the phone — the answer is what the rest of the guards are read from",
};

/** Each exported handler in a route file, as [name, body].
 *
 * PER HANDLER, not per file, and that distinction is the first thing this
 * census got wrong: `jobs/[id]/delays/route.ts` guards its POST and left
 * its GET open, and a file-level search for `can(context, …)` found the
 * POST's and reported the file as guarded. Same shape as the census that
 * asked whether a screen CALLS cachedRead rather than whether the call is
 * reachable — the check was not lying, it was answering about a different
 * question. */
function handlers(source: string): [string, string][] {
  const marks = [...source.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)\b/g)];
  return marks.map((mark, index) => [
    mark[1],
    source.slice(mark.index!, index + 1 < marks.length ? marks[index + 1].index! : source.length),
  ]);
}

function routes(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...routes(full));
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

describe("the API the phone talks to", () => {
  it("asserts a capability on every route that carries a field record", () => {
    const all = routes(V1);
    // A walk that found nothing would pass every assertion below.
    expect(all.length, "no v1 routes found at all").toBeGreaterThan(15);

    const ungated: string[] = [];
    let checked = 0;
    for (const file of all) {
      const name = file.slice(V1.length + 1);
      if (OPEN[name]) continue;
      const source = readFileSync(file, "utf8");
      const found = handlers(source);
      expect(found.length, `${name} exports no handler this census can see`).toBeGreaterThan(0);
      for (const [method, body] of found) {
        checked += 1;
        if (!/can\(context,\s*"[A-Z_]+"\)/.test(body)) ungated.push(`${name} ${method}`);
      }
    }
    // The size of the question, asserted against nothing this pattern can
    // change: an empty walk or a regex that stops matching `export async
    // function` fails here rather than passing everything downstream.
    expect(checked, "no handlers were examined").toBeGreaterThan(15);
    expect(
      ungated,
      `these serve records with no capability check, so the phone's role shell would be decoration: ${ungated.join(", ")}`,
    ).toEqual([]);
  });

  it("keeps the open list honest — every entry exists and still asserts nothing", () => {
    for (const [name, reason] of Object.entries(OPEN)) {
      const source = readFileSync(join(V1, name), "utf8");
      expect(reason.length, `${name} needs a reason`).toBeGreaterThan(10);
      expect(
        /can\(context,\s*"[A-Z_]+"\)/.test(source),
        `${name} now asserts a capability — take it out of the open list`,
      ).toBe(false);
      expect(handlers(source).length, `${name} exports no handler`).toBeGreaterThan(0);
    }
  });

  it("checks the capability BEFORE it reads anything", () => {
    // The ordering the capability census on the web side already fixed
    // once: a guard after the query still answers correctly and has
    // already done the work — and on a route that means a refused person
    // has still been served a database round trip.
    for (const file of routes(V1)) {
      for (const [method, body] of handlers(readFileSync(file, "utf8"))) {
        const guard = body.search(/can\(context,\s*"[A-Z_]+"\)/);
        if (guard === -1) continue;
        const firstQuery = body.search(/prisma\.\w+\.(find|create|update|delete|count)/);
        if (firstQuery === -1) continue;
        expect(guard, `${file.slice(V1.length + 1)} ${method} queries before it checks`).toBeLessThan(firstQuery);
      }
    }
  });
});
