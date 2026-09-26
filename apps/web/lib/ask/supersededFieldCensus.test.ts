/**
 * No Ask tool answers from a column the schema has marked SUPERSEDED without
 * also reading the record that replaced it.
 *
 * THE DEFECT THIS IS BUILT FROM. `operations.prisma` marks
 * `DailyFieldReport.delays` "SUPERSEDED 2026-09-18 by DelayEvent
 * (labor.prisma): one row per delay with a cause, a responsible party,
 * times, crew-hours lost and who at the GC was told". `daily_field_reports`
 * went on reading only that column for eight days, and `DelayEvent` appeared
 * nowhere in `lib/ask/` at all. So the assistant reported delays written up
 * before the changeover and a confident ZERO for every structured delay
 * since — on the one question a delay claim against a GC is assembled from,
 * while the tool's own description promised that "reports WITH a delay are
 * flagged". Typecheck, lint and 5,800 tests were green throughout, because
 * reading a column that still exists is not an error.
 *
 * WHAT IT ASSERTS, and why it is not "never read a superseded column":
 * reading one is often right. The job's Field reports tab still renders the
 * legacy text, because for a day in August it is the only record there is.
 * The bug is reading the dead column INSTEAD of the live one, so that is the
 * assertion — read the old one if you must, but you must also read the new.
 *
 * WHAT IT CANNOT SEE, said plainly so nobody trusts it further than it goes.
 * It is a source scan over `lib/ask/` and it recognises the replacement only
 * as `prisma.<model>` inside that scope. Route a delay read through a loader
 * in another module and this goes RED with the wrong reason. That failure is
 * deliberate rather than tolerated: widening the scope is a decision, and a
 * guard that silently followed an import graph would be a guard nobody could
 * predict. It also cannot see raw SQL, and it says nothing about whether the
 * replacement is read CORRECTLY — only that it is read.
 *
 * HOW IT KEEPS ITSELF HONEST, because a deriving check has two failure modes
 * and only one of them looks like a failure (CLAUDE.md):
 *
 *   - SIZE. The superseded-field set is counted against the number of times
 *     the literal string SUPERSEDED appears in the schema, an expression
 *     that shares nothing with the parser. A parse that matched nothing
 *     would otherwise pass every assertion after it, which is exactly how
 *     `scratch-cleanup-order.test.ts` went green over 180 of 181 foreign
 *     keys.
 *   - SCOPE. Nothing is ever missing from a directory you do not walk. The
 *     schema directory is asserted to exist and to hold more than one file;
 *     the Ask scope is asserted to be non-empty and to contain `handlers.ts`
 *     and `tools.ts` by name, so a walk that resolved to nothing fails
 *     loudly instead of finding no offenders.
 *   - COMMENTS. Every source is read with comments STRIPPED, and this file's
 *     own fixtures prove it: a census that counted comments would find the
 *     `delays` mentioned in this very paragraph. #185 was disarmed by a
 *     comment quoting the pattern that was looking for it.
 *   - CONTROLS. The matchers are exercised against fixtures that are known
 *     offenders and known innocents, through the same functions the real
 *     scan uses. A matcher that returned nothing for everything would pass
 *     the real scan and fail here.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const askDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const schemaDir = join(repoRoot, "packages/db/prisma/schema");

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
    else if (/\.tsx?$/.test(name) && !/\.(test|dbtest|eval)\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/** Comments never count. `stripComments` is the same shape the other
 * censuses in this repo use, and for the same reason: #185 was disarmed by a
 * comment quoting its own pattern, and both this file and `handlers.ts`
 * discuss `report.delays` in prose. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const schemaFiles = readdirSync(schemaDir).filter((name) => name.endsWith(".prisma"));
const schemaText = schemaFiles.map((name) => readFileSync(join(schemaDir, name), "utf8")).join("\n");

export type SupersededField = {
  /** `DailyFieldReport` */
  model: string;
  /** `delays` */
  field: string;
  /** The model the comment names as the replacement: `DelayEvent`. Null when
   * the comment names nothing, which is its own failure below. */
  replacement: string | null;
  file: string;
};

