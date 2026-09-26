import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXPORT_COLUMN_OMISSIONS,
  EXPORT_DATASETS,
  EXPORT_WITHHELD,
} from "./export";

/**
 * Every SCALAR column on an exported model is accounted for, exactly once.
 *
 * THE GAP THIS CLOSES, and it is the companion to
 * `exportCompletenessCensus.test.ts` rather than a replacement. That file
 * guarantees every MODEL is in exactly one bucket — exported, admitted missing,
 * or internal — and it is model-level, so it says nothing at all about columns.
 * A new column on an already-exported table was therefore invisible: the export
 * quietly shipped without it, `export-coverage` stayed green, and the page went
 * on claiming the file was complete.
 *
 * That is the "right pattern, wrong SCOPE" shape CLAUDE.md records for
 * `theme-contrast.test.ts`: nothing is ever missing from a set you do not
 * examine, and a size assertion cannot help, because the set it sizes was never
 * the set in question.
 *
 * WHAT IT FOUND ON ITS FIRST RUN: **74 columns across 28 datasets**, of which 42
 * were real customer data simply absent from the file —
 *
 *   - `Invoice.status`, so the export could not tell a draft from one a GC had
 *     been sent;
 *   - a job's whole site address, county, coordinates and bid dates;
 *   - the punch list's entire who-marked-it-ready / who-verified / who-reopened
 *     trail, timestamps exported and every name dropped;
 *   - `TimeEntry`'s clock and correction trail, on the rows a certified payroll
 *     is defended with;
 *   - and `JobLineItem.costCategory` and `productionRate` — the two figures #512
 *     and #514 had just made load-bearing, left out of the export by the very
 *     PRs that added them. Both of those were mine.
 *
 * The other 32 were deliberate and undeclared, which is what
 * `EXPORT_COLUMN_OMISSIONS` now ends.
 *
 * THREE BUCKETS, EXACTLY ONE EACH. A column is exported (in a dataset's
 * `columns`), withheld on purpose and said so on the page (`EXPORT_WITHHELD` —
 * credentials), or plumbing nobody asks for (`EXPORT_COLUMN_OMISSIONS`). A
 * column in none of them fails this test by name.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It never requires a column to be exported —
 * only that somebody has DECIDED. The allowlist is the security of this feature
 * (`export.ts`'s own header), so a test that pushed columns into it would be
 * working against the thing it is protecting. Adding a credential to satisfy
 * this file would be caught by `export.test.ts`, which fails on a
 * credential-shaped name in any column list; the two pull in opposite
 * directions on purpose.
 *
 * HOW IT KEEPS ITSELF HONEST, because a deriving check has two failure modes
 * and only one looks like a failure:
 *
 *   - SIZE. The parsed field count is asserted against a `grep`-style count of
 *     lines that look like field declarations, computed without the block regex.
 *     A model regex that stopped matching would otherwise reduce every
 *     downstream assertion to vacuum.
 *   - SCOPE. The models examined are derived from `EXPORT_DATASETS` itself
 *     rather than from a hand-written list, so a new dataset is in scope the
 *     moment it exists. Every dataset's model is asserted to be FOUND in the
 *     schema, so a renamed model fails loudly instead of silently contributing
 *     no columns.
 *   - CONTROLS. The field parser is exercised against a fixture with a relation,
 *     a list, an enum, a scalar and a `@@`-block line, so a parser that
 *     returned nothing for everything would pass the real scan and fail here.
 */

const SCHEMA_DIR = join(__dirname, "../../../packages/db/prisma/schema");

const SCALARS = new Set([
  "String",
  "Int",
  "BigInt",
  "Float",
  "Decimal",
  "Boolean",
  "DateTime",
  "Json",
  "Bytes",
]);

function schemaText(): string {
  return readdirSync(SCHEMA_DIR)
    .filter((f) => f.endsWith(".prisma"))
    .map((f) => readFileSync(join(SCHEMA_DIR, f), "utf8"))
    .join("\n");
}

export type ModelField = { field: string; type: string; isList: boolean };

/** Every `model X { … }` block, as a map of model name to its field lines. */
export function parseModelFields(text: string): Map<string, ModelField[]> {
  const models = new Map<string, ModelField[]>();
  const block = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let match: RegExpExecArray | null;
  while ((match = block.exec(text)) !== null) {
    models.set(match[1], fieldsOf(match[2]));
  }
  return models;
}

/** The field declarations in one model body. `///` docs, `//` comments and
 * `@@` block attributes are not fields. */
export function fieldsOf(body: string): ModelField[] {
  const out: ModelField[] = [];
  for (const raw of body.split("\n")) {
    const line = raw.replace(/\/\/.*$/, "").trim();
    if (line === "" || line.startsWith("@@")) continue;
    const m = line.match(/^(\w+)\s+(\w+)(\[\])?/);
    if (!m) continue;
    out.push({ field: m[1], type: m[2], isList: Boolean(m[3]) });
  }
  return out;
}

/**
 * A COLUMN is a non-list field whose type is a scalar or an enum. An enum is
 * "not a model", which is why the model map has to be built first — that is the
 * only thing distinguishing `status TradeScope` (a column) from
 * `job Job` (a relation).
 */
function columnsOf(fields: ModelField[], models: Map<string, ModelField[]>): string[] {
  return fields.filter((f) => !f.isList && (SCALARS.has(f.type) || !models.has(f.type))).map((f) => f.field);
}

/** `jobLineItem` (a Prisma delegate) -> `JobLineItem` (a model). */
const modelNameFor = (delegate: string) => delegate[0].toUpperCase() + delegate.slice(1);

