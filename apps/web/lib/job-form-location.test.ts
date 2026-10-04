/**
 * One rule for where a job is, on every form a government body receives.
 *
 * Two halves, and the second is the one that will still be earning its keep
 * in a year: the rule itself, and a census that no form resolves it a second
 * way. The first without the second is a completeness test — it proves the
 * shared answer is right and says nothing about whether anybody asks it,
 * which is the gap CLAUDE.md's `CostCategory` entry describes ("nothing is
 * ever missing from a list nobody imports").
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { jobFormLocation } from "./job-form-location";

describe("jobFormLocation", () => {
  it("prefers the street address, which is the specific one", () => {
    expect(
      jobFormLocation({ siteAddress: "7500 Friars Rd, San Diego, CA", projectLocation: "San Diego" }),
    ).toBe("7500 Friars Rd, San Diego, CA");
  });

  it("falls back to the looser location when there is no address", () => {
    expect(jobFormLocation({ siteAddress: null, projectLocation: "SE 13th and Tacoma" })).toBe(
      "SE 13th and Tacoma",
    );
  });

  it("treats a blank address as absent and keeps looking", () => {
    // `siteAddress ?? projectLocation` returns "" here and skips a location
    // that IS recorded. A cleared form field is how the empty string gets
    // there, so this is the ordinary case rather than a contrived one.
    expect(jobFormLocation({ siteAddress: "", projectLocation: "Portland, OR" })).toBe("Portland, OR");
    expect(jobFormLocation({ siteAddress: "   ", projectLocation: "Portland, OR" })).toBe("Portland, OR");
  });

  it("returns null when neither is recorded, blank included", () => {
    // Null rather than "" on purpose: both `das-print` and `wh347` test this
    // to decide whether the field BLOCKS the form, and an empty string that
    // reads as present prints a box that looks filled in. On a document a
    // state receives that is worse than an empty one — nobody re-checks a
    // filled box.
    expect(jobFormLocation({ siteAddress: null, projectLocation: null })).toBeNull();
    expect(jobFormLocation({ siteAddress: "", projectLocation: "  " })).toBeNull();
  });

  it("trims what it returns, so a stray space is not printed onto a form", () => {
    expect(jobFormLocation({ siteAddress: "  7500 Friars Rd  ", projectLocation: null })).toBe(
      "7500 Friars Rd",
    );
  });
});

/* ------------------------------------------------------------------ *
 * The census: is there a second rule?
 * ------------------------------------------------------------------ */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

/** Every module that builds a government form's contents, plus the pages that
 * feed them. Listed rather than globbed, because the set is small and naming
 * it makes adding a form a deliberate edit here — a glob would quietly admit
 * a fourth form that resolves the location its own way. */
const FORM_SOURCES = [
  "./das-print.ts",
  "./wh347.ts",
  "../app/(app)/jobs/[id]/certified-payroll/wh-347/page.tsx",
  "../app/(app)/jobs/[id]/das-140/[noticeId]/page.tsx",
  "../app/(app)/jobs/[id]/das-142/[requestId]/page.tsx",
] as const;

/** Comments stripped before any structural read. `job-form-location.ts` and
 * both consumers now explain the `??` chain they replaced, IN a comment — so
 * a raw-text scan would find the very pattern it is looking for inside the
 * note saying it is gone. #185's shape exactly. */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (_m, lead: string) => lead);
}

describe("no form resolves the job's location a second way", () => {
  const sources = FORM_SOURCES.map((rel) => ({ name: rel, text: stripComments(read(rel)) }));

  it("read every source it reasons about", () => {
    // Scope and size first. A path that stopped resolving, or a strip that
    // blanked a whole file, would make every assertion below vacuous —
    // nothing is ever wrong in an empty string.
    expect(sources).toHaveLength(FORM_SOURCES.length);
    for (const source of sources) {
      expect(source.text.length, `${source.name} came back empty`).toBeGreaterThan(400);
    }
  });

  it("has at least one source actually mentioning the two columns", () => {
    // Anti-vacuity for the check below: if no form referenced these columns
    // at all, "nobody chains them" would pass for the wrong reason.
    const mentions = sources.filter(
      (s) => s.text.includes("siteAddress") || s.text.includes("projectLocation"),
    );
    expect(mentions.length, "no form source mentions either location column").toBeGreaterThan(0);
  });

  it("chains the two columns nowhere", () => {
    // The shape being banned, in either order and with any spacing:
    // `siteAddress ?? projectLocation`, or a ternary over one of them.
    const chain = /\b(siteAddress|projectLocation)\s*\?\?/;
    const offenders = sources
      .filter((s) => chain.test(s.text))
      .map((s) => `${s.name}: ${chain.exec(s.text)?.[0]}`);
    expect(
      offenders,
      "This form picks its own order for the job's location. Two government " +
        "documents for one job naming different places is the shape this " +
        "helper exists to prevent — call jobFormLocation instead.",
    ).toEqual([]);
  });

  it("is what the two form builders are handed", () => {
    // The other half: banning the chain proves nobody rolled their own, not
    // that anybody calls the shared one. A form that passes no location at
    // all satisfies the ban — which is exactly what the WH-347 did.
    const callers = sources.filter((s) => s.text.includes("jobFormLocation("));
    expect(
      callers.map((s) => s.name).sort(),
      "these are the sources that call jobFormLocation",
    ).toEqual(
      [
        "../app/(app)/jobs/[id]/certified-payroll/wh-347/page.tsx",
        "./das-print.ts",
      ].sort(),
    );
  });
});
