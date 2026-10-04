import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * A PROVENANCE COLUMN THAT NOTHING READS IS A PROMISE THE SCREEN CANNOT KEEP.
 *
 * `JobMedia.companycamPhotoId` records that a photo came from CompanyCam, and
 * `media.prisma` states the intent outright: "The galleries derive a
 * 'CompanyCam' mark from this being non-null." The integrations card promises
 * the same thing to the user — imported photos arrive "captioned, dated by when
 * they were taken, and marked as imported."
 *
 * Nothing read it. Every reference in the repo was inside
 * `lib/companycam/import.ts`, which is the module that WRITES it. The galleries
 * never derived anything, and the mark the card promised could not be drawn.
 *
 * WHY NO EXISTING CHECK COULD SEE THIS, which is the part worth keeping. The
 * write half is guarded thoroughly — a unique index, a pre-filter, a P2002
 * catch, and tests asserting the same photo is never written twice. All of it
 * green, all of it about writing. CLAUDE.md's recurring shape is "written,
 * documented, and never called"; this is that shape with the missing half on
 * the READ side, and a test that a value is stored correctly can never notice
 * that nobody looks at it.
 *
 * So this census asks the other question: does something OUTSIDE the writing
 * module consume it. It is deliberately about readers rather than about the
 * rendered words — asserting the exact sentence on a card would make this a
 * test about copy, which is the wrong thing to pin.
 */

const webDir = fileURLToPath(new URL("..", import.meta.url));

/** The column, the module allowed to be its only writer, and what a reader of
 *  it is called once derived. Keyed by column so a second provenance column
 *  added later has an obvious place to go. */
const PROVENANCE = {
  companycamPhotoId: {
    writtenBy: "lib/companycam/import.ts",
    derivedAs: "importedFrom",
    promise: 'media.prisma: "The galleries derive a \'CompanyCam\' mark from this being non-null."',
  },
} as const;

/**
 * Comments out, strings kept.
 *
 * NOT decoration, and it was added after a mutation caught this file passing on
 * its own prose: when the derived field was removed from the query's mapping,
 * the "consumed outside the writer" assertion stayed GREEN — because the
 * explanatory comment left beside the fix names `companycamPhotoId` several
 * times, and a raw text scan counted that as a reader.
 *
 * A census satisfied by a comment ABOUT the defect it guards is the #185 shape
 * exactly, and this one reproduced it on the first try.
 */
function stripComments(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      out += (end === -1 ? text.slice(i) : text.slice(i, end + 2)).replace(/[^\n]/g, "");
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    if (c === "/" && next === "/") {
      const end = text.indexOf("\n", i);
      i = end === -1 ? text.length : end;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      out += c;
      i += 1;
      while (i < text.length && text[i] !== c) {
        if (text[i] === "\\") {
          out += text[i] + (text[i + 1] ?? "");
          i += 2;
          continue;
        }
        out += text[i];
        i += 1;
      }
      out += text[i] ?? "";
      i += 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

const SKIP_FILE = (name: string) =>
  name.includes(".test.") || name.includes(".dbtest.") || name.includes(".eval.");

function sources(): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === ".next" || name === "e2e" || name.startsWith("."))
        continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if ((name.endsWith(".ts") || name.endsWith(".tsx")) && !SKIP_FILE(name))
        out.push({
          path: relative(webDir, full).split("\\").join("/"),
          text: stripComments(readFileSync(full, "utf8")),
        });
    }
  };
  for (const root of ["app", "components", "lib"]) walk(resolve(webDir, root));
  return out;
}

const files = sources();

describe("every provenance column has a reader, not just a writer", () => {
  it("scanned the app", () => {
    /* SIZE FIRST. An empty walk makes every assertion below vacuous — nothing
     * is ever unread in a set with nothing in it. */
    expect(
      files.length,
      "almost nothing was scanned — the roots are wrong and the checks below " +
        "would pass about nothing",
    ).toBeGreaterThanOrEqual(400);
  });

  for (const [column, spec] of Object.entries(PROVENANCE)) {
    it(`${column} is consumed outside the module that writes it`, () => {
      const readers = files
        .filter((f) => f.path !== spec.writtenBy)
        .filter((f) => f.text.includes(column))
        .map((f) => f.path);

      expect(
        readers,
        `Nothing outside ${spec.writtenBy} mentions \`${column}\`, so the column ` +
          `is written and never read.\n\n${spec.promise}\n\n` +
          `A unique index and a duplicate test guard the WRITE, and both stay ` +
          `green while the read half does not exist — which is why this needs ` +
          `its own check rather than being caught by the ones already there.`,
      ).not.toEqual([]);
    });

    it(`${column} reaches a component as \`${spec.derivedAs}\``, () => {
      /* One step further than "something mentions it": the derived value has
       * to cross into something that renders. A query that selects a column
       * and then drops it in its own `.map` is exactly how this broke — the
       * row carried it the whole time and the component never saw it. */
      const consumers = files
        .filter((f) => f.path.startsWith("components/") || f.path.startsWith("app/"))
        .filter((f) => f.text.includes(spec.derivedAs))
        .map((f) => f.path);

      expect(
        consumers,
        `No component or page mentions \`${spec.derivedAs}\`. The value may be ` +
          `derived in a query and then dropped before anything can render it, ` +
          `which is the precise way this failed the first time: the row carried ` +
          `\`${column}\` via \`include\` and the mapping left it out.`,
      ).not.toEqual([]);
    });
  }
});