/**
 * Every field whose Prisma doc comment says SUPERSEDED, with the model the
 * comment names as its replacement.
 *
 * Reads the `///` block immediately above a field declaration. A blank line
 * ends a block, so a SUPERSEDED note attached to nothing yields nothing —
 * and the size check below turns that into a red build rather than a shorter
 * list.
 */
export function supersededFields(files: { name: string; text: string }[]): SupersededField[] {
  const out: SupersededField[] = [];
  for (const { name, text } of files) {
    let model: string | null = null;
    let doc: string[] = [];
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      const modelStart = /^model\s+(\w+)\s*\{/.exec(line);
      if (modelStart) {
        model = modelStart[1];
        doc = [];
        continue;
      }
      if (line === "}") {
        model = null;
        doc = [];
        continue;
      }
      if (line.startsWith("///")) {
        doc.push(line.slice(3).trim());
        continue;
      }
      if (line === "" || line.startsWith("//") || line.startsWith("@@")) {
        doc = [];
        continue;
      }
      const field = /^(\w+)\s+\S/.exec(line);
      if (field && model && doc.some((entry) => entry.includes("SUPERSEDED"))) {
        const note = doc.join(" ");
        const by = /SUPERSEDED\b[^.]*?\bby\s+(\w+)/.exec(note);
        out.push({ model, field: field[1], replacement: by ? by[1] : null, file: name });
      }
      doc = [];
    }
  }
  return out;
}

/** A read of `<field>` — as a property (`report.delays`) or as a Prisma
 * `select` key (`delays: true`). Both are how a handler gets at a column. */
export function readsField(source: string, field: string): boolean {
  const property = new RegExp(`\\.\\s*${field}\\b`);
  const selectKey = new RegExp(`(^|[\\s{,(])${field}\\s*:\\s*true\\b`, "m");
  return property.test(source) || selectKey.test(source);
}

/**
 * A WRITE of `<field>` — the field name given a value that is not the `true`
 * of a Prisma `select`.
 *
 * Reading a superseded column is often right; the old text is the only record
 * an August day has. WRITING one is not: a row created in a superseded column
 * today looks like pre-changeover data forever, and it carries none of what
 * the replacement exists to carry. `log_daily_field_report` was the last
 * writer of `DailyFieldReport.delays` in this app — `lib/field-reports-core.ts`
 * says "no screen sends it any more" — so a delay somebody mentioned to the
 * assistant went into a free-text box with no cause, no responsible party, no
 * hours and no record of telling the GC.
 *
 * The pattern will also match an unrelated object literal that happens to use
 * the field name as a key. That is the right direction to be loose in: a false
 * positive costs a line in this file and an argument, and the argument is the
 * review.
 */
export function writesField(source: string, field: string): boolean {
  return new RegExp(`(^|[\\s{,(])${field}\\s*:\\s*(?!true\\b)\\S`, "m").test(source);
}

/** A read of the replacement model through the Prisma client:
 * `prisma.delayEvent.findMany`. The accessor is the model name with a
 * lowercase first letter, which is Prisma's own rule. */
export function readsModel(source: string, model: string): boolean {
  const accessor = model.charAt(0).toLowerCase() + model.slice(1);
  return new RegExp(`\\bprisma\\s*\\.\\s*${accessor}\\b`).test(source);
}

const schemaSources = schemaFiles.map((name) => ({
  name,
  text: readFileSync(join(schemaDir, name), "utf8"),
}));
const superseded = supersededFields(schemaSources);

const askSources = sourceFiles(askDir).map((full) => ({
  path: relative(repoRoot, full),
  source: stripComments(readFileSync(full, "utf8")),
}));
const askText = askSources.map((file) => file.source).join("\n");