const text = schemaText();
const models = parseModelFields(text);
const withheld = new Set(EXPORT_WITHHELD.flatMap((entry) => entry.columns));
const omitted = new Set(Object.keys(EXPORT_COLUMN_OMISSIONS));

describe("the census can see what it is reasoning about", () => {
  it("parses the schema into models with fields", () => {
    expect(models.size).toBeGreaterThan(100);
    // By name, so a walk that resolved to the wrong tree fails here rather than
    // finding no columns and passing everything after it.
    expect(models.has("JobLineItem")).toBe(true);
    expect(models.has("Invoice")).toBe(true);
  });

  it("parses as many fields as the raw text declares, so a dead regex cannot pass", () => {
    const parsed = [...models.values()].reduce((sum, fields) => sum + fields.length, 0);
    // The independent count: lines inside the file that look like a field
    // declaration, with no block parsing at all. It is an UPPER bound (it also
    // counts enum members and datasource keys), so the assertion is that the
    // parse is a large fraction of it rather than equal — the failure this
    // catches is a parse that collapses toward zero.
    const declarationish = text
      .split("\n")
      .map((l) => l.replace(/\/\/.*$/, "").trim())
      .filter((l) => /^\w+\s+\w+/.test(l) && !l.startsWith("@@")).length;
    expect(parsed).toBeGreaterThan(declarationish * 0.5);
    expect(declarationish).toBeGreaterThan(500);
  });

  it("finds every exported dataset's model in the schema", () => {
    const missing = EXPORT_DATASETS.map((d) => modelNameFor(d.model)).filter((name) => !models.has(name));
    expect(missing, `these datasets name a model the schema does not have: ${missing.join(", ")}`).toEqual([]);
  });

  it("distinguishes columns from relations, on a fixture", () => {
    const fixture = `
      id        String    @id
      jobId     String
      job       Job       @relation(fields: [jobId], references: [id])
      status    JobStatus?
      children  Thing[]
      amount    Decimal?  @db.Decimal(12, 2)
      @@index([jobId])
    `;
    const fields = fieldsOf(fixture);
    expect(fields.map((f) => f.field)).toEqual(["id", "jobId", "job", "status", "children", "amount"]);
    // `Job` and `Thing` are models; `JobStatus` is an enum and so a column.
    const cols = columnsOf(fields, new Map([["Job", []], ["Thing", []]]));
    expect(cols).toEqual(["id", "jobId", "status", "amount"]);
  });
});

describe("every column on an exported model is in exactly one bucket", () => {
  for (const dataset of EXPORT_DATASETS) {
    it(`${dataset.key} (${dataset.model})`, () => {
      const fields = models.get(modelNameFor(dataset.model));
      if (!fields) throw new Error(`no model ${modelNameFor(dataset.model)} in the schema`);

      const exported = new Set(dataset.columns);
      const undecided = columnsOf(fields, models).filter(
        (col) => !exported.has(col) && !withheld.has(col) && !omitted.has(col),
      );

      expect(
        undecided,
        `${dataset.key} does not account for: ${undecided.join(", ")}. Add each to this ` +
          `dataset's \`columns\` if a customer should get it; to EXPORT_WITHHELD if it is a ` +
          `credential the page should say it is holding back; or to EXPORT_COLUMN_OMISSIONS ` +
          `if it is plumbing, with the reason. Never add a credential to \`columns\` — ` +
          `export.test.ts fails on that, and the two tests disagree on purpose.`,
      ).toEqual([]);
    });
  }

  it("exports no column the schema does not have", () => {
    // The other direction, and cheap: a typo in a column list is a header the
    // CSV writes with every cell empty, which reads as "we have no data for
    // this" rather than as a mistake.
    const wrong: string[] = [];
    for (const dataset of EXPORT_DATASETS) {
      const fields = models.get(modelNameFor(dataset.model));
      if (!fields) continue;
      const known = new Set(fields.map((f) => f.field));
      for (const col of dataset.columns) if (!known.has(col)) wrong.push(`${dataset.key}.${col}`);
    }
    expect(wrong, `column lists naming fields that do not exist: ${wrong.join(", ")}`).toEqual([]);
  });
});

describe("the omission lists stay honest", () => {
  it("gives every omitted column a reason", () => {
    for (const [column, reason] of Object.entries(EXPORT_COLUMN_OMISSIONS)) {
      expect(reason.length, `${column} needs a real reason`).toBeGreaterThan(30);
    }
  });

  it("holds no credential in EXPORT_COLUMN_OMISSIONS — those go in EXPORT_WITHHELD", () => {
    // The two lists mean different things to a reader of the page: withheld is
    // shown ("we have this and are not giving it to you, here is why"), omitted
    // is not. Filing a token here would hide it from the person it concerns.
    const credentialish = /token|secret|password|apiKey|encrypted/i;
    const wrong = Object.keys(EXPORT_COLUMN_OMISSIONS).filter((c) => credentialish.test(c));
    expect(wrong).toEqual([]);
  });

  it("does not omit a column that some dataset also exports", () => {
    // A column cannot be both plumbing and customer data. If one dataset
    // exports it, the blanket omission is wrong and needs to be per-dataset.
    const exportedSomewhere = new Set(EXPORT_DATASETS.flatMap((d) => d.columns));
    const both = [...omitted].filter((c) => exportedSomewhere.has(c));
    expect(both, `in EXPORT_COLUMN_OMISSIONS and also exported: ${both.join(", ")}`).toEqual([]);
  });
});