describe("the superseded-field census", () => {
  /* ── scope, first, because nothing is missing from a directory you do not
   * walk ─────────────────────────────────────────────────────────────── */

  it("walks the schema directory, and it holds more than one file", () => {
    // The multi-file schema is why: a census pointed at one `.prisma` would
    // find nothing wrong with the other ten and say so cheerfully.
    expect(schemaFiles.length).toBeGreaterThan(1);
    // Pinned by name, so a parse that understood no grammar at all cannot
    // pass by finding nothing.
    expect(schemaFiles).toContain("operations.prisma");
    expect(schemaFiles).toContain("labor.prisma");
  });

  it("walks the Ask sources, and they include the files that read the tables", () => {
    expect(askSources.length).toBeGreaterThan(20);
    const names = askSources.map((file) => file.path);
    for (const sentinel of ["handlers.ts", "tools.ts"]) {
      expect(
        names.some((name) => name.endsWith(`lib/ask/${sentinel}`)),
        `${sentinel} is not in the scanned set, so nothing below looked at it`,
      ).toBe(true);
    }
  });

  /* ── size, second, because an empty question passes everything after it ── */

  it("parses every SUPERSEDED note the schema carries", () => {
    // Counted against an expression that shares nothing with the parser. If
    // somebody writes SUPERSEDED on a MODEL rather than a field, or on a note
    // a blank line separates from its field, these two disagree and this
    // fails naming the number — which is the right outcome: the note is not
    // attached to anything a scan can follow.
    const literal = (schemaText.match(/SUPERSEDED/g) ?? []).length;
    expect(
      superseded.length,
      `the schema mentions SUPERSEDED ${literal} time(s) and this census parsed ` +
        `${superseded.length} field(s): ${superseded.map((f) => `${f.model}.${f.field}`).join(", ")}`,
    ).toBe(literal);
    // And there is at least one, so the assertions below are about something.
    // A schema that genuinely superseded nothing would make this file dead
    // code, which is worse than a failing line: delete it then.
    expect(superseded.length).toBeGreaterThanOrEqual(1);
  });

  it("finds the field this census was written for", () => {
    // Named, so a parser that drifted into matching something else fails here
    // rather than passing on a different set.
    expect(superseded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          model: "DailyFieldReport",
          field: "delays",
          replacement: "DelayEvent",
        }),
      ]),
    );
  });

  /* ── the rules ─────────────────────────────────────────────────────── */

  it("names a replacement on every SUPERSEDED note", () => {
    // "SUPERSEDED" with nothing after it tells the next reader that the
    // column is dead and not where the record went, which is the half that
    // would have stopped this defect. It also leaves this census with nothing
    // to check.
    const vague = superseded.filter((field) => field.replacement === null);
    expect(
      vague,
      `A SUPERSEDED note has to say what replaced it — write "SUPERSEDED <date> by <Model>": ` +
        `${vague.map((field) => `${field.file} ${field.model}.${field.field}`).join(", ")}`,
    ).toEqual([]);
  });

  it("WRITES no superseded field anywhere in the Ask surface", () => {
    // Deliberately no exception list. There is nothing to except today, and
    // an empty exception list is the strongest version of this rule — the next
    // write site has to argue for itself in a diff rather than join a list
    // somebody stops reading.
    const offenders: string[] = [];
    for (const field of superseded) {
      for (const file of askSources) {
        if (writesField(file.source, field.field)) {
          offenders.push(`${file.path} writes ${field.model}.${field.field} (SUPERSEDED by ${field.replacement})`);
        }
      }
    }
    expect(
      offenders,
      `A row written into a superseded column today looks like pre-changeover data forever and carries ` +
        `none of what replaced it — which is what log_daily_field_report did to every delay the ` +
        `assistant was told about: ${offenders.join("; ")}`,
    ).toEqual([]);
  });

  it("reads the replacement wherever it reads the superseded column", () => {
    const offenders: string[] = [];
    for (const field of superseded) {
      if (!field.replacement) continue;
      const readers = askSources.filter((file) => readsField(file.source, field.field));
      if (readers.length === 0) continue;
      if (readsModel(askText, field.replacement)) continue;
      offenders.push(
        `${readers.map((file) => file.path).join(", ")} read ${field.model}.${field.field}, ` +
          `which ${field.file} marks SUPERSEDED by ${field.replacement}, and nothing under lib/ask ` +
          `reads prisma.${field.replacement.charAt(0).toLowerCase()}${field.replacement.slice(1)}`,
      );
    }
    expect(
      offenders,
      `An Ask tool answering from a superseded column alone reports the records written before the ` +
        `changeover and a confident ZERO for everything since — which is what daily_field_reports did ` +
        `to the delay log for eight days: ${offenders.join("; ")}`,
    ).toEqual([]);
  });
});

/**
 * THE CONTROLS. Everything above could pass because the matchers match
 * nothing, so both are driven over fixtures through the same functions the
 * real scan calls — never a second copy of the check, which is the #108 scar
 * (`toolsAcceptNoTenantInput` proved a COPY of itself could fail while the
 * real predicate was disarmed).
 */
describe("the census can actually see", () => {
  const SCHEMA_FIXTURE = [
    {
      name: "fixture.prisma",
      text: [
        "model Widget {",
        "  id String @id",
        "  /// What it cost.",
        "  ///",
        "  /// SUPERSEDED 2026-01-01 by WidgetCost (money.prisma): one row per charge",
        "  /// with a date and a source.",
        "  cost Decimal?",
        "  /// A live column nobody superseded.",
        "  name String",
        "}",
      ].join("\n"),
    },
  ];

  it("parses a superseded field and its replacement out of a doc block", () => {
    expect(supersededFields(SCHEMA_FIXTURE)).toEqual([
      { model: "Widget", field: "cost", replacement: "WidgetCost", file: "fixture.prisma" },
    ]);
  });

  it("does not mistake a live column for a superseded one", () => {
    expect(supersededFields(SCHEMA_FIXTURE).map((field) => field.field)).not.toContain("name");
  });

  it("catches a handler that reads the dead column as a property", () => {
    const source = stripComments("const x = report.cost;");
    expect(readsField(source, "cost")).toBe(true);
    expect(readsModel(source, "WidgetCost")).toBe(false);
  });

  it("catches a handler that reads the dead column as a select key", () => {
    const source = stripComments("const rows = await prisma.widget.findMany({ select: { cost: true } });");
    expect(readsField(source, "cost")).toBe(true);
  });

  it("tells a WRITE of the dead column from a select of it", () => {
    // `cost: true` is a read. `cost: input.cost` is a new row in a dead
    // column, and only the second is forbidden.
    expect(writesField(stripComments("{ select: { cost: true } }"), "cost")).toBe(false);
    expect(writesField(stripComments("{ data: { cost: input.cost ?? null } }"), "cost")).toBe(true);
    expect(writesField(stripComments('formDataFrom({ cost: str(payload, "cost") })'), "cost")).toBe(true);
    // And a comment describing one is not one.
    expect(writesField(stripComments("// cost: input.cost"), "cost")).toBe(false);
  });

  it("clears a handler that reads both", () => {
    const source = stripComments(
      "const a = report.cost; const b = await prisma.widgetCost.findMany({});",
    );
    expect(readsField(source, "cost")).toBe(true);
    expect(readsModel(source, "WidgetCost")).toBe(true);
  });

  it("is not fooled by a COMMENT that quotes the pattern", () => {
    // The #185 shape. This file and handlers.ts both DISCUSS `report.delays`
    // in prose; a raw-text census would find a read that does not exist, and
    // — worse in the other direction — would clear an offender because a
    // comment mentioned the replacement.
    const lineComment = stripComments("// const x = report.cost; // prisma.widgetCost.findMany");
    expect(readsField(lineComment, "cost")).toBe(false);
    expect(readsModel(lineComment, "WidgetCost")).toBe(false);

    const block = stripComments("/* report.cost and prisma.widgetCost */ const y = 1;");
    expect(readsField(block, "cost")).toBe(false);
    expect(readsModel(block, "WidgetCost")).toBe(false);
  });

  it("does not clear a read just because a DIFFERENT model is queried", () => {
    const source = stripComments("const a = report.cost; await prisma.widget.findMany({});");
    expect(readsModel(source, "WidgetCost")).toBe(false);
  });

  it("finds no SUPERSEDED note where there is none", () => {
    // The other half of the parser: it has to return an empty list for a
    // clean schema, or the size check above is satisfied by noise.
    expect(supersededFields([{ name: "x.prisma", text: "model A {\n  id String @id\n}" }])).toEqual([]);
  });
});
